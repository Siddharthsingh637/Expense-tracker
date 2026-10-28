const mockValues = new Map<string, string>();
const mockApiRequest = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockValues.get(key) ?? null,
    setItem: async (key: string, value: string) => { mockValues.set(key, value); },
    removeItem: async (key: string) => { mockValues.delete(key); },
  },
}));
jest.mock('@/data/remote/api', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  currentUser: () => ({ id: 'user-1' }),
  hasSession: () => true,
  isMockSession: () => false,
}));

import { startSyncService, stopSyncService, syncNow } from '../sync';
import { activateStoreForUser, useFinancerStore } from '@/data/local/store';
import { MonthBudget, Transaction } from '@/engine/types';

describe('mobile sync', () => {
  beforeEach(() => {
    stopSyncService();
    mockValues.clear();
    mockApiRequest.mockReset();
    useFinancerStore.getState().resetAll();
  });

  it('pushes an offline edit captured before applying a newer server snapshot', async () => {
    const local: Transaction = {
      id: '11111111-1111-4111-8111-111111111111', amount: 2000, categoryId: 'cat-0',
      place: 'Offline cafe edit', note: '', paymentMode: 'cash', date: '2026-10-22',
      time: '12:00', createdAt: '2026-10-22T12:00:00.000Z', provenance: 'user',
    };
    useFinancerStore.setState({ transactions: [local] });
    const state = useFinancerStore.getState();
    mockValues.set('paisa-sync:user-1:snapshot', JSON.stringify({
      category: state.categories, transaction: [{ ...local, amount: 1000 }],
      budget_period: state.monthBudgets, budget_allocation: state.budgetAllocations,
      person: state.people.filter((person) => !person.isMe), group_bill: state.groupBills,
      settlement: state.billSettlements,
    }));
    let pulls = 0;
    mockApiRequest.mockImplementation(async (path: string) => {
      if (path.startsWith('/sync/pull')) {
        pulls += 1;
        return pulls === 1 ? { changes: [{
          resource: 'transaction', id: local.id, op: 'upsert', sync_seq: 1,
          data: { ...local, amount: 3000, place: 'Newer server copy' },
        }], next_cursor: 1, has_more: false } : { changes: [], next_cursor: 1, has_more: false };
      }
      if (path === '/sync/push') return { results: [{ resource: 'transaction', id: local.id, status: 'applied' }] };
      throw new Error(`Unexpected route ${path}`);
    });

    await syncNow();

    const push = mockApiRequest.mock.calls.find(([path]) => path === '/sync/push');
    expect(push).toBeDefined();
    expect(JSON.parse(push![1].body as string).changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: local.id, data: expect.objectContaining({ amount: 2000, place: 'Offline cafe edit' }) }),
    ]));
    expect(pulls).toBe(2);
  });

  it('uploads a local receipt before syncing its private attachment pointer', async () => {
    const txn: Transaction = {
      id: '22222222-2222-4222-8222-222222222222', amount: 1500, categoryId: 'cat-0',
      place: 'Receipt cafe', note: '', paymentMode: 'upi', billPhotoUri: 'file:///receipt.jpg',
      date: '2026-10-22', time: '12:00', createdAt: '2026-10-22T12:00:00.000Z', provenance: 'user',
    };
    useFinancerStore.setState({ transactions: [txn] });
    const state = useFinancerStore.getState();
    mockValues.set('paisa-sync:user-1:snapshot', JSON.stringify({
      category: state.categories, transaction: [{ ...txn, billPhotoUri: undefined }],
      budget_period: state.monthBudgets, budget_allocation: state.budgetAllocations,
      person: state.people.filter((person) => !person.isMe), group_bill: state.groupBills,
      settlement: state.billSettlements,
    }));
    const routes: string[] = [];
    mockApiRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      routes.push(path.split('?')[0]);
      if (path.startsWith('/sync/pull')) return { changes: [], next_cursor: 0, has_more: false };
      if (path === '/attachments/') return {};
      if (path.startsWith('/attachments/')) return {};
      if (path === '/sync/push') return { results: JSON.parse(String(init?.body)).changes.map((change: {resource: string; id: string}) => ({ ...change, status: 'applied' })) };
      throw new Error(`Unexpected route ${path}`);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as Response));
    try {
      await syncNow();
    } finally {
      globalThis.fetch = originalFetch;
    }

    const attachmentIndex = routes.findIndex((path) => path.startsWith('/attachments/'));
    expect(attachmentIndex).toBeGreaterThanOrEqual(0);
    expect(routes.indexOf('/sync/push', attachmentIndex)).toBeGreaterThan(attachmentIndex);
    const pointerPush = mockApiRequest.mock.calls.map(([, init]) => init)
      .filter((init) => init?.method === 'POST' && JSON.stringify(init.body).includes('attachment:'));
    expect(pointerPush).toHaveLength(1);
  });

  it('pulls account settings and pushes later offline changes', async () => {
    const settingsId = '33333333-3333-4333-8333-333333333333';
    useFinancerStore.setState({ budgetStartDay: 1, aiEnabled: true });
    mockValues.set('paisa-sync:user-1:snapshot', JSON.stringify({
      category: useFinancerStore.getState().categories, transaction: useFinancerStore.getState().transactions,
      budget_period: useFinancerStore.getState().monthBudgets, budget_allocation: useFinancerStore.getState().budgetAllocations,
      person: useFinancerStore.getState().people.filter((person) => !person.isMe), group_bill: useFinancerStore.getState().groupBills,
      settlement: useFinancerStore.getState().billSettlements,
    }));
    let firstPull = true;
    mockApiRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/sync/pull')) {
        if (firstPull) {
          firstPull = false;
          return { changes: [{ resource: 'user_settings', id: settingsId, op: 'upsert', sync_seq: 1, data: {
            id: settingsId, budgetStartDay: 1, aiEnabled: true,
            aiFeatureToggles: { entryParsing: true, categorization: true, splitDrafting: true, budgetSuggestions: true, summaries: true },
          } }], next_cursor: 1, has_more: false };
        }
        return { changes: [], next_cursor: 1, has_more: false };
      }
      if (path === '/sync/push') return { results: [{ resource: 'user_settings', id: settingsId, status: 'applied' }] };
      throw new Error(`Unexpected route ${path}`);
    });

    await syncNow();
    useFinancerStore.setState({ budgetStartDay: 5 });
    await syncNow();

    const pushes = mockApiRequest.mock.calls.filter(([path]) => path === '/sync/push');
    expect(pushes).toHaveLength(1);
    expect(JSON.parse(pushes[0][1].body as string).changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource: 'user_settings', id: settingsId, data: expect.objectContaining({ budgetStartDay: 5 }) }),
    ]));
  });

  it('keeps exactly one built-in Me person when applying remote people', async () => {
    const state = useFinancerStore.getState();
    const me = state.people.find((person) => person.isMe)!;
    const friend = { id: 'person-remote-1', name: 'Friend', isMe: false, isArchived: false };
    useFinancerStore.setState({ people: [me, friend] });
    const snapshot = useFinancerStore.getState();
    mockValues.set('paisa-sync:user-1:snapshot', JSON.stringify({
      category: snapshot.categories, transaction: snapshot.transactions,
      budget_period: snapshot.monthBudgets, budget_allocation: snapshot.budgetAllocations,
      person: [friend], group_bill: snapshot.groupBills, settlement: snapshot.billSettlements,
      user_settings: [{ id: '33333333-3333-4333-8333-333333333333', budgetStartDay: snapshot.budgetStartDay, aiEnabled: snapshot.aiEnabled, aiFeatureToggles: snapshot.aiFeatureToggles }],
    }));
    mockApiRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/sync/pull')) return { changes: [{
        resource: 'person', id: friend.id, op: 'upsert', sync_seq: 1, data: friend,
      }], next_cursor: 1, has_more: false };
      if (path === '/sync/push') return { results: JSON.parse(String(init?.body)).changes.map((change: {resource: string; id: string}) => ({ ...change, status: 'applied' })) };
      throw new Error(`Unexpected route ${path}`);
    });

    await syncNow();

    expect(useFinancerStore.getState().people.filter((person) => person.id === 'me')).toHaveLength(1);
    expect(useFinancerStore.getState().people.filter((person) => person.id === friend.id)).toHaveLength(1);
  });

  it('shows a safe, actionable message when a sync change is rejected', async () => {
    const txn: Transaction = {
      id: '44444444-4444-4444-8444-444444444444', amount: 2500, categoryId: 'cat-0',
      place: 'Missing category test', note: '', paymentMode: 'cash', date: '2026-10-22',
      time: '12:00', createdAt: '2026-10-22T12:00:00.000Z', provenance: 'user',
    };
    useFinancerStore.setState({ transactions: [txn] });
    mockApiRequest.mockImplementation(async (path: string) => {
      if (path.startsWith('/sync/pull')) return { changes: [], next_cursor: 0, has_more: false };
      if (path === '/sync/push') return { results: [{
        resource: 'transaction', id: txn.id, status: 'rejected', reason_code: 'missing_reference',
        message: 'missing_reference: category does not exist',
      }] };
      throw new Error(`Unexpected route ${path}`);
    });
    const status = jest.fn();
    startSyncService(status);
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(status).toHaveBeenCalledWith('error', expect.stringContaining('needs attention'));
      expect(status).not.toHaveBeenCalledWith('error', expect.stringContaining('Missing category test'));
    } finally {
      stopSyncService();
    }
  });

  it('does not resend acknowledged changes after a partial push rejection', async () => {
    const accepted = { id: '66666666-6666-4666-8666-666666666666', amount: 1000, categoryId: 'cat-0', place: 'Accepted', note: '', paymentMode: 'cash', date: '2026-10-22', time: '12:00', createdAt: '2026-10-22T12:00:00.000Z', provenance: 'user' } as Transaction;
    const rejected = { ...accepted, id: '77777777-7777-4777-8777-777777777777', place: 'Rejected' };
    useFinancerStore.setState({ transactions: [accepted, rejected] });
    const state = useFinancerStore.getState();
    mockValues.set('paisa-sync:user-1:snapshot', JSON.stringify({
      category: state.categories, transaction: [], budget_period: state.monthBudgets,
      budget_allocation: state.budgetAllocations, person: state.people.filter((person) => !person.isMe),
      group_bill: state.groupBills, settlement: state.billSettlements,
    }));
    mockApiRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/sync/pull')) return { changes: [], next_cursor: 0, has_more: false };
      if (path === '/sync/push') {
        const changes = JSON.parse(String(init?.body)).changes as Array<{id: string; resource: string}>;
        return { results: changes.map((change) => ({ ...change, status: change.id === rejected.id ? 'rejected' : 'applied', reason_code: 'missing_reference' })) };
      }
      throw new Error(`Unexpected route ${path}`);
    });

    await syncNow();

    const pushes = mockApiRequest.mock.calls.filter(([path]) => path === '/sync/push');
    expect(pushes).toHaveLength(1);
    const savedSnapshot = JSON.parse(mockValues.get('paisa-sync:user-1:snapshot')!);
    expect(savedSnapshot.transaction.map((row: {id: string}) => row.id)).toContain(accepted.id);
    expect(savedSnapshot.transaction.map((row: {id: string}) => row.id)).not.toContain(rejected.id);
  });

  it('keeps a successful acknowledgement when the following pull temporarily fails', async () => {
    const txn = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', amount: 1200, categoryId: 'cat-0', place: 'Acked', note: '', paymentMode: 'upi', date: '2026-10-22', time: '12:00', createdAt: '2026-10-22T12:00:00.000Z', provenance: 'user' } as Transaction;
    useFinancerStore.setState({ transactions: [txn] });
    const state = useFinancerStore.getState();
    mockValues.set('paisa-sync:user-1:snapshot', JSON.stringify({ category: state.categories, transaction: [], budget_period: state.monthBudgets, budget_allocation: state.budgetAllocations, person: state.people.filter((person) => !person.isMe), group_bill: state.groupBills, settlement: state.billSettlements }));
    let pulls = 0;
    mockApiRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/sync/pull')) {
        pulls++;
        if (pulls === 2) throw Object.assign(new Error('network'), { status: 0 });
        return { changes: [], next_cursor: 0, has_more: false };
      }
      if (path === '/sync/push') return { results: JSON.parse(String(init?.body)).changes.map((change: {resource: string; id: string}) => ({ ...change, status: 'applied' })) };
      throw new Error(`Unexpected route ${path}`);
    });

    await syncNow();
    await syncNow(true);

    expect(mockApiRequest.mock.calls.filter(([path]) => path === '/sync/push')).toHaveLength(1);
  });

  it('does not background-retry permanent failures and allows an explicit retry', async () => {
    const rejected = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', amount: 1000, categoryId: 'cat-0', place: 'Needs category', note: '', paymentMode: 'cash', date: '2026-10-22', time: '12:00', createdAt: '2026-10-22T12:00:00.000Z', provenance: 'user' } as Transaction;
    const accepted = { ...rejected, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', place: 'Valid edit' };
    useFinancerStore.setState({ transactions: [rejected] });
    expect(useFinancerStore.getState().transactions.map((row) => row.id)).toContain(rejected.id);
    const state = useFinancerStore.getState();
    mockValues.set('paisa-sync:user-1:snapshot', JSON.stringify({ category: state.categories, transaction: [], budget_period: state.monthBudgets, budget_allocation: state.budgetAllocations, person: state.people.filter((person) => !person.isMe), group_bill: state.groupBills, settlement: state.billSettlements }));
    mockApiRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/sync/pull')) return { changes: [], next_cursor: 0, has_more: false };
      if (path === '/sync/push') {
        const changes = JSON.parse(String(init?.body)).changes as Array<{id: string; resource: string}>;
        return { results: changes.map((change) => ({ ...change, status: change.id === rejected.id ? 'rejected' : 'applied', reason_code: 'missing_reference' })) };
      }
      throw new Error(`Unexpected route ${path}`);
    });

    await syncNow();
    expect(useFinancerStore.getState().transactions.map((row) => row.id)).toContain(rejected.id);
    useFinancerStore.setState({ transactions: [accepted, rejected] });
    await syncNow();

    const pushes = mockApiRequest.mock.calls.filter(([path]) => path === '/sync/push');
    expect(pushes).toHaveLength(2);
    const secondPushIds = JSON.parse(String(pushes[1][1].body)).changes.map((change: {id: string}) => change.id);
    expect(secondPushIds).toContain(accepted.id);
    expect(secondPushIds).not.toContain(rejected.id);
    const snapshotAfterOtherEdit = JSON.parse(mockValues.get('paisa-sync:user-1:snapshot')!);
    expect(snapshotAfterOtherEdit.transaction.map((row: {id: string}) => row.id)).not.toContain(rejected.id);
    expect(useFinancerStore.getState().transactions.map((row) => row.id)).toContain(rejected.id);

    mockApiRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/sync/pull')) return { changes: [], next_cursor: 0, has_more: false };
      if (path === '/sync/push') return { results: JSON.parse(String(init?.body)).changes.map((change: {resource: string; id: string}) => ({ ...change, status: 'applied' })) };
      throw new Error(`Unexpected route ${path}`);
    });
    stopSyncService();
    await syncNow(true);
    const allPushes = mockApiRequest.mock.calls.filter(([path]) => path === '/sync/push');
    expect(allPushes).toHaveLength(3);
    expect(JSON.parse(String(allPushes[2][1].body)).changes.map((change: {id: string}) => change.id)).toContain(rejected.id);
  });

  it('coalesces concurrent sync calls into one push worker', async () => {
    let releasePush: (() => void) | undefined;
    let signalPushStarted: (() => void) | undefined;
    const pushStarted = new Promise<void>((resolve) => { signalPushStarted = resolve; });
    const txn = { id: '99999999-9999-4999-8999-999999999999', amount: 1000, categoryId: 'cat-0', place: 'Concurrent', note: '', paymentMode: 'cash', date: '2026-10-22', time: '12:00', createdAt: '2026-10-22T12:00:00.000Z', provenance: 'user' } as Transaction;
    useFinancerStore.setState({ transactions: [txn] });
    const state = useFinancerStore.getState();
    mockValues.set('paisa-sync:user-1:snapshot', JSON.stringify({ category: state.categories, transaction: [], budget_period: state.monthBudgets, budget_allocation: state.budgetAllocations, person: state.people.filter((person) => !person.isMe), group_bill: state.groupBills, settlement: state.billSettlements }));
    mockApiRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/sync/pull')) return { changes: [], next_cursor: 0, has_more: false };
      if (path === '/sync/push') {
        signalPushStarted?.();
        await new Promise<void>((resolve) => { releasePush = resolve; });
        return { results: JSON.parse(String(init?.body)).changes.map((change: {resource: string; id: string}) => ({ ...change, status: 'applied' })) };
      }
      throw new Error(`Unexpected route ${path}`);
    });
    const first = syncNow();
    await pushStarted;
    const second = syncNow();
    releasePush?.();
    await Promise.all([first, second]);
    expect(mockApiRequest.mock.calls.filter(([path]) => path === '/sync/push')).toHaveLength(1);
  });

  it('sends budget periods in the API YYYY-MM format', async () => {
    const budget: MonthBudget = {
      id: '55555555-5555-4555-8555-555555555555',
      month: '2026-10', totalPaise: 100_000, startDay: 1,
    };
    useFinancerStore.setState({ monthBudgets: [budget] });
    const state = useFinancerStore.getState();
    mockValues.set('paisa-sync:user-1:snapshot', JSON.stringify({
      category: state.categories, transaction: state.transactions, budget_period: [],
      budget_allocation: state.budgetAllocations, person: state.people.filter((person) => !person.isMe),
      group_bill: state.groupBills, settlement: state.billSettlements,
    }));
    let pushedChanges: Array<{resource: string; data: Record<string, unknown>}> = [];
    mockApiRequest.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/sync/pull')) return { changes: [], next_cursor: 0, has_more: false };
      if (path === '/sync/push') {
        pushedChanges = JSON.parse(String(init?.body)).changes;
        return { results: pushedChanges.map((change) => ({ ...change, status: 'applied' })) };
      }
      throw new Error(`Unexpected route ${path}`);
    });

    await syncNow();

    expect(pushedChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource: 'budget_period', data: expect.objectContaining({ month: '2026-10' }) }),
    ]));
  });

  it('never uploads an account dataset under a different active session', async () => {
    await activateStoreForUser('account-a');
    useFinancerStore.setState({ transactions: [{
      id: '88888888-8888-4888-8888-888888888888', amount: 1000, categoryId: 'cat-0',
      place: 'Account A offline edit', note: '', paymentMode: 'cash', date: '2026-10-22',
      time: '12:00', createdAt: '2026-10-22T12:00:00.000Z', provenance: 'user',
    } as Transaction] });
    await syncNow();
    expect(mockApiRequest).not.toHaveBeenCalled();
    await activateStoreForUser('user-1');
  });
});
