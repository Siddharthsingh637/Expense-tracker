import AsyncStorage from '@react-native-async-storage/async-storage';

export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const TOKEN_KEY = 'paisa-auth-v1';

export interface AuthUser { id: string; email: string; role: string; is_active: boolean }
export interface AuthSession { user: AuthUser; access_token: string; refresh_token: string; expires_in: number }

let session: AuthSession | null = null;
let refreshPromise: Promise<AuthSession | null> | null = null;
let refreshOwnerId: string | undefined;
let refreshSequence = 0;
let sessionRevision = 0;

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}, authenticated = true, retried = false): Promise<T> {
  const requestOwnerId = authenticated ? session?.user.id : undefined;
  const headers = new Headers(init.headers);
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (init.body && !isFormData && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (authenticated && session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1${path}`, { ...init, headers });
  } catch {
    throw new ApiError(`Cannot reach the Paisa server at ${API_BASE_URL}. Check the server and API URL.`, 0, 'network_error');
  }
  if (response.status === 401 && authenticated && requestOwnerId && session?.user.id === requestOwnerId && !retried && session?.refresh_token) {
    const refreshed = await refreshSession();
    if (!refreshed || refreshed.user.id !== requestOwnerId || session?.user.id !== requestOwnerId) {
      throw new ApiError('Your session changed. Please sign in again.', 401, 'session_changed');
    }
    return request<T>(path, init, authenticated, true);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.error ?? body?.detail;
    const validationMessages = Array.isArray(detail?.details)
      ? detail.details.map((issue: { path?: string; message?: string }) => {
          const field = issue.path?.split('.').at(-1);
          return field && issue.message ? `${field}: ${issue.message}` : issue.message;
        }).filter(Boolean).join('; ')
      : '';
    const message = validationMessages || detail?.message || `Request failed (${response.status})`;
    throw new ApiError(message, response.status, detail?.code);
  }
  return body as T;
}

async function persistSession(next: AuthSession | null) {
  sessionRevision++;
  session = next;
  if (next) await AsyncStorage.setItem(TOKEN_KEY, JSON.stringify(next));
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

export async function restoreSession(): Promise<AuthSession | null> {
  try {
    const saved = await AsyncStorage.getItem(TOKEN_KEY);
    if (saved) session = JSON.parse(saved) as AuthSession;
  } catch { session = null; }
  // Earlier builds created local-only mock accounts when the API was unreachable.
  // Do not restore those as authenticated accounts; keep the local data and ask
  // the user to sign in or register with the backend to enable sync.
  if (session?.access_token.startsWith('mock-')) {
    await persistSession(null);
    return null;
  }
  if (session?.refresh_token) return (await refreshSession()) ?? null;
  return session;
}

async function refreshSession(): Promise<AuthSession | null> {
  if (!session?.refresh_token) return null;
  const ownerId = session.user.id;
  const refreshToken = session.refresh_token;
  const startedAtRevision = sessionRevision;
  if (!refreshPromise || refreshOwnerId !== ownerId) {
    refreshOwnerId = ownerId;
    const refreshId = ++refreshSequence;
    const ownerRefresh = (async () => {
      try {
        const next = await request<AuthSession>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) }, false);
        if (sessionRevision !== startedAtRevision || session?.user.id !== ownerId) return session;
        await persistSession(next);
        return next;
      } catch (error) {
        if (sessionRevision !== startedAtRevision || session?.user.id !== ownerId) return session;
        // Keep the offline session when the server cannot be reached. A rejected
        // refresh token is different: that requires signing in again.
        if (error instanceof ApiError && error.status === 0) return session;
        await persistSession(null);
        return null;
      } finally {
        if (refreshSequence === refreshId) {
          refreshPromise = null;
          refreshOwnerId = undefined;
        }
      }
    })();
    refreshPromise = ownerRefresh;
  }
  return refreshPromise;
}

export async function authenticate(mode: 'login' | 'register', email: string, password: string): Promise<AuthSession> {
  const next = await request<AuthSession>(
    `/auth/${mode}`,
    { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase(), password }) },
    false,
  );
  await persistSession(next);
  return next;
}


export async function signOut(): Promise<void> {
  const refreshToken = session?.refresh_token;
  // Start server revocation with the current credentials, then clear the local
  // session immediately so logout does not depend on network availability.
  if (refreshToken) {
    void request('/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) }).catch(() => undefined);
  }
  await persistSession(null);
}

export function hasSession(): boolean { return Boolean(session?.access_token); }
export function isMockSession(): boolean { return Boolean(session?.access_token?.startsWith('mock-')); }
export function currentUser(): AuthUser | null { return session?.user ?? null; }
export function accessToken(): string | null { return session?.access_token ?? null; }
export function apiRequest<T>(path: string, init?: RequestInit): Promise<T> { return request<T>(path, init); }
