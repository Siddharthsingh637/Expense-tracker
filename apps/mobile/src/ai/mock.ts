import { AIService, QueryContext, AIProcessedMessage, AIQuestionResult } from './types';
import {
  AIDraft,
  Transaction,
  BudgetAllocation,
  GroupBill,
  MonthReport,
  PaymentMode,
  SplitMethod,
} from '@/engine/types';
import { formatMoney, toISODate, toYYYYMM } from '@/lib/format';
import { BUDGET_TEMPLATES, DEFAULT_CATEGORIES } from '@/lib/constants';

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Food: [
    'chai', 'coffee', 'restaurant', 'food', 'eat', 'zomato', 'swiggy',
    'dominos', 'pizza', 'biryani', 'dhaba', 'canteen', 'mess', 'lunch',
    'dinner', 'breakfast', 'hotel', 'cafe', 'starbucks', 'mcdonalds',
  ],
  Transport: [
    'uber', 'ola', 'auto', 'bus', 'metro', 'petrol', 'fuel', 'train',
    'cab', 'rickshaw', 'rapido', 'parking', 'toll',
  ],
  Bills: [
    'electricity', 'bill', 'recharge', 'internet', 'broadband', 'mobile',
    'phone', 'dth', 'wifi', 'gas', 'water',
  ],
  Shopping: [
    'amazon', 'flipkart', 'mall', 'shop', 'store', 'clothes', 'shoes',
    'myntra', 'zara', 'h&m', 'electronics',
  ],
  Health: [
    'pharmacy', 'medical', 'doctor', 'hospital', 'medicine', 'chemist',
    'apollo', 'clinic', '1mg', 'pharmeasy', 'dental',
  ],
  Entertainment: [
    'movie', 'netflix', 'hotstar', 'concert', 'gaming', 'game', 'pvr',
    'theatre', 'spotify', 'prime video', 'steam',
  ],
  Savings: [
    'savings', 'invest', 'fd', 'mutual fund', 'sip', 'stocks', 'zerodha',
    'groww', 'ppf', 'gold',
  ],
};

export class MockAIService implements AIService {
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getSimulatedLatency(): number {
    return Math.round(400 + Math.random() * 500);
  }

  async parseReceipt(_imageUri: string): Promise<AIDraft<{ merchant?: string; amount?: number; date?: string; items?: Array<Record<string, unknown>> }>> {
    return { data: {}, confidence: 0, reason: 'Receipt scanning requires a connection', latencyMs: 0 };
  }

  async parseEntry(text: string): Promise<AIDraft<Partial<Transaction>>> {
    const latency = this.getSimulatedLatency();
    await this.delay(latency);

    let paymentMode: PaymentMode | undefined;
    if (/\bupi\b/i.test(text)) {
      paymentMode = 'upi';
    } else if (/\bcard\b/i.test(text)) {
      paymentMode = 'card';
    } else if (/\bcash\b/i.test(text)) {
      paymentMode = 'cash';
    }

    const trimmed = text.trim();
    // Match leading amount or amount with currency markers
    // e.g. "50 chai stall", "₹250 at dominos upi", "paid 250 at dominos"
    const amountMatch = trimmed.match(/(?:(?:rs\.?|₹|paid)\s*)?(\d+(?:\.\d+)?)/i);
    let amountPaise: number | undefined;
    let place = trimmed;
    let confidence = 0.4;

    if (amountMatch && amountMatch.index !== undefined) {
      const parsedNum = parseFloat(amountMatch[1]);
      if (!isNaN(parsedNum) && parsedNum > 0) {
        amountPaise = Math.round(parsedNum * 100);
        confidence = 0.75;

        // Remove the amount portion to extract merchant/place
        const before = trimmed.slice(0, amountMatch.index);
        const after = trimmed.slice(amountMatch.index + amountMatch[0].length);
        place = `${before} ${after}`.trim();
      }
    }

    // Clean place string: remove paymentMode tokens, prepositions, extra spaces
    place = place
      .replace(/\b(upi|card|cash|paid|at|for|on)\b/gi, '')
      .replace(/[,\.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // If place was emptied or only had numbers, restore original without numbers/keywords
    if (!place) {
      place = trimmed
        .replace(/(?:rs\.?|₹)?\s*\d+(?:\.\d+)?/gi, '')
        .replace(/\b(upi|card|cash|paid)\b/gi, '')
        .trim();
    }

    const draftData: Partial<Transaction> = {
      ...(amountPaise !== undefined ? { amount: amountPaise } : {}),
      place: place || 'Unknown Merchant',
      ...(paymentMode ? { paymentMode } : {}),
      date: toISODate(new Date()),
    };

    return {
      data: draftData,
      confidence,
      reason: 'Parsed from text input',
      latencyMs: latency,
    };
  }

  async suggestCategory(place: string, _amount: number): Promise<AIDraft<string>> {
    const latency = this.getSimulatedLatency();
    await this.delay(latency);

    const lowerPlace = place.toLowerCase();
    let matchedCategory: string | null = null;

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      const hasMatch = keywords.some((kw) => lowerPlace.includes(kw));
      if (hasMatch) {
        matchedCategory = category;
        break;
      }
    }

    if (matchedCategory) {
      return {
        data: matchedCategory,
        confidence: 0.85,
        reason: `Matched category based on '${matchedCategory.toLowerCase()}' keywords`,
        latencyMs: latency,
      };
    }

    return {
      data: 'Other',
      confidence: 0.5,
      reason: 'Default category (no keyword match)',
      latencyMs: latency,
    };
  }

  async proposeBudget(history: Transaction[], totalPaise: number): Promise<AIDraft<BudgetAllocation[]>> {
    const latency = this.getSimulatedLatency();
    await this.delay(latency);

    const now = new Date();
    const currentMonth = toYYYYMM(now);
    const validHistory = history.filter((t) => t.amount > 0 && !t.isTransfer);
    const hasHistory = validHistory.length > 0;

    let allocations: BudgetAllocation[] = [];

    if (hasHistory) {
      // Group spending by categoryId
      const spendByCategory = new Map<string, number>();
      let totalHistorySpend = 0;

      for (const txn of validHistory) {
        const current = spendByCategory.get(txn.categoryId) ?? 0;
        spendByCategory.set(txn.categoryId, current + txn.amount);
        totalHistorySpend += txn.amount;
      }

      let allocIndex = 0;
      let allocatedSum = 0;
      const entries = Array.from(spendByCategory.entries());

      for (const [categoryId, spend] of entries) {
        const ratio = totalHistorySpend > 0 ? spend / totalHistorySpend : 0;
        const allocatedPaise = Math.round(ratio * totalPaise);
        allocatedSum += allocatedPaise;

        allocations.push({
          id: `prop-alloc-${allocIndex++}`,
          month: currentMonth,
          categoryId,
          allocatedPaise,
        });
      }

      // Adjust last entry for any rounding difference
      if (allocations.length > 0 && allocatedSum !== totalPaise) {
        const diff = totalPaise - allocatedSum;
        const last = allocations[allocations.length - 1];
        last.allocatedPaise = Math.max(0, last.allocatedPaise + diff);
      }
    } else {
      // 50/30/20 template
      const template = BUDGET_TEMPLATES[0];
      const fractions = template.fractions;
      let allocIndex = 0;
      let allocatedSum = 0;

      const categoryEntries = Object.entries(fractions);
      for (const [catName, fraction] of categoryEntries) {
        // Find matching default category ID if possible
        const defaultCat = DEFAULT_CATEGORIES.find(
          (c) => c.name.toLowerCase() === catName.toLowerCase()
        );
        const categoryId = defaultCat ? `cat-${defaultCat.sortOrder}` : `cat-${catName.toLowerCase()}`;
        const allocatedPaise = Math.round(fraction * totalPaise);
        allocatedSum += allocatedPaise;

        allocations.push({
          id: `prop-alloc-${allocIndex++}`,
          month: currentMonth,
          categoryId,
          allocatedPaise,
        });
      }

      if (allocations.length > 0 && allocatedSum !== totalPaise) {
        const diff = totalPaise - allocatedSum;
        const last = allocations[allocations.length - 1];
        last.allocatedPaise = Math.max(0, last.allocatedPaise + diff);
      }
    }

    return {
      data: allocations,
      confidence: hasHistory ? 0.6 : 0.4,
      reason: hasHistory ? 'Based on your last 3 months' : '50/30/20 rule (no history yet)',
      latencyMs: latency,
    };
  }

  async draftSplit(text: string): Promise<AIDraft<Partial<GroupBill> & { personNames?: string[] }>> {
    const latency = this.getSimulatedLatency();
    await this.delay(latency);

    // Extract amount
    const amountMatch = text.match(/(?:(?:rs\.?|₹|paid)\s*)?(\d+(?:\.\d+)?)/i);
    let amountPaise = 0;
    if (amountMatch) {
      const parsed = parseFloat(amountMatch[1]);
      if (!isNaN(parsed)) {
        amountPaise = Math.round(parsed * 100);
      }
    }

    // Extract merchant / title (e.g. "paid 250 at Dominos with Riya")
    let title = 'Group Expense';
    const atMatch = text.match(/(?:at|for|to)\s+([^,]+?)(?:\s+with|\s+split|$|,)/i);
    if (atMatch && atMatch[1].trim()) {
      title = atMatch[1].trim();
    } else if (amountMatch && amountMatch.index !== undefined) {
      const after = text.slice(amountMatch.index + amountMatch[0].length);
      const withIdx = after.toLowerCase().indexOf('with');
      if (withIdx !== -1) {
        const placePart = after.slice(0, withIdx).replace(/\b(at|for|to)\b/gi, '').trim();
        if (placePart) title = placePart;
      }
    }

    // Extract person names (e.g. "with Riya and Amit, split equally")
    const personNames: string[] = [];
    const withMatch = text.match(/with\s+([^,]+?)(?:\s*,\s*split|\s+split|$)/i);
    if (withMatch && withMatch[1].trim()) {
      const rawNames = withMatch[1].split(/\band\b|\b&\b|,/i);
      for (const name of rawNames) {
        const cleaned = name.trim();
        if (cleaned && !/^(me|myself|i)$/i.test(cleaned)) {
          personNames.push(cleaned);
        }
      }
    }

    // Method
    const method: SplitMethod = /equal/i.test(text) ? 'equal' : 'equal';

    const billDraft: Partial<GroupBill> & { personNames?: string[] } = {
      title,
      date: toISODate(new Date()),
      method,
      personIds: personNames,
      payments: amountPaise > 0 ? { me: amountPaise } : {},
      isSettled: false,
    };
    (billDraft as Record<string, unknown>).personNames = personNames;

    return {
      data: billDraft,
      confidence: 0.7,
      reason: 'Extracted bill details from text',
      latencyMs: latency,
    };
  }

  async answerQuestionWithBreakdown(question: string, ctx: QueryContext): Promise<AIDraft<AIQuestionResult>> {
    const latency = this.getSimulatedLatency();
    await this.delay(latency);

    const q = question.toLowerCase();
    let answer = '';
    let breakdown: Array<{ label: string; value: string }> | undefined;

    if (/how much.*food|food.*spend/i.test(q)) {
      // Compute total food spend from ctx.transactions for this week
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 86_400_000);
      const weekStartStr = toISODate(oneWeekAgo);

      const foodKeywords = CATEGORY_KEYWORDS['Food'];
      const foodTxns = ctx.transactions.filter((t) => {
        if (t.amount <= 0 || t.isTransfer) return false;
        const matchesCategory =
          t.categoryId.toLowerCase().includes('food') ||
          t.categoryId === 'cat-0';
        const matchesKeyword = foodKeywords.some((kw) =>
          t.place.toLowerCase().includes(kw)
        );
        const inThisWeek = t.date >= weekStartStr;
        return (matchesCategory || matchesKeyword) && inThisWeek;
      });

      const totalFoodPaise = foodTxns.reduce((sum, t) => sum + t.amount, 0);
      answer = `You spent ${formatMoney(totalFoodPaise)} on food this week across ${foodTxns.length} transactions.`;
      breakdown = foodTxns.slice(0, 5).map((t) => ({
        label: t.place || 'Food item',
        value: formatMoney(t.amount),
      }));
    } else if (/total.*this month|spent.*this month|month.*total|summary.*this month|spending.*this month/i.test(q)) {
      // Sum all this month
      const monthTxns = ctx.transactions.filter(
        (t) => t.date.startsWith(ctx.currentMonth) && t.amount > 0 && !t.isTransfer
      );
      const totalMonthPaise = monthTxns.reduce((sum, t) => sum + t.amount, 0);
      answer = `Total spending for ${ctx.currentMonth} is ${formatMoney(totalMonthPaise)} across ${monthTxns.length} transactions.`;

      const byCat: Record<string, number> = {};
      for (const t of monthTxns) {
        byCat[t.categoryId] = (byCat[t.categoryId] ?? 0) + t.amount;
      }
      const topCats = Object.entries(byCat)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);

      breakdown = topCats.map(([catId, amount]) => {
        const cat = DEFAULT_CATEGORIES.find((c) => `cat-${c.sortOrder}` === catId);
        return {
          label: cat ? cat.name : catId,
          value: formatMoney(amount),
        };
      });
    } else if (/budget|remaining/i.test(q)) {
      // Remaining budget
      const totalAllocated = ctx.allocations.reduce(
        (sum, a) => sum + a.allocatedPaise,
        0
      );
      const monthTxns = ctx.transactions.filter(
        (t) => t.date.startsWith(ctx.currentMonth) && t.amount > 0 && !t.isTransfer
      );
      const totalSpent = monthTxns.reduce((sum, t) => sum + t.amount, 0);
      const remaining = totalAllocated - totalSpent;

      if (totalAllocated > 0) {
        if (remaining >= 0) {
          answer = `Your total budget is ${formatMoney(totalAllocated)}. You have spent ${formatMoney(totalSpent)}, leaving ${formatMoney(remaining)} remaining.`;
        } else {
          answer = `Your budget is ${formatMoney(totalAllocated)}. You have spent ${formatMoney(totalSpent)}, which is ${formatMoney(Math.abs(remaining))} over budget.`;
        }
        breakdown = [
          { label: 'Total Budget', value: formatMoney(totalAllocated) },
          { label: 'Total Spent', value: formatMoney(totalSpent) },
          { label: remaining >= 0 ? 'Remaining' : 'Over Budget', value: formatMoney(Math.abs(remaining)) },
        ];
      } else {
        answer = `You haven't set a budget yet for this month. Current spending is ${formatMoney(totalSpent)}.`;
      }
    } else {
      // General overview fallback
      const monthTxns = ctx.transactions.filter(
        (t) => t.date.startsWith(ctx.currentMonth) && t.amount > 0 && !t.isTransfer
      );
      const totalSpent = monthTxns.reduce((sum, t) => sum + t.amount, 0);
      answer = `For ${ctx.currentMonth}, you have recorded ${monthTxns.length} transactions totaling ${formatMoney(totalSpent)}.`;
    }

    return {
      data: { answer, breakdown },
      confidence: 0.9,
      reason: 'Computed from your local data',
      latencyMs: latency,
    };
  }

  async answerQuestion(question: string, ctx: QueryContext): Promise<AIDraft<string>> {
    const res = await this.answerQuestionWithBreakdown(question, ctx);
    return {
      data: res.data.answer,
      confidence: res.confidence,
      reason: res.reason,
      latencyMs: res.latencyMs,
    };
  }

  async processMessage(text: string, ctx: QueryContext): Promise<AIProcessedMessage> {
    const trimmed = text.trim();
    const lower = trimmed.toLowerCase().replace(/[.!?]+$/g, '');

    const conversation = (reply: string): AIProcessedMessage => ({
      intent: 'conversation',
      draft: { data: reply, confidence: 1, reason: 'Conversational response', latencyMs: 0 },
    });

    if (/^(hi|hello|hey|good morning|good afternoon|good evening)(\s|$)/i.test(lower)) {
      return conversation("Hi! I can help with budgeting, saving, expense questions, and recording or splitting a bill. What would you like to work on?");
    }
    if (/^(thanks|thank you|thx|great thanks|okay thanks)$/.test(lower)) {
      return conversation("You’re welcome. If you want, we can look at a budget or a specific spending question next.");
    }
    if (/\b(tax|invest|investment|stocks|legal)\b/i.test(trimmed)
      && /\b(should i|how should|advice|recommend|what should|help me decide)\b/i.test(trimmed)) {
      return conversation('I can explain general financial concepts, but I’m not a licensed Chartered Accountant or investment adviser. For tax, investment, or legal decisions based on your personal situation, please consult a qualified professional.');
    }
    if (/\b(how can i save|ways to save|help me save|saving advice|save money|spend less)\b/i.test(trimmed)) {
      return conversation('A practical start is to set aside a realistic amount when income arrives, then give essentials and flexible spending clear limits. Review a month of expenses, choose one or two categories to adjust, and set a weekly target. If you share your income and goal, I can help shape a plan.');
    }
    if (/\b(emergency fund|compound interest|credit score|systematic investment plan|\bsip\b)\b/i.test(trimmed)) {
      if (/emergency fund/i.test(trimmed)) return conversation('An emergency fund is money kept accessible for unexpected costs such as a medical bill or job gap. Build it gradually around your essential monthly costs and personal circumstances; there is no single target that fits everyone.');
      if (/compound interest/i.test(trimmed)) return conversation('Compound interest means interest can earn further interest over time. The effect depends on the rate, how often it compounds, and how long money stays invested; investment returns are not guaranteed.');
      if (/credit score/i.test(trimmed)) return conversation('A credit score is a summary of credit history used by lenders. Paying dues on time, keeping borrowing manageable, and checking your credit report for errors can help maintain a healthy profile.');
      return conversation('A Systematic Investment Plan (SIP) invests a chosen amount into a mutual fund at regular intervals. It can make investing more consistent, but returns are market-linked and not guaranteed. For a personal investment choice, speak with a qualified, registered adviser.');
    }
    if (/\b(what is|explain)\b/i.test(trimmed) && /\b(gst|itr|income tax|budget|inflation)\b/i.test(trimmed)) {
      if (/\bgst\b/i.test(trimmed)) return conversation('GST is India’s goods and services tax, generally charged on many goods and services. The applicable rate depends on the item or service; check current official guidance or a tax professional for a specific transaction.');
      if (/\bitr\b|income tax/i.test(trimmed)) return conversation('An income tax return (ITR) reports income and tax details to India’s tax department. Which form and deadlines apply depend on your circumstances, so check current official guidance or ask a qualified tax professional for filing advice.');
      if (/inflation/i.test(trimmed)) return conversation('Inflation is a broad rise in prices over time, which reduces what the same amount of money can buy. A budget can help you spot which of your own costs are changing.');
      return conversation('A budget is a plan for where money should go over a period. It gives essentials, goals, and flexible spending clear limits, then helps you compare the plan with what you actually spent.');
    }

    // 1. Group Split check
    const isSplitPattern = /\b(split|equally|with\s+[A-Za-z]+|shared)\b/i.test(trimmed);
    const hasNumber = /\d+/.test(trimmed);
    if (isSplitPattern && hasNumber) {
      const draft = await this.draftSplit(trimmed);
      if (draft.data.title) {
        const catDraft = await this.suggestCategory(draft.data.title, 0);
        const matched = DEFAULT_CATEGORIES.find(
          (c) => c.name.toLowerCase() === catDraft.data.toLowerCase()
        );
        draft.data.categoryId = matched ? `cat-${matched.sortOrder}` : 'cat-0';
      }
      return { intent: 'split', draft };
    }

    // 2. Budget Proposal check
    const isBudgetPattern = /\b(propose|suggest\s+budget|new\s+budget|budget\s+plan|draft\s+budget|plan\s+budget)\b/i.test(trimmed);
    if (isBudgetPattern) {
      const currentTotal = ctx.allocations.reduce((sum, a) => sum + a.allocatedPaise, 0) || 2500000;
      const draft = await this.proposeBudget(ctx.transactions, currentTotal);
      return { intent: 'budget_proposal', draft };
    }

    // 3. Question check
    const asksForReport = /\b(report|summary|summarize|overview)\b/i.test(trimmed)
      && /\b(my|this month|monthly|spending|expenses|financial)\b/i.test(trimmed);
    const isPersonalDataQuestion = /\b(my|i|me|we|our)\b/i.test(trimmed)
      && /\b(how much|how many|what did|where did|spend|spent|expense|transaction|budget|remaining|left|balance|report|summary)\b/i.test(trimmed);
    if (asksForReport) {
      const draft = await this.answerQuestionWithBreakdown(trimmed, ctx);
      return { intent: 'question', draft };
    }
    const isQuestionPattern = isPersonalDataQuestion;
    if (isQuestionPattern) {
      const draft = await this.answerQuestionWithBreakdown(trimmed, ctx);
      return { intent: 'question', draft };
    }

    // A number alone is ambiguous. Only draft an expense when the wording
    // clearly signals a payment or purchase.
    const looksLikeExpenseEntry = hasNumber && /(?:₹|\brs\.?\b|\b(paid|at|for|expense|spent|bought|bill|cash|upi|card)\b)/i.test(trimmed);
    if (looksLikeExpenseEntry) {
      const draft = await this.parseEntry(trimmed);
      if (draft.data.place && !draft.data.categoryId) {
        const catDraft = await this.suggestCategory(draft.data.place, draft.data.amount ?? 0);
        const matched = DEFAULT_CATEGORIES.find(
          (c) => c.name.toLowerCase() === catDraft.data.toLowerCase()
        );
        draft.data.categoryId = matched ? `cat-${matched.sortOrder}` : 'cat-0';
      }
      return { intent: 'expense', draft };
    }

    // Conversational guidance does not inspect personal records unless the
    // user asks a question about their own data.
    if (/\b(save|saving|budget|cut back|spend less|subscriptions|subscription|emergency fund|track expenses)\b/i.test(trimmed)) {
      let reply: string;
      if (/subscription/i.test(trimmed) && ctx.conversationHistory?.some((turn) => turn.role === 'user' && /save|saving|budget/i.test(turn.text))) {
        reply = 'Subscriptions are a good place to review: list the services you paid for in the last month, mark the ones you used, and cancel or pause anything low value. If you ask how much you spent on subscriptions, I can check your recorded transactions.';
      } else if (/invest|tax|legal|retirement/i.test(trimmed)) {
        reply = 'I can explain general concepts, but this isn’t licensed tax, investment, or legal advice. For decisions that depend on your personal situation, please speak with a qualified professional.';
      } else {
        reply = 'A simple way to start is to set aside savings when income arrives, then give essentials and flexible spending clear limits. Review a month of expenses, choose one or two categories to adjust, and set a realistic weekly target. If you share your income and goal, I can help make a practical plan.';
      }
      return conversation(reply);
    }

    if (/^(what about|and|also|tell me more|why|how so)\b/i.test(trimmed) && ctx.conversationHistory?.length) {
      return conversation('Could you tell me which part you want to explore? I can explain the idea or help apply it to your budget.');
    }
    return conversation('I can help with personal finance basics, budgets, savings, bills, and expense tracking. Tell me what you’re trying to figure out.');
  }


  async monthNarrative(report: MonthReport): Promise<AIDraft<string>> {
    const latency = this.getSimulatedLatency();
    await this.delay(latency);

    const spentStr = formatMoney(report.totalSpentPaise);
    const budgetStatus =
      report.savedOrOverspentPaise >= 0
        ? 'within your budget'
        : `${formatMoney(Math.abs(report.savedOrOverspentPaise))} over your budget`;

    // Find top category
    let topCategoryName = 'None';
    let topCategorySpent = 0;

    if (report.categoryBreakdown.length > 0) {
      const sorted = [...report.categoryBreakdown].sort(
        (a, b) => b.spentPaise - a.spentPaise
      );
      const top = sorted[0];
      topCategorySpent = top.spentPaise;
      // Match category name
      const defaultCat = DEFAULT_CATEGORIES.find(
        (c) => `cat-${c.sortOrder}` === top.categoryId
      );
      topCategoryName = defaultCat ? defaultCat.name : top.categoryId;
    }

    const savingsLine =
      report.savedOrOverspentPaise > 0
        ? `You saved ${formatMoney(report.savedOrOverspentPaise)}, great work!`
        : `Consider reviewing ${topCategoryName} next month.`;

    let changeLine = '';
    if (report.biggestChanges && report.biggestChanges.length > 0) {
      const change = report.biggestChanges[0];
      const sign = change.deltaPercent > 0 ? '+' : '';
      const defaultCat = DEFAULT_CATEGORIES.find(
        (c) => `cat-${c.sortOrder}` === change.categoryId
      );
      const catName = defaultCat ? defaultCat.name : change.categoryId;
      changeLine = `Biggest change was in ${catName} (${sign}${change.deltaPercent.toFixed(0)}% vs previous avg).`;
    }

    const narrative = [
      `You spent ${spentStr} this month, ${budgetStatus}.`,
      `Top category was ${topCategoryName} at ${formatMoney(topCategorySpent)}.`,
      savingsLine,
      changeLine,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      data: narrative,
      confidence: 0.85,
      reason: 'Generated from your month summary',
      latencyMs: latency,
    };
  }
}
