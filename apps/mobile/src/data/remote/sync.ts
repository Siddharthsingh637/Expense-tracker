import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Category, Transaction, MonthBudget, BudgetAllocation, Person, GroupBill, BillSettlement } from '@/engine/types';
import { apiRequest, currentUser, hasSession, isMockSession } from './api';
import { activeStoreUser, useFinancerStore } from '../local/store';
import { sha256 } from './sha256';

type Resource = 'category' | 'transaction' | 'budget_period' | 'budget_allocation' | 'person' | 'group_bill' | 'settlement' | 'user_settings';
type PullResource = Resource | 'user_settings' | 'budget_transfer' | 'attachment' | 'place_rule';
type Change = { resource: Resource; id: string; op: 'upsert' | 'delete'; updated_at: string; data: Record<string, unknown>; group_id?: string };
type PullPage = { changes: Array<{resource: PullResource; id: string; op: 'upsert' | 'delete'; sync_seq: number; updated_at?: string; deleted_at?: string; data: Record<string, any>}>; next_cursor: number; has_more: boolean };
type PushResult = { results: Array<{resource: Resource; id: string; status: string; reason_code?: string; message?: string}> };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keyFor = (userId: string, key: 'cursor' | 'snapshot' | 'settingsId' | 'blocked') => `paisa-sync:${userId}:${key}`;
let running = false;
let scheduled: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let unsubscribe: (() => void) | undefined;
let syncStatusListener: ((status: 'idle' | 'syncing' | 'error', message?: string) => void) | undefined;
let remoteSettingsId: string | undefined;
let settingsOwner: string | undefined;
let retryAttempt = 0;
let activeSyncUser: string | undefined;

function assertSyncOwner(userId: string): void {
  if (currentUser()?.id !== userId || (activeStoreUser() && activeStoreUser() !== userId)) {
    throw Object.assign(new Error('Sync stopped because the active account changed.'), { category: 'account_changed' });
  }
}

function stableUuid(value: string): string {
  let hashes = [2166136261, 2246822519, 3266489917, 668265263];
  for (let i = 0; i < value.length; i++) {
    hashes = hashes.map((hash, index) => Math.imul(hash ^ (value.charCodeAt(i) + index), 16777619 + index * 2));
  }
  const raw = hashes.map((hash) => (hash >>> 0).toString(16).padStart(8, '0')).join('');
  const normalized = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-5${raw.slice(13, 16)}-${((parseInt(raw[16], 16) & 3) | 8).toString(16)}${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
  return normalized;
}

function makeIdsSyncable(): void {
  const state = useFinancerStore.getState();
  const remap = new Map<string, string>();
  const id = (value: string) => {
    if (!value || value === 'me' || /^cat-[0-8]$/.test(value) || uuidPattern.test(value)) return value;
    if (!remap.has(value)) remap.set(value, stableUuid(value));
    return remap.get(value)!;
  };
  const record = (value: Record<string, number> | undefined) => value && Object.fromEntries(Object.entries(value).map(([key, amount]) => [id(key), amount]));
  const categories = state.categories.map((row) => ({ ...row, id: id(row.id) }));
  const transactions = state.transactions.map((row) => ({ ...row, id: id(row.id), categoryId: id(row.categoryId), splitId: row.splitId ? id(row.splitId) : undefined }));
  const monthBudgets = state.monthBudgets.map((row) => ({ ...row, id: id(row.id) }));
  const budgetAllocations = state.budgetAllocations.map((row) => ({ ...row, id: id(row.id), categoryId: id(row.categoryId) }));
  const people = state.people.map((row) => row.isMe ? row : ({ ...row, id: id(row.id) }));
  const groupBills = state.groupBills.map((row) => ({
    ...row, id: id(row.id), categoryId: row.categoryId ? id(row.categoryId) : undefined,
    personIds: row.personIds.map(id), payments: record(row.payments) ?? {},
    customShares: record(row.customShares), percentShares: record(row.percentShares), shareWeights: record(row.shareWeights),
    items: row.items?.map((item) => ({ ...item, id: id(item.id), assignedPersonIds: item.assignedPersonIds.map(id) })),
  }));
  const billSettlements = state.billSettlements.map((row) => ({ ...row, id: id(row.id), groupBillId: id(row.groupBillId), fromPersonId: id(row.fromPersonId), toPersonId: id(row.toPersonId) }));
  if (JSON.stringify({ categories, transactions, monthBudgets, budgetAllocations, people, groupBills, billSettlements }) !== JSON.stringify({ categories: state.categories, transactions: state.transactions, monthBudgets: state.monthBudgets, budgetAllocations: state.budgetAllocations, people: state.people, groupBills: state.groupBills, billSettlements: state.billSettlements })) {
    useFinancerStore.setState({ categories, transactions, monthBudgets, budgetAllocations, people, groupBills, billSettlements });
  }
}

function currentTracked(state: AppState) {
  const tracked: Record<string, any[]> = {
    category: [...state.categories],
    transaction: [...state.transactions],
    budget_period: [...state.monthBudgets],
    budget_allocation: [...state.budgetAllocations],
    person: state.people.filter((person) => !person.isMe),
    group_bill: [...state.groupBills],
    settlement: [...state.billSettlements],
  };
  if (remoteSettingsId) tracked.user_settings = [{
    id: remoteSettingsId,
    budgetStartDay: state.budgetStartDay,
    aiEnabled: state.aiEnabled,
    aiFeatureToggles: state.aiFeatureToggles,
  }];
  return tracked;
}

function preserveFailedChanges(
  baseline: Record<string, any[]>,
  previous: Record<string, any[]> | null,
  failed: PushResult['results'],
): void {
  for (const item of failed) {
    const bucket = baseline[item.resource] ?? [];
    const prior = (previous?.[item.resource] ?? []).find((row: {id: string}) => row.id === item.id);
    const index = bucket.findIndex((row: {id: string}) => row.id === item.id);
    if (index >= 0) bucket.splice(index, 1);
    if (prior) bucket.push(prior);
  }
}

function preserveUnacknowledgedChanges(
  baseline: Record<string, any[]>,
  previous: Record<string, any[]> | null,
  changes: Change[],
): void {
  for (const change of changes) {
    const bucket = baseline[change.resource] ?? [];
    const prior = (previous?.[change.resource] ?? []).find((row: {id: string}) => row.id === change.id);
    const index = bucket.findIndex((row: {id: string}) => row.id === change.id);
    if (index >= 0) bucket.splice(index, 1);
    if (prior) bucket.push(prior);
  }
}

function blockedKey(change: Change): string {
  return stableUuid(JSON.stringify({ resource: change.resource, id: change.id, op: change.op, data: change.data }));
}

function addBlockedChanges(blocked: Set<string>, changes: Change[]): void {
  for (const change of changes) blocked.add(blockedKey(change));
}

function resourceDate(value: any): string {
  return value?.createdAt && !Number.isNaN(Date.parse(value.createdAt)) ? value.createdAt : new Date().toISOString();
}

function changesSince(previous: Record<string, any[]> | null, state: AppState): Change[] {
  const now = new Date().toISOString();
  const current = currentTracked(state);
  const changes: Change[] = [];
  for (const resource of Object.keys(current) as Resource[]) {
    const oldRows = previous?.[resource] ?? [];
    const newRows = current[resource] as any[];
    const oldMap = new Map(oldRows.map((row) => [row.id, row]));
    const newMap = new Map(newRows.map((row) => [row.id, row]));
    for (const [id, row] of newMap) {
      if (!uuidPattern.test(id)) continue;
      if (JSON.stringify(oldMap.get(id)) === JSON.stringify(row)) continue;
      let data: Record<string, unknown> = { ...row };
      if (resource === 'budget_allocation') {
        const catExists = (current.category as Category[]).some((c) => c.id === row.categoryId);
        if (!catExists) continue;
      }
      if (resource === 'budget_period' || resource === 'budget_allocation') {
        if (typeof data.month === 'string' && data.month.length > 7) {
          data.month = data.month.slice(0, 7);
        }
      }
      if (resource === 'transaction') {
        data.local_time = row.time;
        delete data.time;
        delete data.isTransfer;
        if (!row.billPhotoUri || !row.billPhotoUri.startsWith('attachment:')) data.billPhotoUri = null;
      }
      changes.push({ resource, id, op: 'upsert', updated_at: now, data: { ...data, createdAt: resourceDate(row) } });
    }
    for (const [id] of oldMap) {
      if (!newMap.has(id) && uuidPattern.test(id)) changes.push({ resource, id, op: 'delete', updated_at: now, data: {} });
    }
  }
  // Keep dependent records inside the server's atomic groups where their IDs
  // make the relationship explicit.
  const billGroups = new Map<string, string>();
  for (const change of changes) if (change.resource === 'group_bill' && change.op === 'upsert') billGroups.set(change.id, `split:${change.id}`);
  for (const change of changes) {
    if (change.resource === 'settlement') change.group_id = billGroups.get(String(change.data.groupBillId)) ?? `split:${String(change.data.groupBillId)}`;
    if (change.resource === 'transaction' && change.data.splitId) change.group_id = billGroups.get(String(change.data.splitId)) ?? `split:${String(change.data.splitId)}`;
    if (change.resource === 'budget_period' || change.resource === 'budget_allocation') change.group_id = `budget:${String(change.data.month).slice(0, 7)}`;
  }
  const order: Resource[] = ['category', 'budget_period', 'person', 'group_bill', 'budget_allocation', 'settlement', 'transaction', 'user_settings'];
  return changes.sort((a, b) => order.indexOf(a.resource) - order.indexOf(b.resource));
}

async function pushChanges(changes: Change[], userId: string): Promise<PushResult['results']> {
  const results: PushResult['results'] = [];
  for (let offset = 0; offset < changes.length; offset += 500) {
    assertSyncOwner(userId);
    const batch = changes.slice(offset, offset + 500);
    const result = await apiRequest<PushResult>('/sync/push', { method: 'POST', body: JSON.stringify({ changes: batch }) });
    const received = new Map((result.results ?? []).map((item) => [`${item.resource}:${item.id}`, item]));
    for (const change of batch) {
      const acknowledgement = received.get(`${change.resource}:${change.id}`);
      results.push(acknowledgement && ['applied', 'unchanged'].includes(acknowledgement.status)
        ? acknowledgement
        : acknowledgement ?? { resource: change.resource, id: change.id, status: 'rejected', reason_code: 'missing_acknowledgement' });
    }
  }
  return results;
}

async function uploadPendingPhotos(userId: string): Promise<string[]> {
  const state = useFinancerStore.getState();
  const uploaded: string[] = [];
  for (const transaction of state.transactions) {
    assertSyncOwner(userId);
    const uri = transaction.billPhotoUri;
    if (!uri || uri.startsWith('attachment:') || !uuidPattern.test(transaction.id)) continue;
    const attachmentId = stableUuid(`paisa-receipt:${transaction.id}:${uri}`);
    const response = await fetch(uri);
    if (!response.ok) throw new Error(`Could not read receipt for ${transaction.place}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 5 * 1024 * 1024) throw new Error(`Receipt for ${transaction.place} exceeds the 5 MiB upload limit.`);
    const extension = uri.split('?')[0].split('.').pop()?.toLowerCase();
    const mimeType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
    assertSyncOwner(userId);
    await apiRequest(`/attachments/${attachmentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType, 'X-Checksum-SHA256': sha256(bytes), 'X-Transaction-ID': transaction.id },
      body: bytes as unknown as BodyInit,
    });
    assertSyncOwner(userId);
    useFinancerStore.setState((current) => ({
      transactions: current.transactions.map((item) => item.id === transaction.id ? { ...item, billPhotoUri: `attachment:${attachmentId}` } : item),
    }));
    uploaded.push(transaction.id);
  }
  return uploaded;
}

function applyPulledChanges(changes: PullPage['changes']) {
  const state = useFinancerStore.getState();
  const buckets: Record<string, any[]> = {
    category: [...state.categories], transaction: [...state.transactions], budget_period: [...state.monthBudgets],
    budget_allocation: [...state.budgetAllocations], person: state.people.filter((person) => !person.isMe), group_bill: [...state.groupBills], settlement: [...state.billSettlements],
  };
  const bucketKey: Partial<Record<PullResource, string>> = { category: 'category', transaction: 'transaction', budget_period: 'budget_period', budget_allocation: 'budget_allocation', person: 'person', group_bill: 'group_bill', settlement: 'settlement' };
  for (const change of changes) {
    if (change.resource === 'user_settings') {
      remoteSettingsId = change.data?.id ?? change.id;
      if (change.op === 'upsert' && !change.deleted_at) {
        const toggles = change.data.aiFeatureToggles ?? {};
        useFinancerStore.setState((current) => ({
          budgetStartDay: Number(change.data.budgetStartDay ?? current.budgetStartDay),
          aiEnabled: Boolean(change.data.aiEnabled ?? current.aiEnabled),
          aiFeatureToggles: {
            entryParsing: Boolean(toggles.entryParsing ?? current.aiFeatureToggles.entryParsing),
            categorization: Boolean(toggles.categorization ?? current.aiFeatureToggles.categorization),
            splitDrafting: Boolean(toggles.splitDrafting ?? current.aiFeatureToggles.splitDrafting),
            budgetSuggestions: Boolean(toggles.budgetSuggestions ?? current.aiFeatureToggles.budgetSuggestions),
            summaries: Boolean(toggles.summaries ?? current.aiFeatureToggles.summaries),
          },
        }));
      }
      continue;
    }
    const resourceBucket = bucketKey[change.resource];
    if (!resourceBucket) continue;
    const bucket = buckets[resourceBucket];
    const id = change.data?.id ?? change.id;
    let index = bucket.findIndex((row) => row.id === id);
    if (change.resource === 'category' && index < 0) {
      const legacyIndex = bucket.findIndex((row) => row.id === `cat-${change.data.sortOrder}` && row.name === change.data.name);
      if (legacyIndex >= 0) {
        bucket.splice(legacyIndex, 1);
      }
    }
    index = bucket.findIndex((row) => row.id === id);
    if (change.op === 'delete' || change.deleted_at) {
      if (index >= 0) bucket.splice(index, 1);
      continue;
    }
    const value = { ...change.data };
    if ((change.resource === 'budget_period' || change.resource === 'budget_allocation') && typeof value.month === 'string' && value.month.length > 7) {
      value.month = value.month.slice(0, 7);
    }
    if (index >= 0) bucket[index] = { ...bucket[index], ...value };
    else bucket.push(value);
  }
  const hasExistingBudgets = (buckets.budget_period as MonthBudget[]).length > 0;
  useFinancerStore.setState({
    categories: buckets.category as Category[], transactions: buckets.transaction as Transaction[],
    monthBudgets: buckets.budget_period as MonthBudget[], budgetAllocations: buckets.budget_allocation as BudgetAllocation[],
    people: [state.people.find((person) => person.isMe) ?? { id: 'me', name: 'Me', isMe: true, isArchived: false }, ...(buckets.person as Person[]).filter((person) => person.id !== 'me' && !person.isMe)],
    groupBills: buckets.group_bill as GroupBill[], billSettlements: buckets.settlement as BillSettlement[],
    ...(hasExistingBudgets ? { isOnboarded: true } : {}),
  });
}

async function pullChanges(userId: string): Promise<void> {
  let cursor = Number(await AsyncStorage.getItem(keyFor(userId, 'cursor'))) || 0;
  for (;;) {
    assertSyncOwner(userId);
    let page: PullPage;
    try { page = await apiRequest<PullPage>(`/sync/pull?cursor=${cursor}&limit=500`); }
    catch (error) {
      if ((error as {status?: number}).status !== 410) throw error;
      cursor = 0;
      await AsyncStorage.removeItem(keyFor(userId, 'cursor'));
      continue;
    }
    if (page.changes.length) {
      applyPulledChanges(page.changes);
      const settings = page.changes.find((change) => change.resource === 'user_settings');
      if (settings) await AsyncStorage.setItem(keyFor(userId, 'settingsId'), settings.data?.id ?? settings.id);
    }
    cursor = page.next_cursor;
    await AsyncStorage.setItem(keyFor(userId, 'cursor'), String(cursor));
    if (!page.has_more) break;
  }
}

function remapLegacyCategories(changes: Change[]): Change[] {
  const remoteByOrder = new Map(useFinancerStore.getState().categories.map((category) => [category.sortOrder, category.id]));
  const legacyId = (value: unknown) => typeof value === 'string' && /^cat-[0-8]$/.test(value)
    ? remoteByOrder.get(Number(value.slice(4))) ?? value : value;
  return changes.map((change) => ({ ...change, data: {
    ...change.data,
    ...(change.data.categoryId ? { categoryId: legacyId(change.data.categoryId) } : {}),
    ...(change.data.category_id ? { category_id: legacyId(change.data.category_id) } : {}),
  } }));
}

export async function syncNow(manual = false): Promise<void> {
  const user = currentUser();
  if (!hasSession() || !user || running || isMockSession() || (activeStoreUser() && activeStoreUser() !== user.id)) return;
  if (manual) retryAttempt = 0;
  running = true;
  activeSyncUser = user.id;
  syncStatusListener?.('syncing');
  let pendingForFailure: Change[] = [];
  try {
    assertSyncOwner(user.id);
    makeIdsSyncable();
    if (settingsOwner !== user.id) {
      settingsOwner = user.id;
      remoteSettingsId = (await AsyncStorage.getItem(keyFor(user.id, 'settingsId'))) ?? undefined;
    }
    const snapshotKey = keyFor(user.id, 'snapshot');
    const savedSnapshot = await AsyncStorage.getItem(snapshotKey);
    const snapshot = savedSnapshot ? JSON.parse(savedSnapshot) as Record<string, any[]> : null;
    const blockedKeyForUser = keyFor(user.id, 'blocked');
    const blocked = new Set<string>(JSON.parse((await AsyncStorage.getItem(blockedKeyForUser)) ?? '[]') as string[]);
    if (manual && blocked.size) {
      blocked.clear();
      await AsyncStorage.setItem(blockedKeyForUser, '[]');
    }
    // Capture local edits before pull, otherwise a newer server copy would
    // overwrite an offline edit before the diff is calculated.
    pendingForFailure = changesSince(snapshot, useFinancerStore.getState());
    const pendingLocalChanges = pendingForFailure.filter((change) => !blocked.has(blockedKey(change)));
    if (pendingForFailure.length && !pendingLocalChanges.length) {
      syncStatusListener?.('error', 'A change needs attention. Review it in Sync now before retrying.');
      return;
    }
    await pullChanges(user.id);
    let rejected: PushResult['results'] = [];
    let acknowledgedSnapshot: Record<string, any[]> | null = null;
    if (pendingLocalChanges.length) {
      rejected = (await pushChanges(remapLegacyCategories(pendingLocalChanges), user.id)).filter((item) => !['applied', 'unchanged'].includes(item.status));
      const rejectedKeys = new Set(rejected.map((item) => `${item.resource}:${item.id}`));
      addBlockedChanges(blocked, pendingLocalChanges.filter((change) => rejectedKeys.has(`${change.resource}:${change.id}`)));
      await AsyncStorage.setItem(blockedKeyForUser, JSON.stringify([...blocked]));
      const unacknowledged = pendingForFailure.filter((change) => blocked.has(blockedKey(change)));
      acknowledgedSnapshot = currentTracked(useFinancerStore.getState());
      preserveFailedChanges(acknowledgedSnapshot, snapshot, rejected);
      preserveUnacknowledgedChanges(acknowledgedSnapshot, snapshot, unacknowledged);
      // Persist each server acknowledgement before a subsequent pull can fail.
      await AsyncStorage.setItem(snapshotKey, JSON.stringify(acknowledgedSnapshot));
      await pullChanges(user.id);
      acknowledgedSnapshot = currentTracked(useFinancerStore.getState());
      preserveFailedChanges(acknowledgedSnapshot, snapshot, rejected);
      preserveUnacknowledgedChanges(acknowledgedSnapshot, snapshot, unacknowledged);
      // Persist accepted acknowledgements before another stage can fail.
      await AsyncStorage.setItem(snapshotKey, JSON.stringify(acknowledgedSnapshot));
    }
    const uploadedPhotoTransactions = await uploadPendingPhotos(user.id);
    if (uploadedPhotoTransactions.length) {
      const photoChanges = changesSince(acknowledgedSnapshot ?? snapshot, useFinancerStore.getState()).filter((change) =>
        change.resource === 'transaction' && uploadedPhotoTransactions.includes(change.id),
      );
      const photoFailures = (await pushChanges(photoChanges, user.id)).filter((item) => !['applied', 'unchanged'].includes(item.status));
      rejected.push(...photoFailures);
      const photoFailureKeys = new Set(photoFailures.map((item) => `${item.resource}:${item.id}`));
      addBlockedChanges(blocked, photoChanges.filter((change) => photoFailureKeys.has(`${change.resource}:${change.id}`)));
      await AsyncStorage.setItem(blockedKeyForUser, JSON.stringify([...blocked]));
      const photoBaseline = acknowledgedSnapshot;
      acknowledgedSnapshot = currentTracked(useFinancerStore.getState());
      preserveFailedChanges(acknowledgedSnapshot, photoBaseline, photoFailures);
      await AsyncStorage.setItem(snapshotKey, JSON.stringify(acknowledgedSnapshot));
      await pullChanges(user.id);
      const afterPhotoPush = currentTracked(useFinancerStore.getState());
      preserveFailedChanges(afterPhotoPush, acknowledgedSnapshot, photoFailures);
      acknowledgedSnapshot = afterPhotoPush;
    }
    assertSyncOwner(user.id);
    acknowledgedSnapshot ??= currentTracked(useFinancerStore.getState());
    // Keep server-accepted changes acknowledged, while retaining the prior
    // baseline for rejected/stale records so user edits remain queued.
    for (const failed of rejected) {
      const bucket = acknowledgedSnapshot[failed.resource] ?? [];
      const prior = (snapshot?.[failed.resource] ?? []).find((row: {id: string}) => row.id === failed.id);
      const index = bucket.findIndex((row: {id: string}) => row.id === failed.id);
      if (index >= 0) bucket.splice(index, 1);
      if (prior) bucket.push(prior);
    }
    await AsyncStorage.setItem(snapshotKey, JSON.stringify(acknowledgedSnapshot));
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
    retryAttempt = 0;
    if (rejected.length) {
      const first = rejected[0];
      const category = first.status === 'stale' ? 'conflict' : first.reason_code ?? 'validation';
      const resources = [...new Set(rejected.map((item) => item.resource))].join(', ');
      const reason = rejected.some((item) => item.reason_code === 'missing_reference')
        ? 'a related record is missing'
        : rejected.some((item) => item.status === 'stale') ? 'a newer server version needs review' : 'a record needs correction';
      console.warn(`[sync] user=${user.id} operation=push category=${category} rejected=${rejected.length}`);
      syncStatusListener?.('error', `Sync needs attention: ${resources} — ${reason}. Your edits remain saved here; use Sync now after correcting the related data.`);
    } else syncStatusListener?.('idle');
  } catch (error) {
    const category = (error as { category?: string; status?: number })?.category
      ?? ((error as {status?: number})?.status === 0 ? 'network' : (error as {status?: number})?.status && (error as {status?: number}).status! >= 500 ? 'server' : 'permanent');
    console.warn(`[sync] user=${user.id} operation=${activeSyncUser === user.id ? 'sync' : 'cancelled'} category=${category}`);
    if (category !== 'account_changed') syncStatusListener?.('error', 'Sync could not finish. Your local changes are saved on this device; check your connection or use Sync now.');
    const transient = category === 'network' || category === 'server';
    if (!transient && pendingForFailure.length && hasSession() && currentUser()?.id === user.id) {
      try {
        const blockedKeyForUser = keyFor(user.id, 'blocked');
        const blocked = new Set<string>(JSON.parse((await AsyncStorage.getItem(blockedKeyForUser)) ?? '[]') as string[]);
        addBlockedChanges(blocked, pendingForFailure);
        await AsyncStorage.setItem(blockedKeyForUser, JSON.stringify([...blocked]));
      } catch { /* Keep the original unsynced data if storage is unavailable. */ }
    }
    if (transient && hasSession() && currentUser()?.id === user.id && retryAttempt < 3 && !retryTimer) {
      const delay = 1_000 * (3 ** retryAttempt++);
      retryTimer = setTimeout(() => { retryTimer = undefined; void syncNow(); }, delay);
    }
  } finally { running = false; activeSyncUser = undefined; }
}

export function startSyncService(onStatus?: (status: 'idle' | 'syncing' | 'error', message?: string) => void): void {
  syncStatusListener = onStatus;
  if (isMockSession()) {
    syncStatusListener?.('idle');
    return;
  }
  if (unsubscribe) return;

  unsubscribe = useFinancerStore.subscribe((state, previous) => {
    if (JSON.stringify(currentTracked(state)) === JSON.stringify(currentTracked(previous))) return;
    if (scheduled) clearTimeout(scheduled);
    scheduled = setTimeout(() => { void syncNow(); }, 900);
  });
  void syncNow();
}

export function stopSyncService(): void {
  unsubscribe?.();
  unsubscribe = undefined;
  if (scheduled) clearTimeout(scheduled);
  if (retryTimer) clearTimeout(retryTimer);
  scheduled = undefined;
  retryTimer = undefined;
  syncStatusListener = undefined;
}
