import { AIDraft, Transaction, BudgetAllocation, GroupBill, MonthReport } from '@/engine/types';

// Context passed to answerQuestion so AI can use real data
export interface QueryContext {
  transactions: Transaction[];
  allocations: BudgetAllocation[];
  currentMonth: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; text: string }>;
}

export type AIIntent = 'expense' | 'split' | 'budget_proposal' | 'question';

export interface AIQuestionResult {
  answer: string;
  breakdown?: Array<{ label: string; value: string }>;
}

export type AIProcessedMessage =
  | { intent: 'conversation'; draft: AIDraft<string> }
  | { intent: 'expense'; draft: AIDraft<Partial<Transaction>> }
  | { intent: 'split'; draft: AIDraft<Partial<GroupBill> & { personNames?: string[] }> }
  | { intent: 'budget_proposal'; draft: AIDraft<BudgetAllocation[]> }
  | { intent: 'question'; draft: AIDraft<AIQuestionResult> };

export interface AIService {
  parseEntry(text: string): Promise<AIDraft<Partial<Transaction>>>;
  parseReceipt(imageUri: string): Promise<AIDraft<{ merchant?: string; amount?: number; date?: string; items?: Array<Record<string, unknown>> }>>;
  suggestCategory(place: string, amount: number): Promise<AIDraft<string>>;
  proposeBudget(history: Transaction[], totalPaise: number): Promise<AIDraft<BudgetAllocation[]>>;
  draftSplit(text: string): Promise<AIDraft<Partial<GroupBill> & { personNames?: string[] }>>;
  answerQuestion(question: string, ctx: QueryContext): Promise<AIDraft<string>>;
  answerQuestionWithBreakdown?(question: string, ctx: QueryContext): Promise<AIDraft<AIQuestionResult>>;
  monthNarrative(report: MonthReport): Promise<AIDraft<string>>;
  processMessage(text: string, ctx: QueryContext): Promise<AIProcessedMessage>;
}
