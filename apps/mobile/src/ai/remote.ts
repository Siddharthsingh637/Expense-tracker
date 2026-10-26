import { apiRequest, hasSession } from '@/data/remote/api';
import { usePaisaStore } from '@/data/local/store';
import { AIDraft, BudgetAllocation, GroupBill, MonthReport, Transaction } from '@/engine/types';
import { MockAIService } from './mock';
import type { AIService, QueryContext } from './types';
import { formatMoney } from '@/lib/format';

type Envelope<T> = { payload: T; confidence: number; reason: string; latency_ms: number };

export class RemoteAIService implements AIService {
  private fallback = new MockAIService();
  private async ask<T>(path: string, body: unknown): Promise<Envelope<T>> {
    return apiRequest<Envelope<T>>(`/ai/${path}`, { method: 'POST', body: JSON.stringify(body) });
  }
  private async withFallback<T>(remote: () => Promise<T>, local: () => Promise<T>): Promise<T> {
    if (!hasSession()) return local();
    try { return await remote(); } catch { return local(); }
  }
  async parseReceipt(imageUri: string) {
    return this.withFallback(async () => {
      const form = new FormData();
      if (imageUri.startsWith('data:')) {
        const response = await fetch(imageUri);
        const blob = await response.blob();
        form.append('file', blob, 'receipt.jpg');
      } else {
        form.append('file', { uri: imageUri, name: 'receipt.jpg', type: 'image/jpeg' } as unknown as Blob);
      }
      const result = await apiRequest<Envelope<{merchant?: string|null; total_paise?: number|null; date?: string|null; items?: Array<Record<string, unknown>>}>>('/ai/parse-receipt', { method: 'POST', body: form });
      return { data: { merchant: result.payload.merchant ?? undefined, amount: result.payload.total_paise ?? undefined, date: result.payload.date ?? undefined, items: result.payload.items ?? [] }, confidence: result.confidence, reason: result.reason, latencyMs: result.latency_ms };
    }, () => this.fallback.parseReceipt(imageUri));
  }
  async parseEntry(text: string) {
    return this.withFallback<AIDraft<Partial<Transaction>>>(async () => {
      const result = await this.ask<{amount_paise?: number; place: string; note: string; payment_mode?: Transaction['paymentMode']; local_date?: string; local_time?: string; category_id?: string}>('parse-entry', {
        text,
        context: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, now: new Date().toISOString(), recent_places: usePaisaStore.getState().transactions.slice(0, 10).map((txn) => txn.place), categories: usePaisaStore.getState().categories.map(({id,name}) => ({id,name})) },
      });
      const category = usePaisaStore.getState().categories.find((item) => item.id === result.payload.category_id);
      return { data: { amount: result.payload.amount_paise, place: result.payload.place, note: result.payload.note, paymentMode: result.payload.payment_mode, date: result.payload.local_date, time: result.payload.local_time, categoryId: category?.id }, confidence: result.confidence, reason: result.reason, latencyMs: result.latency_ms };
    }, () => this.fallback.parseEntry(text));
  }
  async suggestCategory(place: string, amount: number) {
    return this.withFallback<AIDraft<string>>(async () => {
      const categories = usePaisaStore.getState().categories;
      const result = await this.ask<{category_id: string | null}>('suggest-category', { place, categories: categories.map(({id,name}) => ({id,name})) });
      return { data: categories.find((item) => item.id === result.payload.category_id)?.name ?? 'Other', confidence: result.confidence, reason: result.reason, latencyMs: result.latency_ms };
    }, () => this.fallback.suggestCategory(place, amount));
  }
  async proposeBudget(history: Transaction[], totalPaise: number) {
    return this.withFallback(async () => {
      const state = usePaisaStore.getState();
      const result = await this.ask<{allocations: Array<{category_id: string; amount_paise: number; reason: string}>}>('propose-budget', {
        total_paise: totalPaise, start_day: state.budgetStartDay,
        history: history.slice(-500).map(({amount,categoryId,date,place}) => ({amount_paise: amount, category_id: categoryId, transaction_date: date, place})),
        categories: state.categories.map(({id,name,type}) => ({id,name,type})),
      });
      return { data: result.payload.allocations.map((item) => ({ id: `suggested-${item.category_id}`, month: state.currentMonth, categoryId: item.category_id, allocatedPaise: item.amount_paise } as BudgetAllocation)), confidence: result.confidence, reason: result.reason, latencyMs: result.latency_ms };
    }, () => this.fallback.proposeBudget(history, totalPaise));
  }
  async draftSplit(text: string) {
    return this.withFallback<AIDraft<Partial<GroupBill> & { personNames?: string[] }>>(async () => {
      const state = usePaisaStore.getState();
      const result = await this.ask<{title: string; date: string; person_ids: string[]; payments: Record<string, number>; method: GroupBill['method']; is_settled: boolean}>('draft-split', {
        text, people: state.people.map(({id,name}) => ({id,name})), categories: state.categories.map(({id,name}) => ({id,name})),
      });
      return { data: { title: result.payload.title, date: result.payload.date, personIds: result.payload.person_ids, payments: result.payload.payments, method: result.payload.method, isSettled: result.payload.is_settled }, confidence: result.confidence, reason: result.reason, latencyMs: result.latency_ms };
    }, () => this.fallback.draftSplit(text));
  }
  async answerQuestion(question: string, ctx: QueryContext) {
    return this.withFallback(async () => {
      const state = usePaisaStore.getState();
      const categories = state.categories.map(({id,name}) => ({id,name}));
      const [year, month] = ctx.currentMonth.split('-').map(Number);
      const monthEnd = new Date(year, month, 0).getDate();
      const defaultStart = `${ctx.currentMonth}-01`;
      const defaultEnd = `${ctx.currentMonth}-${String(monthEnd).padStart(2, '0')}`;
      const result = await this.ask<{intent: string; category_id?: string|null; period?: {start: string; end: string}|null; filters: {payment_mode?: Transaction['paymentMode']|null; place?: string|null; kind?: string|null}}>('ask', { question, categories, periods: [{start: defaultStart, end: defaultEnd}] });
      const q = result.payload;
      if (q.intent === 'unknown' || q.intent === 'comparison') return (await this.fallback.answerQuestion(question, ctx));
      const start = q.period?.start ?? defaultStart;
      const end = q.period?.end ?? defaultEnd;
      const rows = ctx.transactions.filter((t) => t.date >= start && t.date <= end && !t.isTransfer
        && (!q.filters.payment_mode || t.paymentMode === q.filters.payment_mode)
        && (!q.filters.place || t.place.toLowerCase().includes(q.filters.place.toLowerCase()))
        && (q.intent !== 'category_total' || !q.category_id || t.categoryId === q.category_id)
        && (q.filters.kind === 'income' ? t.amount < 0 : q.filters.kind === 'refund' ? t.amount < 0 : t.amount > 0));
      let answer: string;
      if (q.intent === 'transaction_count') answer = `There are ${rows.length} matching transactions.`;
      else {
        const amount = rows.reduce((sum, t) => sum + Math.max(0, t.amount), 0);
        if (q.intent === 'budget_remaining') {
          const allocated = ctx.allocations.filter((a) => a.month === ctx.currentMonth && (!q.category_id || a.categoryId === q.category_id)).reduce((sum,a) => sum + a.allocatedPaise,0);
          answer = `You have ${formatMoney(allocated - amount)} remaining from ${formatMoney(allocated)} allocated.`;
        } else answer = `You spent ${formatMoney(amount)} across ${rows.length} matching transactions.`;
      }
      return { data: answer, confidence: result.confidence, reason: result.reason, latencyMs: result.latency_ms };
    }, () => this.fallback.answerQuestion(question, ctx));
  }
  async monthNarrative(report: MonthReport) {
    return this.withFallback(async () => {
      const categories = usePaisaStore.getState().categories.map(({id,name}) => ({id,name}));
      const result = await this.ask<{text: string}>('month-narrative', { report, categories });
      return { data: result.payload.text, confidence: result.confidence, reason: result.reason, latencyMs: result.latency_ms };
    }, () => this.fallback.monthNarrative(report));
  }
  async processMessage(text: string, ctx: QueryContext) {
    const routed = await this.fallback.processMessage(text, ctx);
    if (routed.intent === 'conversation') {
      return this.withFallback(async () => {
        const result = await this.ask<{intent: string; response?: string | null}>('ask', {
          mode: 'conversation', question: text, categories: [], periods: [],
          history: (ctx.conversationHistory ?? []).slice(-8),
        });
        if (result.payload.intent !== 'conversation' || !result.payload.response) return routed;
        return {
          intent: 'conversation' as const,
          draft: { data: result.payload.response, confidence: result.confidence, reason: result.reason, latencyMs: result.latency_ms },
        };
      }, async () => routed);
    }
    if (routed.intent !== 'question') return routed;
    const answer = await this.answerQuestion(text, ctx);
    return {
      ...routed,
      draft: { ...routed.draft, data: { ...routed.draft.data, answer: answer.data } },
    };
  }
}
