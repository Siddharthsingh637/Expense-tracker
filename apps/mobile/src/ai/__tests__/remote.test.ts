import { RemoteAIService } from '../remote';
import { usePaisaStore } from '@/data/local/store';
import { MonthReport } from '@/engine/types';

const mockRequest = jest.fn();
jest.mock('@/data/remote/api', () => ({
  apiRequest: (...args: unknown[]) => mockRequest(...args),
  hasSession: () => true,
}));

describe('RemoteAIService', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockRequest.mockImplementation(async (path: string) => ({
      payload: path.endsWith('/parse-entry') ? { amount_paise: 2500, place: 'Cafe', note: '', payment_mode: null, local_date: '2026-10-23', local_time: null, category_id: null }
        : path.endsWith('/suggest-category') ? { category_id: null }
          : path.endsWith('/propose-budget') ? { allocations: [] }
            : path.endsWith('/draft-split') ? { title: 'Dinner', date: '2026-10-23', person_ids: [], payments: {}, method: 'equal', is_settled: false }
              : path.endsWith('/ask') ? { intent: 'spending_total', category_id: null, period: null, filters: {} }
                : path.endsWith('/month-narrative') ? { text: 'A summary.' }
                  : { merchant: 'Cafe', total_paise: 2500, date: '2026-10-23', items: [] },
      confidence: 0.8, reason: 'test', latency_ms: 12,
    }));
  });

  it('calls each of the seven AI endpoints', async () => {
    const ai = new RemoteAIService();
    await ai.parseEntry('coffee 25');
    await ai.suggestCategory('Cafe', 2500);
    await ai.proposeBudget([], 10000);
    await ai.draftSplit('dinner 25');
    await ai.answerQuestion('How much did I spend?', { transactions: [], allocations: [], currentMonth: '2026-10' });
    await ai.monthNarrative({ month: '2026-10' } as MonthReport);
    await ai.parseReceipt('file:///receipt.jpg');

    expect(mockRequest.mock.calls.map(([path]) => path)).toEqual([
      '/ai/parse-entry', '/ai/suggest-category', '/ai/propose-budget', '/ai/draft-split',
      '/ai/ask', '/ai/month-narrative', '/ai/parse-receipt',
    ]);
    expect(usePaisaStore.getState()).toBeDefined();
  });

  it('uses a safe local receipt fallback when there is no session', async () => {
    const api = jest.requireMock('@/data/remote/api') as { hasSession: () => boolean };
    api.hasSession = () => false;
    const result = await new RemoteAIService().parseReceipt('file:///receipt.jpg');
    expect(result.data).toEqual({});
    expect(mockRequest).not.toHaveBeenCalled();
    api.hasSession = () => true;
  });

  it('falls back to local text parsing when the AI request fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('offline'));
    const result = await new RemoteAIService().parseEntry('coffee 25');
    expect(result.data.amount).toBe(2500);
    expect(result.data.place?.toLowerCase()).toContain('coffee');
  });

  it('routes ordinary chat through the existing AI ask endpoint', async () => {
    mockRequest.mockResolvedValueOnce({
      payload: { intent: 'conversation', response: 'Hello! How can I help with your budget?' },
      confidence: 0.9, reason: 'test conversation', latency_ms: 10,
    });
    const result = await new RemoteAIService().processMessage('Hi', {
      transactions: [], allocations: [], currentMonth: '2026-10',
    });
    expect(result.intent).toBe('conversation');
    if (result.intent === 'conversation') expect(result.draft.data).toContain('Hello');
    expect(mockRequest).toHaveBeenCalledWith('/ai/ask', expect.objectContaining({
      body: expect.stringContaining('"mode":"conversation"'),
    }));
  });
});
