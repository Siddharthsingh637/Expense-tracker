const storedValues = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => storedValues.get(key) ?? null,
    setItem: async (key: string, value: string) => { storedValues.set(key, value); },
    removeItem: async (key: string) => { storedValues.delete(key); },
  },
}));

import { activateGuestStore, activateStoreForUser, usePaisaStore } from '../store';

describe('account-scoped local data', () => {
  beforeEach(() => {
    storedValues.clear();
  });

  it('quarantines legacy data as guest and restores each account without cross-account merge', async () => {
    const guestTxn = { id: 'txn-guest', place: 'Guest record' } as never;
    const firstTxn = { id: 'txn-first', place: 'Account A record' } as never;
    const secondTxn = { id: 'txn-second', place: 'Account B record' } as never;
    usePaisaStore.setState({ transactions: [guestTxn] });

    await activateStoreForUser('account-a');
    expect(usePaisaStore.getState().transactions).toEqual([]);
    usePaisaStore.setState({ transactions: [firstTxn] });

    await activateGuestStore();
    expect(usePaisaStore.getState().transactions).toEqual([guestTxn]);
    await activateStoreForUser('account-b');
    expect(usePaisaStore.getState().transactions).toEqual([]);
    usePaisaStore.setState({ transactions: [secondTxn] });

    await activateGuestStore();
    expect(usePaisaStore.getState().transactions).toEqual([guestTxn]);
    await activateStoreForUser('account-b');
    expect(usePaisaStore.getState().transactions).toEqual([secondTxn]);
    await activateStoreForUser('account-a');
    expect(usePaisaStore.getState().transactions).toEqual([firstTxn]);
  });
});
