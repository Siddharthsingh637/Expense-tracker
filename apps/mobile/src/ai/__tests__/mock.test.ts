import { MockAIService } from '../mock';
import { QueryContext } from '../types';
import { Transaction, BudgetAllocation, MonthReport } from '@/engine/types';

describe('MockAIService', () => {
  let ai: MockAIService;
  let mockContext: QueryContext;

  beforeEach(() => {
    ai = new MockAIService();
    const mockTxns: Transaction[] = [
      {
        id: 't-1',
        amount: 25000, // ₹250
        place: 'Dominos Pizza',
        note: '',
        paymentMode: 'card',
        date: '2026-10-24',
        time: '19:30',
        createdAt: '2026-10-24T19:30:00Z',
        provenance: 'user',
        categoryId: 'cat-0', // Food
      },
      {
        id: 't-2',
        amount: 4000, // ₹40
        place: 'Chai stall',
        note: '',
        paymentMode: 'cash',
        date: '2026-10-25',
        time: '08:45',
        createdAt: '2026-10-25T08:45:00Z',
        provenance: 'user',
        categoryId: 'cat-0',
      },
    ];

    const mockAllocations: BudgetAllocation[] = [
      {
        id: 'a-1',
        month: '2026-10',
        categoryId: 'cat-0',
        allocatedPaise: 600000, // ₹6,000
      },
    ];

    mockContext = {
      transactions: mockTxns,
      allocations: mockAllocations,
      currentMonth: '2026-10',
    };
  });

  describe('parseEntry', () => {
    it('extracts amount, place, and payment mode', async () => {
      const draft = await ai.parseEntry('50 chai stall upi');
      expect(draft.data.amount).toBe(5000);
      expect(draft.data.place?.toLowerCase()).toContain('chai stall');
      expect(draft.data.paymentMode).toBe('upi');
      expect(draft.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('extracts card payment mode and rupee symbol', async () => {
      const draft = await ai.parseEntry('₹250 at dominos card');
      expect(draft.data.amount).toBe(25000);
      expect(draft.data.paymentMode).toBe('card');
    });
  });

  describe('suggestCategory', () => {
    it('matches food keywords to Food', async () => {
      const draft = await ai.suggestCategory('Starbucks coffee', 35000);
      expect(draft.data).toBe('Food');
      expect(draft.confidence).toBe(0.85);
    });

    it('matches transport keywords to Transport', async () => {
      const draft = await ai.suggestCategory('Uber ride to airport', 45000);
      expect(draft.data).toBe('Transport');
    });

    it('falls back to Other for unrecognized merchant', async () => {
      const draft = await ai.suggestCategory('Random Acme Enterprise', 10000);
      expect(draft.data).toBe('Other');
    });
  });

  describe('draftSplit', () => {
    it('extracts split participants, amount, and title', async () => {
      const draft = await ai.draftSplit('Paid 250 at Dominos with Riya, split equally');
      expect(draft.data.payments?.me).toBe(25000);
      expect(draft.data.title).toBe('Dominos');
      expect(draft.data.method).toBe('equal');
      expect(draft.data.personNames).toContain('Riya');
    });
  });

  describe('answerQuestionWithBreakdown', () => {
    it('answers food spend query with breakdown', async () => {
      const draft = await ai.answerQuestionWithBreakdown(
        'How much did I spend on food this week?',
        mockContext
      );
      expect(draft.data.answer).toContain('food');
      expect(draft.data.breakdown).toBeDefined();
      expect(draft.data.breakdown?.length).toBeGreaterThan(0);
    });

    it('answers remaining budget query with breakdown', async () => {
      const draft = await ai.answerQuestionWithBreakdown(
        'How much left in budget?',
        mockContext
      );
      expect(draft.data.answer).toContain('budget');
      expect(draft.data.breakdown).toBeDefined();
    });
  });

  describe('processMessage', () => {
    it('routes group bill text to split intent', async () => {
      const result = await ai.processMessage(
        'Paid 500 at Cafe with Sneha, split equally',
        mockContext
      );
      expect(result.intent).toBe('split');
      if (result.intent === 'split') {
        expect(result.draft.data.personNames).toContain('Sneha');
      }
    });

    it('routes budget query to budget_proposal intent', async () => {
      const result = await ai.processMessage(
        'Propose a budget for next month',
        mockContext
      );
      expect(result.intent).toBe('budget_proposal');
      if (result.intent === 'budget_proposal') {
        expect(result.draft.data.length).toBeGreaterThan(0);
      }
    });

    it('routes question text to question intent', async () => {
      const result = await ai.processMessage(
        'How much did I spend on food this week?',
        mockContext
      );
      expect(result.intent).toBe('question');
    });

    it('answers greetings conversationally without querying personal finances', async () => {
      const result = await ai.processMessage('Hi', mockContext);
      expect(result.intent).toBe('conversation');
      if (result.intent === 'conversation') expect(result.draft.data).toMatch(/help|budget|expense/i);
    });

    it('gives general savings guidance without generating a report', async () => {
      const result = await ai.processMessage('How can I save money?', mockContext);
      expect(result.intent).toBe('conversation');
      if (result.intent === 'conversation') expect(result.draft.data).toMatch(/savings|save|spending/i);
    });

    it('explains financial concepts in plain language', async () => {
      const result = await ai.processMessage('What is an emergency fund?', mockContext);
      expect(result.intent).toBe('conversation');
      if (result.intent === 'conversation') expect(result.draft.data).toMatch(/unexpected costs/i);
    });

    it('flags professional help for personalized investment decisions', async () => {
      const result = await ai.processMessage('How should I invest ₹5000?', mockContext);
      expect(result.intent).toBe('conversation');
      if (result.intent === 'conversation') expect(result.draft.data).toMatch(/qualified professional/i);
    });

    it('responds to a relevant follow-up in conversation context', async () => {
      const result = await ai.processMessage('What about subscriptions?', {
        ...mockContext,
        conversationHistory: [{ role: 'user', text: 'How can I save money?' }, { role: 'assistant', text: 'Review your budget.' }],
      });
      expect(result.intent).toBe('conversation');
      if (result.intent === 'conversation') expect(result.draft.data).toMatch(/subscriptions/i);
    });

    it('keeps unrelated input out of financial report generation', async () => {
      const result = await ai.processMessage('What is the capital of Japan?', mockContext);
      expect(result.intent).toBe('conversation');
      if (result.intent === 'conversation') expect(result.draft.data).toMatch(/help with personal finance/i);
    });

    it('does not interpret unrelated numbers as expense entries', async () => {
      const result = await ai.processMessage('What is the capital of Japan in 2026?', mockContext);
      expect(result.intent).toBe('conversation');
    });

    it('only creates a summary response when the user explicitly asks for one', async () => {
      const result = await ai.processMessage('Give me a summary of my spending this month', mockContext);
      expect(result.intent).toBe('question');
      if (result.intent === 'question') expect(result.draft.data.answer).toContain('Total spending');
    });

    it('routes expense text to expense intent', async () => {
      const result = await ai.processMessage('50 chai stall cash', mockContext);
      expect(result.intent).toBe('expense');
      if (result.intent === 'expense') {
        expect(result.draft.data.amount).toBe(5000);
        expect(result.draft.data.paymentMode).toBe('cash');
      }
    });
  });

  describe('monthNarrative', () => {
    it('generates a 3-5 sentence summary from MonthReport', async () => {
      const report: MonthReport = {
        month: '2026-10',
        totalSpentPaise: 29000,
        totalAllocatedPaise: 600000,
        totalBudgetPaise: 600000,
        savedOrOverspentPaise: 571000,
        cashPaidOutPaise: 4000,
        categoryBreakdown: [],
        biggestChanges: [],
        duplicateSuspects: [],
      };

      const narrative = await ai.monthNarrative(report);
      expect(narrative.data).toContain('within your budget');
      expect(narrative.confidence).toBe(0.85);
    });
  });
});
