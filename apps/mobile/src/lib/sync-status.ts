import { create } from 'zustand';

interface SyncStatus {
  status: 'idle' | 'syncing' | 'error';
  message?: string;
  lastSyncedAt?: string;
  setStatus(status: SyncStatus['status'], message?: string): void;
}
export const useSyncStatus = create<SyncStatus>((set, get) => ({
  status: 'idle',
  lastSyncedAt: undefined,
  setStatus: (status, message) => {
    const current = get();
    const lastSyncedAt = status === 'idle' ? new Date().toISOString() : current.lastSyncedAt;
    if (current.status === status && current.message === message && current.lastSyncedAt === lastSyncedAt) return;
    set({ status, message, lastSyncedAt });
  },
}));
