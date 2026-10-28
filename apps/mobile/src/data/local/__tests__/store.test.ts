const storedValues = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => storedValues.get(key) ?? null,
    setItem: async (key: string, value: string) => { storedValues.set(key, value); },
    removeItem: async (key: string) => { storedValues.delete(key); },
  },
}));

import { activateGuestStore, activateStoreForUser, useFinancerStore } from '../store';

describe('account-scoped local data', () => {
  beforeEach(() => {
    storedValues.clear();
  });

  it('quarantines legacy data as guest and restores each account without cross-account merge', async () => {
    const guestTxn = { id: 'txn-guest', place: 'Guest record' } as never;
    const firstTxn = { id: 'txn-first', place: 'Account A record' } as never;
    const secondTxn = { id: 'txn-second', place: 'Account B record' } as never;
    useFinancerStore.setState({ transactions: [guestTxn] });

    await activateStoreForUser('account-a');
    expect(useFinancerStore.getState().transactions).toEqual([]);
    useFinancerStore.setState({ transactions: [firstTxn] });

    await activateGuestStore();
    expect(useFinancerStore.getState().transactions).toEqual([guestTxn]);
    await activateStoreForUser('account-b');
    expect(useFinancerStore.getState().transactions).toEqual([]);
    useFinancerStore.setState({ transactions: [secondTxn] });

    await activateGuestStore();
    expect(useFinancerStore.getState().transactions).toEqual([guestTxn]);
    await activateStoreForUser('account-b');
    expect(useFinancerStore.getState().transactions).toEqual([secondTxn]);
    await activateStoreForUser('account-a');
    expect(useFinancerStore.getState().transactions).toEqual([firstTxn]);
  });

  it('preserves guest data and onboarding state across activations', async () => {
    await activateGuestStore();
    const guestTxn = { id: 'txn-guest-persist', place: 'Cafe Coffee Day' } as never;
    useFinancerStore.setState({ transactions: [guestTxn], isOnboarded: true });

    // Reactivate guest store
    await activateGuestStore();
    expect(useFinancerStore.getState().transactions).toEqual([guestTxn]);
    expect(useFinancerStore.getState().isOnboarded).toBe(true);
  });
});
