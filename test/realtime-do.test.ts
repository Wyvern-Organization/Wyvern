import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src';
import { resetRepository } from '../src/lib/state';

async function api(path: string, init?: RequestInit) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`https://example.com${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function registerAndToken(username: string) {
  const register = await api('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, email: `${username}@example.com`, password: 'correct horse battery', accepted_legal: true, terms_version: '2026-05-22', privacy_version: '2026-05-22' }),
  });
  const body = await register.json() as { data: { tokens: { access_token: string } } };
  return body.data.tokens.access_token;
}

describe('wyvern realtime durable object', () => {
  beforeEach(() => {
    resetRepository(env);
  });

  it('exposes durable object realtime verification endpoints', async () => {
    const token = await registerAndToken('do-user');

    const diagnostics = await api('/api/v1/runtime/diagnostics', { headers: { authorization: `Bearer ${token}` } });
    expect(diagnostics.status).toBe(200);
    const diagnosticsBody = await diagnostics.json() as { data: { realtime_mode: string; bindings: { realtime_hub: boolean } } };
    expect(diagnosticsBody.data.realtime_mode).toBe('durable_object');
    expect(diagnosticsBody.data.bindings.realtime_hub).toBe(true);

    const verifyConnect = await api('/api/v1/runtime/verify/realtime-connect', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(verifyConnect.status).toBe(200);
    const verifyConnectBody = await verifyConnect.json() as { data: { backend: string; connect_ready: boolean; user_id: string } };
    expect(verifyConnectBody.data.backend).toBe('durable_object');
    expect(verifyConnectBody.data.connect_ready).toBe(true);
    expect(verifyConnectBody.data.user_id).toBeTruthy();

    const verifyHub = await api('/api/v1/runtime/verify/realtime-hub', { headers: { authorization: `Bearer ${token}` } });
    expect(verifyHub.status).toBe(200);
    const verifyHubBody = await verifyHub.json() as { data: { backend: string; snapshot: { sessions: number; channels: string[] } } };
    expect(verifyHubBody.data.backend).toBe('durable_object');
    expect(Array.isArray(verifyHubBody.data.snapshot.channels)).toBe(true);
  });
});
