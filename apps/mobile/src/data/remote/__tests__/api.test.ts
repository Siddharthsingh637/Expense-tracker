const mockStorage = new Map<string, string>();
const mockFetch = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => { mockStorage.set(key, value); },
    removeItem: async (key: string) => { mockStorage.delete(key); },
  },
}));

import { ApiError, apiRequest, authenticate, hasSession, isMockSession, restoreSession, signOut } from '../api';

describe('remote authentication', () => {
  beforeEach(() => {
    mockStorage.clear();
    mockFetch.mockReset();
    globalThis.fetch = mockFetch as typeof fetch;
  });

  it('reports unreachable API during registration instead of creating a local mock account', async () => {
    mockFetch.mockRejectedValue(new TypeError('Network request failed'));

    await expect(authenticate('register', 'person@example.com', 'password123'))
      .rejects.toMatchObject({ status: 0, code: 'network_error' });

    expect(isMockSession()).toBe(false);
    expect(mockStorage.has('paisa-auth-v1')).toBe(false);
  });

  it('clears legacy local-only mock sessions while preserving other local data', async () => {
    mockStorage.set('paisa-auth-v1', JSON.stringify({
      user: { id: 'user-local-1', email: 'person@example.com', role: 'user', is_active: true },
      access_token: 'mock-token-1',
      refresh_token: 'mock-refresh-1',
      expires_in: 86400,
    }));
    mockStorage.set('paisa-sync:user-local-1:snapshot', '{"kept":true}');

    await expect(restoreSession()).resolves.toBeNull();

    expect(mockStorage.has('paisa-auth-v1')).toBe(false);
    expect(mockStorage.get('paisa-sync:user-local-1:snapshot')).toBe('{"kept":true}');
  });

  it('shows the backend field reason for invalid registration input', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: [{ path: 'body.password', message: 'String should have at least 12 characters' }],
        },
      }),
    });

    await expect(authenticate('register', 'person@example.com', 'short'))
      .rejects.toMatchObject({
        message: 'password: String should have at least 12 characters',
        status: 422,
      } satisfies Partial<ApiError>);
  });

  it('clears the local session when the server is unreachable during sign out', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        user: { id: 'user-logout', email: 'person@example.com', role: 'user', is_active: true },
        access_token: 'access-token',
        refresh_token: 'refresh-token-with-enough-length',
        expires_in: 900,
      }),
    });
    await authenticate('login', 'person@example.com', 'password');
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(signOut()).resolves.toBeUndefined();

    expect(hasSession()).toBe(false);
    expect(mockStorage.has('paisa-auth-v1')).toBe(false);
  });

  it('clears local auth without waiting for a slow logout request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        user: { id: 'user-logout-slow', email: 'person@example.com', role: 'user', is_active: true },
        access_token: 'access-token', refresh_token: 'refresh-token-with-enough-length', expires_in: 900,
      }),
    });
    await authenticate('login', 'person@example.com', 'password');
    mockFetch.mockImplementationOnce(() => new Promise(() => undefined));

    await signOut();

    expect(hasSession()).toBe(false);
    expect(mockStorage.has('paisa-auth-v1')).toBe(false);
  });

  it('does not restore or retry an old request after logout wins an in-flight refresh', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        user: { id: 'user-refresh-race', email: 'person@example.com', role: 'user', is_active: true },
        access_token: 'access-token', refresh_token: 'refresh-token-with-enough-length', expires_in: 900,
      }),
    });
    await authenticate('login', 'person@example.com', 'password');
    let signalRefresh: (() => void) | undefined;
    let resolveRefresh: ((response: unknown) => void) | undefined;
    const refreshStarted = new Promise<void>((resolve) => { signalRefresh = resolve; });
    mockFetch.mockImplementation((url: string) => {
      if (url.endsWith('/protected')) return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
      if (url.endsWith('/auth/refresh')) {
        signalRefresh?.();
        return new Promise((resolve) => { resolveRefresh = resolve; });
      }
      if (url.endsWith('/auth/logout')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
      throw new Error('Unexpected request');
    });

    const protectedRequest = apiRequest('/protected');
    await refreshStarted;
    await signOut();
    resolveRefresh?.({
      ok: true, status: 200,
      json: async () => ({
        user: { id: 'user-refresh-race', email: 'person@example.com', role: 'user', is_active: true },
        access_token: 'new-access-token', refresh_token: 'new-refresh-token-with-enough-length', expires_in: 900,
      }),
    });

    await expect(protectedRequest).rejects.toMatchObject({ code: 'session_changed' });
    expect(hasSession()).toBe(false);
    expect(mockFetch.mock.calls.filter(([url]) => String(url).endsWith('/protected'))).toHaveLength(1);
  });
});
