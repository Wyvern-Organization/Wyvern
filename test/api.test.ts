import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src';
import { resetShimRealtimeState } from '../src/routes/api';
import { resetRepository } from '../src/lib/state';
import { bindTestSocket } from './realtime.helpers';
import { resetRateLimits } from '../src/lib/rate-limit';
import { signBridgePayload } from '../src/lib/security';
import { runScheduledBackup } from '../src/lib/backups';

async function api(path: string, init?: RequestInit) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`https://example.com${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

const gitEncoder = new TextEncoder();

function gitBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function gitHexBytes(value: string): Uint8Array {
  const output = new Uint8Array(value.length / 2);
  for (let index = 0; index < output.length; index += 1) output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return output;
}

async function gitSha(type: string, content: Uint8Array): Promise<string> {
  const raw = gitBytes(gitEncoder.encode(`${type} ${content.length}\0`), content);
  const digest = await crypto.subtle.digest('SHA-1', raw);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
}

function gitPackHeader(type: number, size: number): Uint8Array {
  const values: number[] = [];
  let remaining = size >>> 4;
  values.push((type << 4) | (size & 0x0f) | (remaining ? 0x80 : 0));
  while (remaining) {
    const next = remaining & 0x7f;
    remaining >>>= 7;
    values.push(next | (remaining ? 0x80 : 0));
  }
  return Uint8Array.from(values);
}

async function gitZlib(value: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([value]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gitPack(objects: Array<{ type: number; content: Uint8Array }>): Promise<Uint8Array> {
  const header = new Uint8Array(12);
  header.set(gitEncoder.encode('PACK'));
  new DataView(header.buffer).setUint32(4, 2);
  new DataView(header.buffer).setUint32(8, objects.length);
  const objectBytes = await Promise.all(objects.map(async (object) => gitBytes(gitPackHeader(object.type, object.content.length), await gitZlib(object.content))));
  const withoutTrailer = gitBytes(header, ...objectBytes);
  const digest = await crypto.subtle.digest('SHA-1', withoutTrailer);
  return gitBytes(withoutTrailer, new Uint8Array(digest));
}

function gitPacket(value: string): Uint8Array {
  return gitEncoder.encode(`${(value.length + 4).toString(16).padStart(4, '0')}${value}`);
}

async function registerAndToken(username: string, email?: string) {
  const register = await api('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, email: email || `${username}@example.com`, password: 'correct horse battery', accepted_legal: true, terms_version: '2026-05-22', privacy_version: '2026-05-22' }),
  });
  const body = await register.json() as { data: { user: { id: string }; tokens: { access_token: string } } };
  // Existing non-verification tests exercise features after a verified user has
  // completed the mail flow. Keep that fixture local to tests rather than
  // weakening production verification requirements.
  const user = env.__APP_STATE__?.users[body.data.user.id];
  const verification = env.__APP_STATE__?.emailVerifications[body.data.user.id];
  if (user && verification) {
    const verifiedAt = new Date().toISOString();
    user.email_verified_at = verifiedAt;
    verification.status = 'verified';
    verification.verified_at = verifiedAt;
    verification.code_hash = null;
    verification.expires_at = null;
  }
  return body.data.tokens.access_token;
}

async function registerAndSession(username: string, email?: string) {
  const token = await registerAndToken(username, email);
  const meResponse = await api('/api/v1/users/me', { headers: { authorization: `Bearer ${token}` } });
  const meBody = await meResponse.json() as { data: { id: string; username: string } };
  return { token, user: meBody.data };
}

async function registerUnverified(username: string, email?: string) {
  const register = await api('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, email: email || `${username}@example.com`, password: 'correct horse battery', accepted_legal: true, terms_version: '2026-05-22', privacy_version: '2026-05-22' }),
  });
  const body = await register.json() as { data: { user: { id: string }; tokens: { access_token: string } } };
  return { response: register, token: body.data.tokens.access_token, userId: body.data.user.id };
}

async function openSocket(token: string) {
  const response = await api(`/api/v1/ws?token=${encodeURIComponent(token)}`, {
    headers: { Upgrade: 'websocket' }
  });
  expect(response.status).toBe(101);
  return bindTestSocket((response as Response & { webSocket?: WebSocket }).webSocket!);
}

function messageHasUserId(message: { data?: Record<string, unknown> }, userId: string) {
  const userIds = message.data?.user_ids;
  return Array.isArray(userIds) && userIds.includes(userId);
}

async function waitForShimSessions(token: string, expected: number) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const snapshot = await api('/api/v1/ws/snapshot', { headers: { authorization: `Bearer ${token}` } });
    const snapshotBody = await snapshot.json() as { data: { sessions: number } };
    if (snapshotBody.data.sessions === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for shim sessions=${expected}`);
}

describe('wyvern workers api', () => {
  beforeEach(() => {
    resetRepository(env);
    resetShimRealtimeState(env);
    resetRateLimits(env);
    env.ADMIN_ALLOWLIST = '';
    env.SMTP2GO_API_KEY = undefined as never;
    env.SMTP2GO_DEFAULT_FROM = undefined as never;
    env.SMTP2GO_DEFAULT_FROM_NAME = undefined as never;
    env.EMAIL_VERIFICATION_REQUIRED_VERSION = '0';
    env.STRIPE_SECRET_KEY = undefined as never;
    env.STRIPE_WEBHOOK_SECRET = undefined as never;
    env.STRIPE_PRICE_ID = undefined as never;
    env.STRIPE_SUCCESS_URL = undefined as never;
    env.STRIPE_CANCEL_URL = undefined as never;
    env.STRIPE_PORTAL_RETURN_URL = undefined as never;
    env.MALWARE_SCANNER_URL = undefined as never;
    env.MALWARE_SCANNER_SECRET = undefined as never;
    env.__REALTIME_TEST__ = { events: [], sockets: 0, subscriptions: {}, typingUsers: {}, voiceParticipants: {}, messages: [] };
  });

  it('returns health payload', async () => {
    const response = await api('/api/v1/health');
    expect(response.status).toBe(200);
    const rootHealth = await api('/health');
    expect(rootHealth.status).toBe(200);
    expect(rootHealth.headers.get('cache-control')).toBe('no-store');
  });

  it('supports auth and me', async () => {
    const token = await registerAndToken('axel');
    const meResponse = await api('/api/v1/users/me', { headers: { authorization: `Bearer ${token}` } });
    expect(meResponse.status).toBe(200);
    const meBody = await meResponse.json() as { data: { username: string } };
    expect(meBody.data.username).toBe('axel');

    const wyvHandoff = await api('/api/v1/auth/wyv-handoff', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(wyvHandoff.status).toBe(200);
    const edgeHandoff = await api('/api/v1/auth/edge-handoff', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(edgeHandoff.status).toBe(200);
    const edgeGrant = await edgeHandoff.json() as { data: { grant: string } };
    const edgeExchange = await api('/api/v1/auth/edge-exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant: edgeGrant.data.grant }) });
    expect(edgeExchange.status).toBe(200);
    const edgeExchangeBody = await edgeExchange.json() as { data: { user: { id: string; username: string } } };
    expect(edgeExchangeBody.data.user.username).toBe('axel');
  });

  it('requires SMTP2GO email-code verification before protected actions', async () => {
    env.SMTP2GO_API_KEY = 'smtp-test-key';
    env.SMTP2GO_DEFAULT_FROM = 'noreply@wyvernhub.net';
    const unverified = await registerUnverified('verifyme');
    const tokenHeaders = { authorization: `Bearer ${unverified.token}`, 'content-type': 'application/json' };

    const protectedToken = await api('/api/v1/api-tokens', {
      method: 'POST', headers: tokenHeaders, body: JSON.stringify({ name: 'blocked' }),
    });
    expect(protectedToken.status).toBe(403);

    const smtpFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ result: 'success', data: { email_id: 'verification-1' } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    try {
      const request = await api('/api/v1/auth/verification/request', { method: 'POST', headers: { authorization: `Bearer ${unverified.token}` } });
      expect(request.status).toBe(200);
      const [, init] = smtpFetch.mock.calls[0] || [];
      const mail = JSON.parse(String(init?.body || '{}')) as { text_body?: string; sender?: string; to?: string[] };
      expect(mail.sender).toContain('noreply@wyvernhub.net');
      expect(mail.to).toEqual(['verifyme@example.com']);
      const code = mail.text_body?.match(/\b(\d{6})\b/)?.[1];
      expect(code).toBeTruthy();

      const incorrect = await api('/api/v1/auth/verification/confirm', {
        method: 'POST', headers: tokenHeaders, body: JSON.stringify({ code: '000000' }),
      });
      expect(incorrect.status).toBe(400);
      const confirmed = await api('/api/v1/auth/verification/confirm', {
        method: 'POST', headers: tokenHeaders, body: JSON.stringify({ code }),
      });
      expect(confirmed.status).toBe(200);
      const confirmedBody = await confirmed.json() as { data: { verified: boolean } };
      expect(confirmedBody.data.verified).toBe(true);
    } finally {
      smtpFetch.mockRestore();
    }

    const tokenAfterVerification = await api('/api/v1/api-tokens', {
      method: 'POST', headers: tokenHeaders, body: JSON.stringify({ name: 'allowed' }),
    });
    expect(tokenAfterVerification.status).toBe(200);
  });

  it('requires a fresh email verification when the policy version advances', async () => {
    const token = await registerAndToken('reverifylogin');
    const user = Object.values(env.__APP_STATE__!.users).find((item) => item.email === 'reverifylogin@example.com')!;
    const verification = env.__APP_STATE__!.emailVerifications[user.id];
    user.email_verified_at = '2026-01-01T00:00:00.000Z';
    verification.status = 'verified';
    verification.verified_at = user.email_verified_at;
    env.EMAIL_VERIFICATION_REQUIRED_VERSION = '1';

    // Existing sessions are not revoked, but the next authenticated app load prompts for a fresh code.
    expect((await api('/api/v1/users/me', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);

    const login = await api('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'correct horse battery' }),
    });
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ data: { email_verification_required: true, user: { email_verified: false } } });
    expect(user.email_verified_at).toBeNull();
    expect(env.__APP_STATE__!.emailVerifications[user.id]).toMatchObject({ status: 'pending', code_hash: null, verified_at: null, failed_attempt_count: 0, locked_until: null });
  });

  it('marks an unverified account as verification-required at login', async () => {
    const unverified = await registerUnverified('loginverifygate');
    const user = env.__APP_STATE__!.users[unverified.userId];

    const login = await api('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'correct horse battery' }),
    });

    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ data: { email_verification_required: true, user: { email_verified: false } } });
  });

  it('recovers a password with a time-limited email code and revokes refresh sessions', async () => {
    env.SMTP2GO_API_KEY = 'smtp-test-key';
    await registerAndToken('recoverme');
    const user = Object.values(env.__APP_STATE__!.users).find((item) => item.email === 'recoverme@example.com')!;
    const smtpFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      result: 'success',
      data: { email_id: 'password-recovery' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const request = await api('/api/v1/auth/password-reset/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email }),
    });
    expect(request.status).toBe(200);
    const smtpPayload = JSON.parse(String((smtpFetch.mock.calls[0]?.[1] as RequestInit)?.body || '{}'));
    const code = String(smtpPayload.text_body).match(/\b\d{6}\b/)?.[0];
    expect(code).toMatch(/^\d{6}$/);
    expect((await api('/api/v1/auth/password-reset/confirm', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, code: '000000', password: 'new correct horse battery' }),
    })).status).toBe(400);
    expect((await api('/api/v1/auth/password-reset/confirm', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, code, password: 'new correct horse battery' }),
    })).status).toBe(200);
    expect((await api('/api/v1/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password: 'correct horse battery' }),
    })).status).toBe(401);
    expect((await api('/api/v1/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password: 'new correct horse battery' }),
    })).status).toBe(200);
    expect(Object.values(env.__APP_STATE__!.refreshTokens).filter((item) => item.user_id === user.id).some((item) => item.is_revoked)).toBe(true);
    smtpFetch.mockRestore();
  });

  it('enforces verification resend cooldown, five attempts, expiry, and client-IP throttling', async () => {
    env.SMTP2GO_API_KEY = 'smtp-test-key';
    const smtpFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ result: 'success', data: { email_id: 'verification-policy' } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    try {
      const locked = await registerUnverified('verifylocked');
      expect((await api('/api/v1/auth/verification/request', { method: 'POST', headers: { authorization: `Bearer ${locked.token}`, 'x-forwarded-for': '203.0.113.9' } })).status).toBe(200);
      expect((await api('/api/v1/auth/verification/request', { method: 'POST', headers: { authorization: `Bearer ${locked.token}`, 'x-forwarded-for': '203.0.113.9' } })).status).toBe(429);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await api('/api/v1/auth/verification/confirm', { method: 'POST', headers: { authorization: `Bearer ${locked.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ code: '000000' }) })).status).toBe(400);
      }
      expect((await api('/api/v1/auth/verification/confirm', { method: 'POST', headers: { authorization: `Bearer ${locked.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ code: '000000' }) })).status).toBe(429);

      const expiring = await registerUnverified('verifyexpired');
      expect((await api('/api/v1/auth/verification/request', { method: 'POST', headers: { authorization: `Bearer ${expiring.token}`, 'x-forwarded-for': '203.0.113.10' } })).status).toBe(200);
      env.__APP_STATE__!.emailVerifications[expiring.userId].expires_at = new Date(Date.now() - 1000).toISOString();
      expect((await api('/api/v1/auth/verification/confirm', { method: 'POST', headers: { authorization: `Bearer ${expiring.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ code: '000000' }) })).status).toBe(400);

      for (let index = 0; index < 5; index += 1) {
        const account = await registerUnverified(`verifyip${index}`);
        expect((await api('/api/v1/auth/verification/request', { method: 'POST', headers: { authorization: `Bearer ${account.token}`, 'x-forwarded-for': '203.0.113.77' } })).status).toBe(200);
      }
      const blockedByIp = await registerUnverified('verifyipblocked');
      expect((await api('/api/v1/auth/verification/request', { method: 'POST', headers: { authorization: `Bearer ${blockedByIp.token}`, 'x-forwarded-for': '203.0.113.77' } })).status).toBe(429);
    } finally {
      smtpFetch.mockRestore();
    }
  });

  it('disables subscriptions while granting universal Premium access', async () => {
    const token = await registerAndToken('universalpremium');
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    expect((await api('/api/v1/billing/checkout', { method: 'POST', headers, body: JSON.stringify({}) })).status).toBe(410);
    expect((await api('/api/v1/billing/portal', { method: 'POST', headers, body: JSON.stringify({}) })).status).toBe(410);

    const webhook = await api('/api/v1/billing/webhook', { method: 'POST', body: '{}' });
    expect(webhook.status).toBe(200);
    expect(await webhook.json()).toMatchObject({ data: { subscriptions_enabled: false } });

    const entitlement = await api('/api/v1/billing/entitlement', { headers: { authorization: `Bearer ${token}` } });
    const entitlementBody = await entitlement.json() as { data: { subscriptions_enabled: boolean; entitlement: { is_active: boolean; tier: string }; limits: { max_file_bytes: number; total_storage_bytes: number; uploads_per_day: number; webhooks_per_server: number } } };
    expect(entitlementBody.data.subscriptions_enabled).toBe(false);
    expect(entitlementBody.data.entitlement).toMatchObject({ is_active: true, tier: 'premium' });
    expect(entitlementBody.data.limits).toMatchObject({ max_file_bytes: 262144000, total_storage_bytes: 10737418240, uploads_per_day: 100, webhooks_per_server: 25 });

    const profile = await api('/api/v1/users/me', { headers: { authorization: `Bearer ${token}` } });
    expect(await profile.json()).toMatchObject({ data: { is_paid: true } });
    expect((await api('/api/v1/users/me', {
      method: 'PATCH', headers,
      body: JSON.stringify({ profile_cosmetics: { accent_color: '#8ce7ff', banner_media_id: null, show_premium_badge: false } }),
    })).status).toBe(200);
  });

  it('persists launch controls and protects normal traffic during maintenance', async () => {
    env.ADMIN_ALLOWLIST = 'launchadmin#0001';
    const adminToken = await registerAndToken('launchadmin');
    const memberToken = await registerAndToken('launchmember');
    const patchControls = async (body: Record<string, unknown>) => api('/api/v1/runtime/controls', {
      method: 'PATCH', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });

    expect((await patchControls({ registrations_enabled: false })).status).toBe(200);
    const blockedRegistration = await api('/api/v1/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'closed', email: 'closed@example.com', password: 'correct horse battery', accepted_legal: true, terms_version: '2026-05-22', privacy_version: '2026-05-22' }),
    });
    expect(blockedRegistration.status).toBe(503);

    expect((await patchControls({ maintenance_mode: true, maintenance_message: 'Deploying safely' })).status).toBe(200);
    expect((await api('/api/v1/servers', { headers: { authorization: `Bearer ${memberToken}` } })).status).toBe(503);
    const runtime = await api('/api/v1/runtime-config');
    const runtimeBody = await runtime.json() as { data: { runtime_controls: { maintenance_mode: boolean; maintenance_message: string } } };
    expect(runtimeBody.data.runtime_controls).toMatchObject({ maintenance_mode: true, maintenance_message: 'Deploying safely' });
    expect((await patchControls({ maintenance_mode: false, registrations_enabled: true })).status).toBe(200);
  });

  it('supports servers channels dms and messages', async () => {
    const tokenA = await registerAndToken('axel');
    const tokenB = await registerAndToken('bea');

    const serverResponse = await api('/api/v1/servers', { method: 'POST', headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Builders' }) });
    const server = await serverResponse.json() as { data: { id: string } };

    await api(`/api/v1/servers/${server.data.id}/join`, { method: 'POST', headers: { authorization: `Bearer ${tokenB}` } });

    const channelResponse = await api(`/api/v1/channels/server/${server.data.id}`, { method: 'POST', headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'general', type: 'text' }) });
    const channel = await channelResponse.json() as { data: { id: string } };

    const messageResponse = await api(`/api/v1/messages/channels/${channel.data.id}`, { method: 'POST', headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello world' }) });
    expect(messageResponse.status).toBe(200);

    const dmResponse = await api('/api/v1/dms', { method: 'POST', headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' }, body: JSON.stringify({ recipient_id: 'user_2' }) });
    expect(dmResponse.status).toBe(200);
    const dm = await dmResponse.json() as { data: { id: string } };

    const serverList = await api('/api/v1/servers', { headers: { authorization: `Bearer ${tokenA}` } });
    const serverListBody = await serverList.json() as { data: Array<{ id: string }> };
    expect(Array.isArray(serverListBody.data)).toBe(true);

    const channelList = await api(`/api/v1/channels/server/${server.data.id}`, { headers: { authorization: `Bearer ${tokenA}` } });
    const channelListBody = await channelList.json() as { data: Array<{ id: string }> };
    expect(Array.isArray(channelListBody.data)).toBe(true);

    const memberList = await api(`/api/v1/servers/${server.data.id}/members`, { headers: { authorization: `Bearer ${tokenA}` } });
    const memberListBody = await memberList.json() as { data: Array<{ user_id: string }> };
    expect(Array.isArray(memberListBody.data)).toBe(true);

    const dmList = await api('/api/v1/dms', { headers: { authorization: `Bearer ${tokenA}` } });
    const dmListBody = await dmList.json() as { data: Array<{ id: string }> };
    expect(Array.isArray(dmListBody.data)).toBe(true);

    expect((await api(`/api/v1/dms/${dm.data.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${tokenA}` } })).status).toBe(200);
    const hiddenDmList = await api('/api/v1/dms', { headers: { authorization: `Bearer ${tokenA}` } });
    const hiddenDmListBody = await hiddenDmList.json() as { data: Array<{ id: string }> };
    expect(hiddenDmListBody.data.some((item) => item.id === dm.data.id)).toBe(false);
    expect((await api(`/api/v1/dms/${dm.data.id}`, { headers: { authorization: `Bearer ${tokenB}` } })).status).toBe(200);
  });

  it('keeps reports scoped and enforces server moderation hierarchy, timeouts, and bans', async () => {
    const ownerToken = await registerAndToken('owner');
    const memberToken = await registerAndToken('member');
    const reporterToken = await registerAndToken('reporter');
    const serverResponse = await api('/api/v1/servers', {
      method: 'POST', headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Moderated' }),
    });
    const server = await serverResponse.json() as { data: { id: string } };
    const serverId = server.data.id;
    await api(`/api/v1/servers/${serverId}/join`, { method: 'POST', headers: { authorization: `Bearer ${memberToken}` } });
    await api(`/api/v1/servers/${serverId}/join`, { method: 'POST', headers: { authorization: `Bearer ${reporterToken}` } });
    const channelResponse = await api(`/api/v1/channels/server/${serverId}`, {
      method: 'POST', headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'general', type: 'text' }),
    });
    const channel = await channelResponse.json() as { data: { id: string } };
    const messageResponse = await api(`/api/v1/messages/channels/${channel.data.id}`, {
      method: 'POST', headers: { authorization: `Bearer ${memberToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ content: 'report me' }),
    });
    const message = await messageResponse.json() as { data: { id: string; author_id: string } };

    const report = await api('/api/v1/reports', {
      method: 'POST', headers: { authorization: `Bearer ${reporterToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ target_type: 'message', target_id: message.data.id, reason: 'harassment', details: 'Test report' }),
    });
    expect(report.status).toBe(201);
    const ownQueue = await api(`/api/v1/servers/${serverId}/moderation/reports`, { headers: { authorization: `Bearer ${ownerToken}` } });
    expect(ownQueue.status).toBe(200);
    const memberQueue = await api(`/api/v1/servers/${serverId}/moderation/reports`, { headers: { authorization: `Bearer ${memberToken}` } });
    expect(memberQueue.status).toBe(403);

    const members = await api(`/api/v1/servers/${serverId}/members`, { headers: { authorization: `Bearer ${ownerToken}` } });
    const membersBody = await members.json() as { data: Array<{ user_id: string; role: string }> };
    const memberId = membersBody.data.find((item) => item.role === 'member')!.user_id;
    const timeout = await api(`/api/v1/servers/${serverId}/moderation/timeout`, {
      method: 'POST', headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: memberId, reason: 'Cooldown', expires_at: new Date(Date.now() + 60_000).toISOString() }),
    });
    expect(timeout.status).toBe(201);
    const timedOutSend = await api(`/api/v1/messages/channels/${channel.data.id}`, {
      method: 'POST', headers: { authorization: `Bearer ${memberToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ content: 'blocked' }),
    });
    expect(timedOutSend.status).toBe(403);
    expect((await api(`/api/v1/servers/${serverId}/moderation/untimeout`, {
      method: 'POST', headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ user_id: memberId, reason: 'Resolved' }),
    })).status).toBe(200);
    expect((await api(`/api/v1/messages/channels/${channel.data.id}`, {
      method: 'POST', headers: { authorization: `Bearer ${memberToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ content: 'allowed again' }),
    })).status).toBe(200);

    const ban = await api(`/api/v1/servers/${serverId}/moderation/ban`, {
      method: 'POST', headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ user_id: memberId, reason: 'Rule breach' }),
    });
    expect(ban.status).toBe(201);
    expect((await api(`/api/v1/servers/${serverId}/join`, { method: 'POST', headers: { authorization: `Bearer ${memberToken}` } })).status).toBe(403);
    expect((await api(`/api/v1/servers/${serverId}/moderation/unban`, {
      method: 'POST', headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ user_id: memberId, reason: 'Appeal accepted' }),
    })).status).toBe(200);
    expect((await api(`/api/v1/servers/${serverId}/join`, { method: 'POST', headers: { authorization: `Bearer ${memberToken}` } })).status).toBe(200);
  });

  it('keeps reports private and records warning, delete, kick, and resolution audit actions', async () => {
    env.ADMIN_ALLOWLIST = 'reportowner#0001';
    const owner = await registerAndSession('reportowner');
    const moderator = await registerAndSession('reportmod');
    const target = await registerAndSession('reporttarget');
    const reporter = await registerAndSession('reporter2');
    const kicked = await registerAndSession('kicktarget');
    const serverResponse = await api('/api/v1/servers', { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Report privacy' }) });
    const server = await serverResponse.json() as { data: { id: string } };
    const serverId = server.data.id;
    for (const user of [moderator, target, reporter, kicked]) {
      expect((await api(`/api/v1/servers/${serverId}/join`, { method: 'POST', headers: { authorization: `Bearer ${user.token}` } })).status).toBe(200);
    }
    expect((await api(`/api/v1/servers/${serverId}/members/${moderator.user.id}?role=moderator`, { method: 'PATCH', headers: { authorization: `Bearer ${owner.token}` } })).status).toBe(200);
    const channelResponse = await api(`/api/v1/channels/server/${serverId}`, { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'reports', type: 'text' }) });
    const channel = await channelResponse.json() as { data: { id: string } };

    const ownerMessage = await api(`/api/v1/messages/channels/${channel.data.id}`, { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ content: 'owner message' }) });
    const ownerMessageBody = await ownerMessage.json() as { data: { id: string } };
    const protectedReport = await api('/api/v1/reports', { method: 'POST', headers: { authorization: `Bearer ${reporter.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ target_type: 'message', target_id: ownerMessageBody.data.id, reason: 'harassment' }) });
    expect(protectedReport.status).toBe(201);
    const protectedReportBody = await protectedReport.json() as { data: { report_id: string } };
    const moderatorQueue = await api(`/api/v1/servers/${serverId}/moderation/reports`, { headers: { authorization: `Bearer ${moderator.token}` } });
    const moderatorQueueBody = await moderatorQueue.json() as { data: { items: Array<{ id: string }> } };
    expect(moderatorQueueBody.data.items.some((item) => item.id === protectedReportBody.data.report_id)).toBe(false);
    expect((await api(`/api/v1/reports/${protectedReportBody.data.report_id}`, { headers: { authorization: `Bearer ${reporter.token}` } })).status).toBe(403);

    const targetMessage = await api(`/api/v1/messages/channels/${channel.data.id}`, { method: 'POST', headers: { authorization: `Bearer ${target.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ content: 'target message' }) });
    const targetMessageBody = await targetMessage.json() as { data: { id: string } };
    const serverReport = await api('/api/v1/reports', { method: 'POST', headers: { authorization: `Bearer ${reporter.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ target_type: 'message', target_id: targetMessageBody.data.id, reason: 'spam', details: 'immutable context expected' }) });
    expect(serverReport.status).toBe(201);
    const serverReportBody = await serverReport.json() as { data: { report_id: string } };
    expect((await api('/api/v1/reports', { method: 'POST', headers: { authorization: `Bearer ${reporter.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ target_type: 'message', target_id: targetMessageBody.data.id, reason: 'spam' }) })).status).toBe(409);
    expect((await api(`/api/v1/reports/${serverReportBody.data.report_id}`, { method: 'PATCH', headers: { authorization: `Bearer ${moderator.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'in_review' }) })).status).toBe(200);
    expect((await api(`/api/v1/reports/${serverReportBody.data.report_id}/notes`, { method: 'POST', headers: { authorization: `Bearer ${moderator.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ body: 'Private staff note' }) })).status).toBe(201);
    expect((await api(`/api/v1/servers/${serverId}/moderation/warn`, { method: 'POST', headers: { authorization: `Bearer ${moderator.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ user_id: target.user.id, reason: 'First warning' }) })).status).toBe(201);
    expect((await api(`/api/v1/servers/${serverId}/moderation/messages/${targetMessageBody.data.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${moderator.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Remove harmful content' }) })).status).toBe(200);
    expect((await api(`/api/v1/servers/${serverId}/moderation/kick`, { method: 'POST', headers: { authorization: `Bearer ${moderator.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ user_id: kicked.user.id, reason: 'Cooling off' }) })).status).toBe(200);
    expect((await api(`/api/v1/messages/channels/${channel.data.id}`, { method: 'POST', headers: { authorization: `Bearer ${kicked.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ content: 'blocked after kick' }) })).status).toBe(403);

    const profileReport = await api('/api/v1/reports', { method: 'POST', headers: { authorization: `Bearer ${reporter.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ target_type: 'profile', target_id: target.user.id, reason: 'impersonation' }) });
    expect(profileReport.status).toBe(201);
    const profileReportBody = await profileReport.json() as { data: { report_id: string } };
    const platformReports = await api('/api/v1/admin/reports', { headers: { authorization: `Bearer ${owner.token}` } });
    const platformReportsBody = await platformReports.json() as { data: { items: Array<{ id: string }> } };
    expect(platformReportsBody.data.items.some((item) => item.id === profileReportBody.data.report_id)).toBe(true);
    expect((await api(`/api/v1/reports/${profileReportBody.data.report_id}`, { method: 'PATCH', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'actioned', resolution_reason: 'Reviewed and actioned' }) })).status).toBe(200);
    expect(Object.values(env.__APP_STATE__!.reportAudits).filter((audit) => audit.report_id === serverReportBody.data.report_id).length).toBeGreaterThanOrEqual(3);
  });

  it('blocks timed-out staff from uploads, webhooks, and voice participation', async () => {
    const owner = await registerAndSession('timeoutowner');
    const timedOutAdmin = await registerAndSession('timeoutadmin');
    const serverResponse = await api('/api/v1/servers', { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Timeout controls' }) });
    const server = await serverResponse.json() as { data: { id: string } };
    const serverId = server.data.id;
    expect((await api(`/api/v1/servers/${serverId}/join`, { method: 'POST', headers: { authorization: `Bearer ${timedOutAdmin.token}` } })).status).toBe(200);
    expect((await api(`/api/v1/servers/${serverId}/members/${timedOutAdmin.user.id}?role=admin`, { method: 'PATCH', headers: { authorization: `Bearer ${owner.token}` } })).status).toBe(200);
    const textChannelResponse = await api(`/api/v1/channels/server/${serverId}`, { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'text', type: 'text' }) });
    const textChannel = await textChannelResponse.json() as { data: { id: string } };
    const voiceChannelResponse = await api(`/api/v1/channels/server/${serverId}`, { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'voice', type: 'voice' }) });
    const voiceChannel = await voiceChannelResponse.json() as { data: { id: string } };
    const webhookResponse = await api(`/api/v1/servers/${serverId}/webhooks`, { method: 'POST', headers: { authorization: `Bearer ${timedOutAdmin.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'timeout hook', channel_id: textChannel.data.id }) });
    const webhook = await webhookResponse.json() as { data: { webhook: { id: string }; token: string } };
    expect(webhookResponse.status).toBe(200);

    const socket = await openSocket(timedOutAdmin.token);
    let mark = socket.mark();
    socket.ws.send(JSON.stringify({ action: 'subscribe', channel_ids: [voiceChannel.data.id] }));
    await socket.waitForMessage((message) => message.type === 'subscribed', mark);
    mark = socket.mark();
    socket.ws.send(JSON.stringify({ action: 'join_voice', channel_id: voiceChannel.data.id }));
    await socket.waitForMessage((message) => message.event === 'voice.participants', mark);

    expect((await api(`/api/v1/servers/${serverId}/moderation/timeout`, {
      method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: timedOutAdmin.user.id, reason: 'Cooldown', expires_at: new Date(Date.now() + 60_000).toISOString() }),
    })).status).toBe(201);
    await socket.waitForMessage((message) => message.event === 'voice.timeout', mark);
    mark = socket.mark();
    socket.ws.send(JSON.stringify({ action: 'join_voice', channel_id: voiceChannel.data.id }));
    const denied = await socket.waitForMessage((message) => message.event === 'realtime.denied', mark);
    expect(denied.data?.code).toBe('SERVER_TIMEOUT_ACTIVE');

    const form = new FormData();
    form.set('file', new File(['blocked upload'], 'blocked.txt', { type: 'text/plain' }));
    expect((await api('/api/v1/uploads', { method: 'POST', headers: { authorization: `Bearer ${timedOutAdmin.token}` }, body: form })).status).toBe(403);
    expect((await api(`/api/v1/webhooks/${webhook.data.webhook.id}/${webhook.data.token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'blocked hook' }) })).status).toBe(403);
    expect((await api(`/api/v1/webhooks/${webhook.data.webhook.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${timedOutAdmin.token}` } })).status).toBe(403);
    socket.requestDisconnect();
  });

  it('does not leak webhook credentials or private workspace and reaction access', async () => {
    const owner = await registerAndSession('accessowner');
    const outsider = await registerAndSession('accessoutsider');
    const serverResponse = await api('/api/v1/servers', { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Private state' }) });
    const server = await serverResponse.json() as { data: { id: string } };
    const channelResponse = await api(`/api/v1/channels/server/${server.data.id}`, { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'private', type: 'text' }) });
    const channel = await channelResponse.json() as { data: { id: string } };
    const messageResponse = await api(`/api/v1/messages/channels/${channel.data.id}`, { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ content: 'private content' }) });
    const message = await messageResponse.json() as { data: { id: string } };
    expect((await api(`/api/v1/channels/${channel.data.id}/workspace`, { method: 'PATCH', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ content: 'private workspace' }) })).status).toBe(200);
    expect((await api(`/api/v1/channels/${channel.data.id}/workspace`, { headers: { authorization: `Bearer ${outsider.token}` } })).status).toBe(403);
    expect((await api(`/api/v1/channels/${channel.data.id}/workspace`, { method: 'PATCH', headers: { authorization: `Bearer ${outsider.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ content: 'unauthorized' }) })).status).toBe(403);
    expect((await api(`/api/v1/messages/${message.data.id}/reactions`, { method: 'PUT', headers: { authorization: `Bearer ${outsider.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ emoji: '🚫' }) })).status).toBe(403);

    const created = await api(`/api/v1/servers/${server.data.id}/webhooks`, { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'private webhook', channel_id: channel.data.id }) });
    const createdBody = await created.json() as { data: { webhook: { id: string; webhook_url?: string }; token: string } };
    expect(created.status).toBe(200);
    expect(createdBody.data.webhook.webhook_url).toBeUndefined();
    expect((await api(`/api/v1/servers/${server.data.id}/webhooks`)).status).toBe(401);
    const listed = await api(`/api/v1/servers/${server.data.id}/webhooks`, { headers: { authorization: `Bearer ${owner.token}` } });
    const listedBody = await listed.json() as { data: { items: Array<{ webhook_url?: string }> } };
    expect(listedBody.data.items[0]?.webhook_url).toBeUndefined();
    expect(JSON.stringify(env.__APP_STATE__!.webhooks[createdBody.data.webhook.id])).not.toContain(createdBody.data.token);
  });

  it('supports hash-only api tokens and signed Wyv introspection', async () => {
    const token = await registerAndToken('axel');
    const createResponse = await api('/api/v1/api-tokens', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Primary' }) });
    expect(createResponse.status).toBe(200);
    const created = await createResponse.json() as { data: { token: { token: string } } };

    const body = JSON.stringify({ token: created.data.token.token });
    expect((await api('/api/v1/internal/wyv/api-token-introspect', { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status).toBe(503);
    env.WYV_SHARED_SECRET = 'test-token-introspection-secret';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signed = await signBridgePayload(env.WYV_SHARED_SECRET, new TextEncoder().encode(body).buffer.slice(0) as ArrayBuffer, timestamp);
    const introspectResponse = await api('/api/v1/internal/wyv/api-token-introspect', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Wyv-Bridge-Timestamp': signed.timestamp, 'X-Wyv-Bridge-Signature': signed.signature },
      body,
    });
    expect(introspectResponse.status).toBe(200);
    env.WYV_SHARED_SECRET = undefined as never;

    expect((await api('/api/v1/api-tokens/revoke-all', { method: 'POST', headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await api('/api/v1/api-tokens/rotate-all', { method: 'POST', headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await api('/api/v1/ai/mcp-connection', { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
    expect((await api('/api/v1/ai/mcp-connection', { method: 'POST', headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
    expect((await api('/api/v1/ai/mcp-connection', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
  });

  it('supports webhooks workspace and admin overview', async () => {
    env.ADMIN_ALLOWLIST = 'axel#0001';
    const adminToken = await registerAndToken('axel');
    const serverResponse = await api('/api/v1/servers', { method: 'POST', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Builders' }) });
    const server = await serverResponse.json() as { data: { id: string } };

    const channelResponse = await api(`/api/v1/channels/server/${server.data.id}`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'general', type: 'text' }) });
    const channel = await channelResponse.json() as { data: { id: string } };

    const webhookCreate = await api(`/api/v1/servers/${server.data.id}/webhooks`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'bot', channel_id: channel.data.id }) });
    expect(webhookCreate.status).toBe(200);
    const webhook = await webhookCreate.json() as { data: { webhook: { id: string }; token: string } };

    const webhookInvoke = await api(`/api/v1/webhooks/${webhook.data.webhook.id}/${webhook.data.token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'from webhook' }) });
    expect(webhookInvoke.status).toBe(200);

    const webhookRotate = await api(`/api/v1/webhooks/${webhook.data.webhook.id}/rotate`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}` } });
    expect(webhookRotate.status).toBe(200);
    const webhookDeliveriesCheck = await api(`/api/v1/servers/${server.data.id}/webhooks/${webhook.data.webhook.id}/deliveries`, { headers: { authorization: `Bearer ${adminToken}` } });
    expect(webhookDeliveriesCheck.status).toBe(200);

    const workspaceUpdate = await api(`/api/v1/channels/${channel.data.id}/workspace`, { method: 'PATCH', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ content: '# Notes', log_activity: true }) });
    expect(workspaceUpdate.status).toBe(200);

    const runtimeConfig = await api('/api/v1/runtime-config');
    expect(runtimeConfig.status).toBe(200);
    const runtimeConfigBody = await runtimeConfig.json() as { data: { client_mode: string; edge_mode_enabled: boolean; edge_mode_available: boolean } };
    expect(runtimeConfigBody.data.client_mode).toBe('stable');
    expect(runtimeConfigBody.data.edge_mode_enabled).toBe(false);
    expect(runtimeConfigBody.data.edge_mode_available).toBe(false);

    const edgeRuntimeConfig = await api('/edge/api/v1/runtime-config?mode=edge');
    expect(edgeRuntimeConfig.status).toBe(200);
    const edgeRuntimeConfigBody = await edgeRuntimeConfig.json() as { data: { client_mode: string; edge_mode_enabled: boolean; edge_mode_available: boolean } };
    expect(edgeRuntimeConfigBody.data.client_mode).toBe('stable');
    expect(edgeRuntimeConfigBody.data.edge_mode_enabled).toBe(false);
    expect(edgeRuntimeConfigBody.data.edge_mode_available).toBe(false);
  });

  it('mirrors saved workspaces into a credential-protected Git-compatible read repository', async () => {
    const owner = await registerAndSession('gitworkspace');
    const serverResponse = await api('/api/v1/servers', { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Git workspace server' }) });
    const server = await serverResponse.json() as { data: { id: string } };
    const channelResponse = await api(`/api/v1/channels/server/${server.data.id}`, { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'source', type: 'text' }) });
    const channel = await channelResponse.json() as { data: { id: string } };
    expect((await api(`/api/v1/channels/${channel.data.id}/workspace`, { method: 'PATCH', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Source notes', content: '# Hello Git' }) })).status).toBe(200);

    const repositoryResponse = await api(`/api/v1/channels/${channel.data.id}/workspace/git`, { headers: { authorization: `Bearer ${owner.token}` } });
    expect(repositoryResponse.status).toBe(200);
    const repositoryBody = await repositoryResponse.json() as { data: { slug: string; head_commit_sha: string; default_branch: string; transport: string } };
    expect(repositoryBody.data).toMatchObject({ default_branch: 'main', transport: 'smart_http_push_best_effort' });
    expect(repositoryBody.data.head_commit_sha).toMatch(/^[a-f0-9]{40}$/);

    const credentialResponse = await api(`/api/v1/channels/${channel.data.id}/workspace/git/credentials`, { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Laptop', expires_in_days: 7 }) });
    expect(credentialResponse.status).toBe(201);
    const credentialBody = await credentialResponse.json() as { data: { token: string; credential: { id: string } } };
    const basic = `Basic ${btoa(`git:${credentialBody.data.token}`)}`;
    const root = `/git/workspaces/${repositoryBody.data.slug}.git`;
    expect((await api(`${root}/HEAD`, { headers: { authorization: basic } })).status).toBe(200);
    expect(await (await api(`${root}/info/refs`, { headers: { authorization: basic } })).text()).toContain(repositoryBody.data.head_commit_sha);
    const sha = repositoryBody.data.head_commit_sha;
    const commitObject = await api(`${root}/objects/${sha.slice(0, 2)}/${sha.slice(2)}`, { headers: { authorization: basic } });
    expect(commitObject.status).toBe(200);
    const inflatedCommit = await new Response(commitObject.body!.pipeThrough(new DecompressionStream('deflate'))).text();
    expect(inflatedCommit).toMatch(/^commit \d+\0/);
    expect(inflatedCommit).toContain('Update Source notes');
    expect((await api(`${root}/HEAD`)).status).toBe(401);
    expect(env.__APP_STATE__!.workspaceGitCredentials[credentialBody.data.credential.id].last_used_at).toBeNull();
    env.__APP_STATE__!.runtimeControls.maintenance_mode = true;
    expect((await api(`${root}/HEAD`, { headers: { authorization: basic } })).status).toBe(403);
    env.__APP_STATE__!.runtimeControls.maintenance_mode = false;
    delete env.__APP_STATE__!.serverMembers[`${server.data.id}:${owner.user.id}`];
    expect((await api(`${root}/HEAD`, { headers: { authorization: basic } })).status).toBe(403);
    expect((await api(`/api/v1/channels/${channel.data.id}/workspace/git/credentials/${credentialBody.data.credential.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${owner.token}` } })).status).toBe(200);
    expect((await api(`${root}/HEAD`, { headers: { authorization: basic } })).status).toBe(401);
  });

  it('accepts a best-effort fast-forward Git smart-HTTP push to a workspace README', async () => {
    const owner = await registerAndSession('gitpush');
    const serverResponse = await api('/api/v1/servers', { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Git push server' }) });
    const server = await serverResponse.json() as { data: { id: string } };
    const channelResponse = await api(`/api/v1/channels/server/${server.data.id}`, { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'source', type: 'text' }) });
    const channel = await channelResponse.json() as { data: { id: string } };
    expect((await api(`/api/v1/channels/${channel.data.id}/workspace`, { method: 'PATCH', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Source', content: '# Before push' }) })).status).toBe(200);
    const repositoryBody = await (await api(`/api/v1/channels/${channel.data.id}/workspace/git`, { headers: { authorization: `Bearer ${owner.token}` } })).json() as { data: { slug: string; head_commit_sha: string } };
    const credentialBody = await (await api(`/api/v1/channels/${channel.data.id}/workspace/git/credentials`, { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'CLI', scope: 'write' }) })).json() as { data: { token: string } };
    const basic = `Basic ${btoa(`git:${credentialBody.data.token}`)}`;
    const root = `/git/workspaces/${repositoryBody.data.slug}.git`;
    const oldSha = repositoryBody.data.head_commit_sha;

    const blobContent = gitEncoder.encode('# Pushed from Git\n');
    const blobSha = await gitSha('blob', blobContent);
    const treeContent = gitBytes(gitEncoder.encode('100644 README.md\0'), gitHexBytes(blobSha));
    const treeSha = await gitSha('tree', treeContent);
    const commitContent = gitEncoder.encode(`tree ${treeSha}\nparent ${oldSha}\nauthor CLI User <cli@example.invalid> 1710000000 +0000\ncommitter CLI User <cli@example.invalid> 1710000000 +0000\n\nPush README\n`);
    const newSha = await gitSha('commit', commitContent);
    const pack = await gitPack([{ type: 3, content: blobContent }, { type: 2, content: treeContent }, { type: 1, content: commitContent }]);
    const requestBody = gitBytes(gitPacket(`${oldSha} ${newSha} refs/heads/main\0report-status\n`), gitEncoder.encode('0000'), pack);

    const advertisement = await api(`${root}/info/refs?service=git-receive-pack`, { headers: { authorization: basic } });
    expect(advertisement.status).toBe(200);
    expect(advertisement.headers.get('content-type')).toContain('application/x-git-receive-pack-advertisement');
    const pushed = await api(`${root}/git-receive-pack`, { method: 'POST', headers: { authorization: basic, 'content-type': 'application/x-git-receive-pack-request' }, body: requestBody });
    expect(pushed.status).toBe(200);
    expect(await pushed.text()).toContain('ok refs/heads/main');

    const refreshedRepository = await (await api(`/api/v1/channels/${channel.data.id}/workspace/git`, { headers: { authorization: `Bearer ${owner.token}` } })).json() as { data: { head_commit_sha: string } };
    expect(refreshedRepository.data.head_commit_sha).toBe(newSha);
    const workspace = await (await api(`/api/v1/channels/${channel.data.id}/workspace`, { headers: { authorization: `Bearer ${owner.token}` } })).json() as { data: { content: string } };
    expect(workspace.data.content).toBe('# Pushed from Git\n');

    const stalePush = await api(`${root}/git-receive-pack`, { method: 'POST', headers: { authorization: basic, 'content-type': 'application/x-git-receive-pack-request' }, body: requestBody });
    expect(await stalePush.text()).toContain('ng refs/heads/main Branch changed on the server');

    const missingTree = 'a'.repeat(40);
    const corruptCommitContent = gitEncoder.encode(`tree ${missingTree}\nparent ${newSha}\nauthor CLI User <cli@example.invalid> 1710000001 +0000\ncommitter CLI User <cli@example.invalid> 1710000001 +0000\n\nCorrupt tree\n`);
    const corruptSha = await gitSha('commit', corruptCommitContent);
    const corruptPack = await gitPack([{ type: 1, content: corruptCommitContent }]);
    const corruptRequest = gitBytes(gitPacket(`${newSha} ${corruptSha} refs/heads/main\0report-status\n`), gitEncoder.encode('0000'), corruptPack);
    const corruptPush = await api(`${root}/git-receive-pack`, { method: 'POST', headers: { authorization: basic, 'content-type': 'application/x-git-receive-pack-request' }, body: corruptRequest });
    expect(await corruptPush.text()).toContain('ng refs/heads/main');
    const afterCorruptRepository = await (await api(`/api/v1/channels/${channel.data.id}/workspace/git`, { headers: { authorization: `Bearer ${owner.token}` } })).json() as { data: { head_commit_sha: string } };
    expect(afterCorruptRepository.data.head_commit_sha).toBe(newSha);

    const extraBlobContent = gitEncoder.encode('console.log("not supported yet");\n');
    const extraBlobSha = await gitSha('blob', extraBlobContent);
    const multiTreeContent = gitBytes(gitEncoder.encode('100644 README.md\0'), gitHexBytes(blobSha), gitEncoder.encode('100644 app.js\0'), gitHexBytes(extraBlobSha));
    const multiTreeSha = await gitSha('tree', multiTreeContent);
    const multiCommitContent = gitEncoder.encode(`tree ${multiTreeSha}\nparent ${newSha}\nauthor CLI User <cli@example.invalid> 1710000002 +0000\ncommitter CLI User <cli@example.invalid> 1710000002 +0000\n\nMulti-file tree\n`);
    const multiSha = await gitSha('commit', multiCommitContent);
    const multiPack = await gitPack([{ type: 3, content: blobContent }, { type: 3, content: extraBlobContent }, { type: 2, content: multiTreeContent }, { type: 1, content: multiCommitContent }]);
    const multiRequest = gitBytes(gitPacket(`${newSha} ${multiSha} refs/heads/main\0report-status\n`), gitEncoder.encode('0000'), multiPack);
    const multiPush = await api(`${root}/git-receive-pack`, { method: 'POST', headers: { authorization: basic, 'content-type': 'application/x-git-receive-pack-request' }, body: multiRequest });
    expect(await multiPush.text()).toContain('Workspace Git accepts exactly one 100644 README.md file');

    const readCredential = await (await api(`/api/v1/channels/${channel.data.id}/workspace/git/credentials`, { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Read only', scope: 'read' }) })).json() as { data: { token: string } };
    const readBasic = `Basic ${btoa(`git:${readCredential.data.token}`)}`;
    expect((await api(`${root}/git-receive-pack`, { method: 'POST', headers: { authorization: readBasic, 'content-type': 'application/x-git-receive-pack-request' }, body: requestBody })).status).toBe(401);
  });

  it('enforces moderation actions and revokes profile media through admin endpoints', async () => {
    env.ADMIN_ALLOWLIST = 'admin#0001';
    env.SMTP2GO_API_KEY = 'smtp-test-key';
    env.SMTP2GO_DEFAULT_FROM = 'noreply@wyvernhub.net';
    const adminToken = await registerAndToken('admin');
    const memberRegister = await api('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'member', email: 'member@example.com', password: 'correct horse battery', accepted_legal: true, terms_version: '2026-05-22', privacy_version: '2026-05-22' }),
    });
    const memberRegisterBody = await memberRegister.json() as { data: { user: { id: string }; tokens: { access_token: string; refresh_token: string } } };
    const memberId = memberRegisterBody.data.user.id;
    const memberToken = memberRegisterBody.data.tokens.access_token;
    const memberRefresh = memberRegisterBody.data.tokens.refresh_token;
    const verifiedAt = new Date().toISOString();
    env.__APP_STATE__!.users[memberId].email_verified_at = verifiedAt;
    env.__APP_STATE__!.emailVerifications[memberId].status = 'verified';
    env.__APP_STATE__!.emailVerifications[memberId].verified_at = verifiedAt;
    const smtpFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      result: 'success',
      data: { email_id: 'moderation-notice' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const form = new FormData();
    form.set('file', new File(['avatar bytes'], 'avatar.png', { type: 'image/png' }));
    const upload = await api('/api/v1/uploads', { method: 'POST', headers: { authorization: `Bearer ${memberToken}` }, body: form });
    const uploadBody = await upload.json() as { data: { url: string } };
    await api('/api/v1/users/me', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${memberToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ avatar: uploadBody.data.url, bio: 'hello bio', display_name: 'Member Prime' }),
    });

    const redact = await api(`/api/v1/admin/users/${memberId}/actions/remove-profile-fields`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ fields: ['avatar', 'bio'], reason: 'policy test' }),
    });
    expect(redact.status).toBe(200);
    expect((await api(uploadBody.data.url)).status).toBe(404);

    const lookupAfterRedaction = await api(`/api/v1/users/${memberId}`);
    const lookupBody = await lookupAfterRedaction.json() as { data: { avatar: string | null; bio: string | null; redactions: { avatar: boolean; bio: boolean } } };
    expect(lookupBody.data.avatar).toBeNull();
    expect(lookupBody.data.bio).toBeNull();
    expect(lookupBody.data.redactions.avatar).toBe(true);
    expect(lookupBody.data.redactions.bio).toBe(true);

    const suspend = await api(`/api/v1/admin/users/${memberId}/actions/suspend`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'cool down' }),
    });
    expect(suspend.status).toBe(200);
    const blockedLogin = await api('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'member@example.com', password: 'correct horse battery' }),
    });
    expect(blockedLogin.status).toBe(403);
    expect(await blockedLogin.json()).toMatchObject({
      error: { message: 'This account is suspended. Reason: cool down', details: { moderation_status: 'suspended', reason: 'cool down' } },
    });
    expect((await api('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: memberRefresh }),
    })).status).toBe(401);
    expect((await api('/api/v1/users/me', { headers: { authorization: `Bearer ${memberToken}` } })).status).toBe(401);

    const restore = await api(`/api/v1/admin/users/${memberId}/actions/restore`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'restored' }),
    });
    expect(restore.status).toBe(200);
    const softDelete = await api(`/api/v1/admin/users/${memberId}/actions/soft-delete`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'user requested deletion' }),
    });
    expect(softDelete.status).toBe(200);
    const publicAfterDelete = await api(`/api/v1/users/${memberId}`);
    const publicDeleteBody = await publicAfterDelete.json() as { data: { username: string; deleted: boolean } };
    expect(publicDeleteBody.data.username).toBe('deleted-user');
    expect(publicDeleteBody.data.deleted).toBe(true);

    const targetTag = `${env.__APP_STATE__!.users[memberId].username}#${env.__APP_STATE__!.users[memberId].discriminator}`;
    const incompleteHardDelete = await api(`/api/v1/admin/users/${memberId}/actions/hard-delete`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'permanent policy removal', confirmations: { acknowledge_irreversible: true, target: targetTag, phrase: 'DELETE' } }),
    });
    expect(incompleteHardDelete.status).toBe(400);

    const hardDelete = await api(`/api/v1/admin/users/${memberId}/actions/hard-delete`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'permanent policy removal', confirmations: { acknowledge_irreversible: true, target: targetTag, phrase: 'HARD DELETE' } }),
    });
    expect(hardDelete.status).toBe(200);
    expect((await hardDelete.json() as { data: { deleted: boolean; user_id: string } }).data).toEqual({ deleted: true, user_id: memberId });
    expect(env.__APP_STATE__!.users[memberId]).toBeUndefined();
    expect(Object.values(env.__APP_STATE__!.refreshTokens).some((token) => token.user_id === memberId)).toBe(false);
    expect((await api(`/api/v1/users/${memberId}`)).status).toBe(404);
    const notices = smtpFetch.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit)?.body || '{}')));
    expect(notices).toHaveLength(5);
    expect(notices.every((notice) => notice.to?.[0] === 'member@example.com')).toBe(true);
    expect(notices.some((notice) => notice.subject === 'Wyvern account notice: suspended')).toBe(true);
    expect(notices.some((notice) => notice.subject === 'Wyvern account notice: permanently deleted')).toBe(true);
    smtpFetch.mockRestore();
  });

  it('creates retrievable media urls for uploads', async () => {
    const token = await registerAndToken('mediauser');
    const payload = 'hello world!';
    const form = new FormData();
    form.set('file', new File([payload], 'hello.png', { type: 'image/png' }));
    const upload = await api('/api/v1/uploads', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form
    });
    expect(upload.status).toBe(200);
    const body = await upload.json() as { data: { url: string; filename: string; content_type: string } };
    expect(body.data.filename).toBe('hello.png');
    expect(body.data.content_type).toBe('image/png');
    const media = await api(body.data.url);
    expect(media.status).toBe(200);
    expect(media.headers.get('content-type')).toBe('image/png');
    expect(await media.text()).toBe(payload);
  });

  it('quarantines uploads until a signed clean scanner verdict arrives', async () => {
    env.MALWARE_SCANNER_URL = 'https://scanner.example/scan';
    env.MALWARE_SCANNER_SECRET = 'scanner-secret';
    const scanner = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 202 }));
    const token = await registerAndToken('scanuser');
    const form = new FormData();
    form.set('file', new File(['scan me'], 'scan.txt', { type: 'text/plain' }));
    const upload = await api('/api/v1/uploads', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    scanner.mockRestore();
    expect(upload.status).toBe(202);
    const uploadBody = await upload.json() as { data: { id: string; url: string | null; status_url: string; scan_status: string } };
    expect(uploadBody.data.scan_status).toBe('pending');
    expect(uploadBody.data.url).toBeNull();
    expect((await api(`/media/user_1/${uploadBody.data.id}`)).status).toBe(423);

    const callbackBody = JSON.stringify({ upload_id: uploadBody.data.id, verdict: 'clean' });
    const encoded = new TextEncoder().encode(callbackBody);
    const signed = await signBridgePayload(
      env.MALWARE_SCANNER_SECRET,
      encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer,
    );
    const callback = await api('/api/v1/internal/uploads/scan-result', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Wyvern-Scan-Timestamp': signed.timestamp,
        'X-Wyvern-Scan-Signature': signed.signature,
      },
      body: callbackBody,
    });
    expect(callback.status).toBe(200);
    const status = await api(uploadBody.data.status_url, { headers: { authorization: `Bearer ${token}` } });
    const statusBody = await status.json() as { data: { url: string; scan_status: string } };
    expect(statusBody.data.scan_status).toBe('clean');
    expect((await api(statusBody.data.url)).status).toBe(200);
  });

  it('uses one-use scanner downloads and rejects infected uploads', async () => {
    env.MALWARE_SCANNER_URL = 'https://scanner.example/scan';
    env.MALWARE_SCANNER_SECRET = 'scanner-secret';
    let scannerPayload: { download_url?: string } = {};
    const scanner = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      scannerPayload = JSON.parse(String(init?.body || '{}'));
      return new Response(null, { status: 202 });
    });
    const token = await registerAndToken('infectedupload');
    const form = new FormData();
    form.set('file', new File(['malicious test fixture'], 'fixture.txt', { type: 'text/plain' }));
    const upload = await api('/api/v1/uploads', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    scanner.mockRestore();
    const uploadBody = await upload.json() as { data: { id: string; status_url: string } };
    const download = new URL(scannerPayload.download_url || '');
    expect((await api(`${download.pathname}${download.search}`)).status).toBe(200);
    expect((await api(`${download.pathname}${download.search}`)).status).toBe(401);

    const forged = await api('/api/v1/internal/uploads/scan-result', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ upload_id: uploadBody.data.id, verdict: 'infected' }),
    });
    expect(forged.status).toBe(401);

    const callbackBody = JSON.stringify({ upload_id: uploadBody.data.id, verdict: 'infected', error: 'test malware signature' });
    const encoded = new TextEncoder().encode(callbackBody);
    const signed = await signBridgePayload(
      env.MALWARE_SCANNER_SECRET,
      encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer,
    );
    expect((await api('/api/v1/internal/uploads/scan-result', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Wyvern-Scan-Timestamp': signed.timestamp,
        'X-Wyvern-Scan-Signature': signed.signature,
      },
      body: callbackBody,
    })).status).toBe(200);
    const status = await api(uploadBody.data.status_url, { headers: { authorization: `Bearer ${token}` } });
    const statusBody = await status.json() as { data: { scan_status: string; url: string | null } };
    expect(statusBody.data.scan_status).toBe('infected');
    expect(statusBody.data.url).toBeNull();
    expect((await api(`/media/user_1/${uploadBody.data.id}`)).status).toBe(404);
  });

  it('stores inbound mail and supports admin triage workflows', async () => {
    env.ADMIN_ALLOWLIST = 'mailadmin#0001';
    env.MAIL_WORKER_SECRET = 'mail-secret';
    const adminToken = await registerAndToken('mailadmin');
    const body = JSON.stringify({
      from_address: 'sender@example.com',
      from_name: 'Sender',
      to_address: 'support@wyvernhub.net',
      subject: 'Need help',
      text_body: 'Hello from the worker',
      source_message_id: '<abc@example.com>',
      headers: { 'x-source': 'test' },
    });
    const signed = await signBridgePayload(
      env.MAIL_WORKER_SECRET,
      new TextEncoder().encode(body).buffer.slice(0) as ArrayBuffer,
    );
    const ingest = await api('/api/v1/internal/mail/inbox', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Wyvern-Mail-Timestamp': signed.timestamp,
        'X-Wyvern-Mail-Signature': signed.signature,
      },
      body,
    });
    expect(ingest.status).toBe(201);
    const ingestBody = await ingest.json() as { data: { item: { id: string } } };
    const messageId = ingestBody.data.item.id;

    const inbox = await api('/api/v1/admin/mail/inbox', { headers: { authorization: `Bearer ${adminToken}` } });
    const inboxBody = await inbox.json() as { data: { items: Array<{ id: string; status: string }> } };
    expect(inboxBody.data.items[0].id).toBe(messageId);

    expect((await api(`/api/v1/admin/mail/inbox/${messageId}/status`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'open' }),
    })).status).toBe(200);
    expect((await api(`/api/v1/admin/mail/inbox/${messageId}/tags`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tags: ['support', 'priority'] }),
    })).status).toBe(200);
    expect((await api(`/api/v1/admin/mail/inbox/${messageId}/assign`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ assigned_to_user_id: 'user_1' }),
    })).status).toBe(200);
    expect((await api(`/api/v1/admin/mail/inbox/${messageId}/draft`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'Need billing follow-up', body: 'Draft body' }),
    })).status).toBe(200);

    const detail = await api(`/api/v1/admin/mail/inbox/${messageId}`, { headers: { authorization: `Bearer ${adminToken}` } });
    const detailBody = await detail.json() as { data: { item: { status: string; tags: string[]; assigned_to_user_id: string | null; draft: { note: string } } } };
    expect(detailBody.data.item.status).toBe('open');
    expect(detailBody.data.item.tags).toContain('support');
    expect(detailBody.data.item.assigned_to_user_id).toBe('user_1');
    expect(detailBody.data.item.draft.note).toContain('billing');
  });

  it('sends outbound admin replies through SMTP2GO when configured', async () => {
    env.ADMIN_ALLOWLIST = 'mailadmin#0001';
    env.MAIL_WORKER_SECRET = 'mail-secret';
    env.SMTP2GO_API_KEY = 'api-test-key';
    env.SMTP2GO_DEFAULT_FROM = 'support@wyvernhub.net';
    env.SMTP2GO_DEFAULT_FROM_NAME = 'Wyvern Hub';
    const adminToken = await registerAndToken('mailadmin');

    const inboundBody = JSON.stringify({
      from_address: 'sender@example.com',
      from_name: 'Sender',
      to_address: 'support@wyvernhub.net',
      subject: 'Need help',
      text_body: 'Hello from the worker',
      source_message_id: '<abc@example.com>',
      headers: { 'x-source': 'test' },
    });
    const inboundSigned = await signBridgePayload(
      env.MAIL_WORKER_SECRET,
      new TextEncoder().encode(inboundBody).buffer.slice(0) as ArrayBuffer,
    );
    const ingest = await api('/api/v1/internal/mail/inbox', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Wyvern-Mail-Timestamp': inboundSigned.timestamp,
        'X-Wyvern-Mail-Signature': inboundSigned.signature,
      },
      body: inboundBody,
    });
    const ingestBody = await ingest.json() as { data: { item: { id: string } } };
    const messageId = ingestBody.data.item.id;

    const smtpFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      result: 'success',
      data: { email_id: 'smtp2go-message-1' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const send = await api(`/api/v1/admin/mail/inbox/${messageId}/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Thanks for reaching out.', close_after_send: true }),
    });
    expect(send.status).toBe(200);
    const [url, init] = smtpFetch.mock.calls[0] || [];
    expect(String(url)).toBe('https://api.smtp2go.com/v3/email/send');
    expect((init?.headers as Record<string, string>)['X-Smtp2go-Api-Key']).toBe('api-test-key');
    const smtpPayload = JSON.parse(String(init?.body || '{}'));
    expect(smtpPayload.to).toEqual(['sender@example.com']);
    expect(smtpPayload.subject).toBe('Re: Need help');
    expect(smtpPayload.text_body).toBe('Thanks for reaching out.');
    smtpFetch.mockRestore();

    const detail = await api(`/api/v1/admin/mail/inbox/${messageId}`, { headers: { authorization: `Bearer ${adminToken}` } });
    const detailBody = await detail.json() as { data: { item: { status: string; draft: { sent_at: string; provider_message_id: string; from_address: string } } } };
    expect(detailBody.data.item.status).toBe('closed');
    expect(detailBody.data.item.draft.provider_message_id).toBe('smtp2go-message-1');
    expect(detailBody.data.item.draft.from_address).toBe('support@wyvernhub.net');
    expect(detailBody.data.item.draft.sent_at).toBeTruthy();
  });

  it('enforces the original Wyvern rate-limit thresholds', async () => {
    const loginAttempts = [];
    for (let index = 0; index < 11; index += 1) {
      loginAttempts.push(await api('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' },
        body: JSON.stringify({ email: 'missing@example.com', password: 'wrong password' }),
      }));
    }
    expect(loginAttempts[9].status).toBe(401);
    expect(loginAttempts[10].status).toBe(429);
    expect(loginAttempts[10].headers.get('Retry-After')).toBeTruthy();

    resetRateLimits(env);
    const token = await registerAndToken('limitedmessages');
    const serverResponse = await api('/api/v1/servers', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Limits' }) });
    const server = await serverResponse.json() as { data: { id: string } };
    const channelResponse = await api(`/api/v1/channels/server/${server.data.id}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'general', type: 'text' }) });
    const channel = await channelResponse.json() as { data: { id: string } };
    const messages = [];
    for (let index = 0; index < 6; index += 1) {
      messages.push(await api(`/api/v1/messages/channels/${channel.data.id}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ content: `message ${index}` }),
      }));
    }
    expect(messages[4].status).toBe(200);
    expect(messages[5].status).toBe(429);
  });

  it('copies namespaces only after dry-run and explicit overwrite checks', async () => {
    env.ADMIN_ALLOWLIST = 'namespaceadmin#0001';
    const token = await registerAndToken('namespaceadmin');
    const dryRun = await api('/api/v1/runtime/migrate-namespace', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'test', target: 'production', dry_run: true }),
    });
    expect(dryRun.status).toBe(200);
    const dryBody = await dryRun.json() as { data: { source_digest: string; source_counts: { users: number } } };
    expect(dryBody.data.source_counts.users).toBe(1);

    const migrate = await api('/api/v1/runtime/migrate-namespace', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'test',
        target: 'production',
        dry_run: false,
        overwrite: true,
        expected_source_digest: dryBody.data.source_digest,
      }),
    });
    expect(migrate.status).toBe(200);
    const migrateBody = await migrate.json() as { data: { digest: string; backup_key: string } };
    expect(migrateBody.data.digest).toBe(dryBody.data.source_digest);
    expect(migrateBody.data.backup_key).toContain('pre-migration');

    const refused = await api('/api/v1/runtime/migrate-namespace', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'test', target: 'production', dry_run: false, overwrite: false }),
    });
    expect(refused.status).toBe(409);
  });

  it('creates daily and monthly scheduled backups', async () => {
    const token = await registerAndToken('backupuser');
    expect(token).toBeTruthy();
    const result = await runScheduledBackup(env, new Date('2026-07-01T03:00:00.000Z'));
    expect(result.keys).toHaveLength(2);
    expect(result.keys.some((key) => key.includes('/daily/2026-07-01'))).toBe(true);
    expect(result.keys.some((key) => key.includes('/monthly/2026-07-01'))).toBe(true);
    for (const key of result.keys) expect(await env.BACKUP_BUCKET?.head(key)).toBeTruthy();
  });


  it('exposes realtime websocket upgrade endpoint', async () => {
    const token = await registerAndToken('wsuser');
    const response = await api(`/api/v1/ws?token=${encodeURIComponent(token)}`, {
      headers: { Upgrade: 'websocket' }
    });
    expect(response.status).toBe(101);
    expect((response as Response & { webSocket?: unknown }).webSocket).toBeTruthy();
  });

  it('tracks websocket shim allocation for realtime sessions', async () => {
    const token = await registerAndToken('socketflow');
    const socket = await openSocket(token);
    socket.ws.send(JSON.stringify({ action: 'subscribe', channel_ids: ['channel_1'] }));
    socket.ws.send(JSON.stringify({ action: 'typing', channel_id: 'channel_1', active: true }));
    socket.ws.send(JSON.stringify({ action: 'typing', channel_id: 'channel_1', active: false }));
    socket.ws.send(JSON.stringify({ action: 'join_voice', channel_id: 'channel_1' }));
    socket.ws.send(JSON.stringify({ action: 'presence.update', payload: { status: 'online' } }));
    expect(env.__REALTIME_TEST__?.sockets).toBeGreaterThan(0);

    const snapshot = await api('/api/v1/ws/snapshot', { headers: { authorization: `Bearer ${token}` } });
    expect(snapshot.status).toBe(200);
    const snapshotBody = await snapshot.json() as { data: { backend: string; sessions: number; channels: string[]; subscriptions: Record<string, string[]>; voice_participants: Record<string, string[]> } };
    expect(snapshotBody.data.backend).toBe('shim');
    expect(snapshotBody.data.sessions).toBeGreaterThan(0);
    expect(snapshotBody.data.subscriptions).toBeDefined();
    expect(snapshotBody.data.voice_participants).toBeDefined();
    socket.requestDisconnect();
    await waitForShimSessions(token, 0);
  });

  it('supports multi-client realtime fanout and targeted signaling in shim mode', async () => {
    const alpha = await registerAndSession('alpha');
    const beta = await registerAndSession('beta');
    const gamma = await registerAndSession('gamma');

    const serverResponse = await api('/api/v1/servers', {
      method: 'POST',
      headers: { authorization: `Bearer ${alpha.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Realtime Builders' })
    });
    const server = await serverResponse.json() as { data: { id: string } };

    await api(`/api/v1/servers/${server.data.id}/join`, { method: 'POST', headers: { authorization: `Bearer ${beta.token}` } });
    await api(`/api/v1/servers/${server.data.id}/join`, { method: 'POST', headers: { authorization: `Bearer ${gamma.token}` } });

    const textChannelResponse = await api(`/api/v1/channels/server/${server.data.id}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${alpha.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'general', type: 'text' })
    });
    const textChannel = await textChannelResponse.json() as { data: { id: string } };

    const otherChannelResponse = await api(`/api/v1/channels/server/${server.data.id}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${alpha.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'random', type: 'text' })
    });
    const otherChannel = await otherChannelResponse.json() as { data: { id: string } };

    const voiceChannelResponse = await api(`/api/v1/channels/server/${server.data.id}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${alpha.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'voice', type: 'voice' })
    });
    const voiceChannel = await voiceChannelResponse.json() as { data: { id: string } };

    const alphaSocket = await openSocket(alpha.token);
    const betaSocket = await openSocket(beta.token);
    const gammaSocket = await openSocket(gamma.token);

    try {
      alphaSocket.ws.send(JSON.stringify({ action: 'subscribe', channel_ids: [textChannel.data.id, voiceChannel.data.id] }));
      betaSocket.ws.send(JSON.stringify({ action: 'subscribe', channel_ids: [textChannel.data.id, voiceChannel.data.id] }));
      gammaSocket.ws.send(JSON.stringify({ action: 'subscribe', channel_ids: [otherChannel.data.id] }));

      await alphaSocket.waitForMessage((message) => message.type === 'subscribed' && !!message.channel_ids?.includes(textChannel.data.id));
      await betaSocket.waitForMessage((message) => message.type === 'subscribed' && !!message.channel_ids?.includes(textChannel.data.id));
      await gammaSocket.waitForMessage((message) => message.type === 'subscribed' && !!message.channel_ids?.includes(otherChannel.data.id));

      const typingAlpha = alphaSocket.mark();
      const typingBeta = betaSocket.mark();
      const typingGamma = gammaSocket.mark();
      alphaSocket.ws.send(JSON.stringify({ action: 'typing', channel_id: textChannel.data.id, active: true }));
      await alphaSocket.waitForMessage((message) => message.event === 'typing.updated' && message.channel_id === textChannel.data.id && messageHasUserId(message, alpha.user.id), typingAlpha);
      await betaSocket.waitForMessage((message) => message.event === 'typing.updated' && message.channel_id === textChannel.data.id && messageHasUserId(message, alpha.user.id), typingBeta);
      await gammaSocket.expectNoMessage((message) => message.event === 'typing.updated' && message.channel_id === textChannel.data.id, typingGamma);

      const presenceAlpha = alphaSocket.mark();
      const presenceBeta = betaSocket.mark();
      const presenceGamma = gammaSocket.mark();
      betaSocket.ws.send(JSON.stringify({ action: 'presence.update', payload: { status: 'idle' } }));
      await alphaSocket.waitForMessage((message) => message.event === 'presence.updated' && message.data?.user_id === beta.user.id && message.data?.status === 'idle', presenceAlpha);
      await betaSocket.waitForMessage((message) => message.event === 'presence.updated' && message.data?.user_id === beta.user.id && message.data?.status === 'idle', presenceBeta);
      await gammaSocket.waitForMessage((message) => message.event === 'presence.updated' && message.data?.user_id === beta.user.id && message.data?.status === 'idle', presenceGamma);

      const messageAlpha = alphaSocket.mark();
      const messageBeta = betaSocket.mark();
      const messageGamma = gammaSocket.mark();
      const messageResponse = await api(`/api/v1/messages/channels/${textChannel.data.id}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${alpha.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'fanout message' })
      });
      const message = await messageResponse.json() as { data: { id: string; content: string } };
      await alphaSocket.waitForMessage((event) => event.event === 'message.created' && event.data?.id === message.data.id, messageAlpha);
      await betaSocket.waitForMessage((event) => event.event === 'message.created' && event.data?.id === message.data.id, messageBeta);
      await gammaSocket.expectNoMessage((event) => event.event === 'message.created' && event.data?.id === message.data.id, messageGamma);

      const reactionAlpha = alphaSocket.mark();
      const reactionBeta = betaSocket.mark();
      const reactionGamma = gammaSocket.mark();
      await api(`/api/v1/messages/${message.data.id}/reactions`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${beta.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ emoji: '🔥' })
      });
      await alphaSocket.waitForMessage((event) => event.event === 'reaction.added' && event.data?.message_id === message.data.id && event.data?.user_id === beta.user.id, reactionAlpha);
      await betaSocket.waitForMessage((event) => event.event === 'reaction.added' && event.data?.message_id === message.data.id && event.data?.user_id === beta.user.id, reactionBeta);
      await gammaSocket.expectNoMessage((event) => event.event === 'reaction.added' && event.data?.message_id === message.data.id, reactionGamma);

      const reactionRemoveAlpha = alphaSocket.mark();
      const reactionRemoveBeta = betaSocket.mark();
      const reactionRemoveGamma = gammaSocket.mark();
      await api(`/api/v1/messages/${message.data.id}/reactions?emoji=${encodeURIComponent('🔥')}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${beta.token}` }
      });
      await alphaSocket.waitForMessage((event) => event.event === 'reaction.removed' && event.data?.message_id === message.data.id && event.data?.user_id === beta.user.id, reactionRemoveAlpha);
      await betaSocket.waitForMessage((event) => event.event === 'reaction.removed' && event.data?.message_id === message.data.id && event.data?.user_id === beta.user.id, reactionRemoveBeta);
      await gammaSocket.expectNoMessage((event) => event.event === 'reaction.removed' && event.data?.message_id === message.data.id, reactionRemoveGamma);

      const voiceAlpha = alphaSocket.mark();
      const voiceBeta = betaSocket.mark();
      const voiceGamma = gammaSocket.mark();
      alphaSocket.ws.send(JSON.stringify({ action: 'join_voice', channel_id: voiceChannel.data.id }));
      await alphaSocket.waitForMessage((event) => event.event === 'voice.participants' && event.channel_id === voiceChannel.data.id && messageHasUserId(event, alpha.user.id), voiceAlpha);
      await betaSocket.waitForMessage((event) => event.event === 'voice.participants' && event.channel_id === voiceChannel.data.id && messageHasUserId(event, alpha.user.id), voiceBeta);
      await gammaSocket.expectNoMessage((event) => event.event === 'voice.participants' && event.channel_id === voiceChannel.data.id, voiceGamma);

      const voiceStatusAlpha = alphaSocket.mark();
      const voiceStatusBeta = betaSocket.mark();
      const voiceStatusGamma = gammaSocket.mark();
      alphaSocket.ws.send(JSON.stringify({ action: 'voice.status', channel_id: voiceChannel.data.id, payload: { muted: false } }));
      await alphaSocket.waitForMessage((event) => event.event === 'voice.status' && event.channel_id === voiceChannel.data.id && event.data?.user_id === alpha.user.id, voiceStatusAlpha);
      await betaSocket.waitForMessage((event) => event.event === 'voice.status' && event.channel_id === voiceChannel.data.id && event.data?.user_id === alpha.user.id, voiceStatusBeta);
      await gammaSocket.expectNoMessage((event) => event.event === 'voice.status' && event.channel_id === voiceChannel.data.id, voiceStatusGamma);

      const callSignalAlpha = alphaSocket.mark();
      const callSignalBeta = betaSocket.mark();
      const callSignalGamma = gammaSocket.mark();
      alphaSocket.ws.send(JSON.stringify({
        action: 'call.signal',
        channel_id: voiceChannel.data.id,
        target_user_id: beta.user.id,
        signal_type: 'offer',
        payload: { sdp: 'demo-offer' }
      }));
      await betaSocket.waitForMessage((event) => event.event === 'call.signal' && event.channel_id === voiceChannel.data.id && event.data?.from_user_id === alpha.user.id && event.data?.target_user_id === beta.user.id && event.data?.signal_type === 'offer', callSignalBeta);
      await alphaSocket.expectNoMessage((event) => event.event === 'call.signal' && event.channel_id === voiceChannel.data.id, callSignalAlpha);
      await gammaSocket.expectNoMessage((event) => event.event === 'call.signal' && event.channel_id === voiceChannel.data.id, callSignalGamma);

      const snapshot = await api('/api/v1/ws/snapshot', { headers: { authorization: `Bearer ${alpha.token}` } });
      expect(snapshot.status).toBe(200);
      const snapshotBody = await snapshot.json() as { data: { backend: string; sessions: number; subscriptions: Record<string, string[]>; typing_users: Record<string, string[]>; voice_participants: Record<string, string[]> } };
      expect(snapshotBody.data.backend).toBe('shim');
      expect(snapshotBody.data.sessions).toBe(3);
      expect(Object.values(snapshotBody.data.subscriptions)).toContainEqual(expect.arrayContaining([textChannel.data.id, voiceChannel.data.id]));
      expect(snapshotBody.data.typing_users[textChannel.data.id]).toContain(alpha.user.id);
      expect(snapshotBody.data.voice_participants[voiceChannel.data.id]).toContain(alpha.user.id);
    } finally {
      alphaSocket.requestDisconnect();
      betaSocket.requestDisconnect();
      gammaSocket.requestDisconnect();
      await waitForShimSessions(alpha.token, 0);
    }
  });


  it('supports bookmarks and keeps unauthenticated sync bootstrap unavailable', async () => {
    const token = await registerAndToken('bookmarker');
    const serverResponse = await api('/api/v1/servers', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Bookmarks' }) });
    const server = await serverResponse.json() as { data: { id: string } };
    const channelResponse = await api(`/api/v1/channels/server/${server.data.id}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'general', type: 'text' }) });
    const channel = await channelResponse.json() as { data: { id: string } };
    const messageResponse = await api(`/api/v1/messages/channels/${channel.data.id}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ content: 'save me' }) });
    const message = await messageResponse.json() as { data: { id: string } };

    const pinResponse = await api(`/api/v1/messages/${message.data.id}/pin`, { method: 'PUT', headers: { authorization: `Bearer ${token}` } });
    expect(pinResponse.status).toBe(200);
    const pinsList = await api(`/api/v1/messages/pins/channels/${channel.data.id}`, { headers: { authorization: `Bearer ${token}` } });
    expect(pinsList.status).toBe(200);
    const unpinResponse = await api(`/api/v1/messages/${message.data.id}/pin`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    expect(unpinResponse.status).toBe(200);

    const bookmarkResponse = await api(`/api/v1/messages/${message.data.id}/bookmark`, { method: 'PUT', headers: { authorization: `Bearer ${token}` } });
    expect(bookmarkResponse.status).toBe(200);

    const listResponse = await api('/api/v1/messages/bookmarks', { headers: { authorization: `Bearer ${token}` } });
    expect(listResponse.status).toBe(200);

    const syncBootstrap = await api('/api/v1/internal/sync/bootstrap', { method: 'POST' });
    expect(syncBootstrap.status).toBe(503);
  });


  it('supports invites legal and admin release endpoints', async () => {
    env.ADMIN_ALLOWLIST = 'axel#0001';
    const adminToken = await registerAndToken('axel');
    const memberToken = await registerAndToken('bea');

    const serverResponse = await api('/api/v1/servers', { method: 'POST', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Invites' }) });
    const server = await serverResponse.json() as { data: { id: string } };

    const inviteCreate = await api(`/api/v1/servers/${server.data.id}/invites`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}` } });
    expect(inviteCreate.status).toBe(200);
    const invite = await inviteCreate.json() as { data: { code: string } };

    const inviteLookup = await api(`/api/v1/servers/invites/${invite.data.code}`);
    expect(inviteLookup.status).toBe(200);

    const inviteJoin = await api(`/api/v1/servers/invites/${invite.data.code}/join`, { method: 'POST', headers: { authorization: `Bearer ${memberToken}` } });
    expect(inviteJoin.status).toBe(200);

    const legalCurrent = await api('/api/v1/legal/current');
    expect(legalCurrent.status).toBe(200);

    const legalAccept = await api('/api/v1/legal/accept', { method: 'POST', headers: { authorization: `Bearer ${memberToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ accepted_legal: true, terms_version: '2026-05-22', privacy_version: '2026-05-22' }) });
    expect(legalAccept.status).toBe(200);

    const releaseAudit = await api('/api/v1/admin/releases/audit', { headers: { authorization: `Bearer ${adminToken}` } });
    expect(releaseAudit.status).toBe(200);

    const releasePromote = await api('/api/v1/admin/releases/promote', { method: 'POST', headers: { authorization: `Bearer ${adminToken}` } });
    expect(releasePromote.status).toBe(200);
  });


  it('returns shell-compatible directory dm and message payloads', async () => {
    const tokenA = await registerAndToken('shapea');
    const tokenB = await registerAndToken('shapeb');

    await api('/api/v1/users/me', { method: 'PATCH', headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' }, body: JSON.stringify({ directory_opt_in: true, display_name: 'Shape A' }) });
    await api('/api/v1/users/me', { method: 'PATCH', headers: { authorization: `Bearer ${tokenB}`, 'content-type': 'application/json' }, body: JSON.stringify({ directory_opt_in: true, display_name: 'Shape B' }) });

    const usersDirectory = await api('/api/v1/users/directory', { headers: { authorization: `Bearer ${tokenA}` } });
    expect(usersDirectory.status).toBe(200);
    const usersDirectoryBody = await usersDirectory.json() as { data: Array<Record<string, unknown>> };
    expect(usersDirectoryBody.data.length).toBeGreaterThan(0);
    expect(usersDirectoryBody.data[0]).toHaveProperty('id');
    expect(usersDirectoryBody.data[0]).toHaveProperty('username');
    expect(usersDirectoryBody.data[0]).not.toHaveProperty('user');

    const dmCreate = await api('/api/v1/dms', { method: 'POST', headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' }, body: JSON.stringify({ recipient_id: 'user_2' }) });
    expect(dmCreate.status).toBe(200);
    const dmBody = await dmCreate.json() as { data: Record<string, any> };
    expect(Array.isArray(dmBody.data.participants)).toBe(true);
    expect(dmBody.data.participants[0]).toHaveProperty('id');
    expect(dmBody.data).toHaveProperty('recipient');
    expect(dmBody.data).toHaveProperty('display_name');

    const serverResponse = await api('/api/v1/servers', { method: 'POST', headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Shape Server', directory_opt_in: true }) });
    const server = await serverResponse.json() as { data: { id: string } };
    const channelResponse = await api(`/api/v1/channels/server/${server.data.id}`, { method: 'POST', headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'general', type: 'text' }) });
    const channel = await channelResponse.json() as { data: { id: string } };
    const messageResponse = await api(`/api/v1/messages/channels/${channel.data.id}`, { method: 'POST', headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' }, body: JSON.stringify({ content: 'shape hello' }) });
    const message = await messageResponse.json() as { data: Record<string, any> };
    expect(message.data).toHaveProperty('author');
    expect(message.data.author).toHaveProperty('id');

    const messagesList = await api(`/api/v1/messages/channels/${channel.data.id}`, { headers: { authorization: `Bearer ${tokenA}` } });
    expect(messagesList.status).toBe(200);
    const messagesBody = await messagesList.json() as { data: { items: Array<Record<string, any>> } };
    expect(messagesBody.data.items[0]).toHaveProperty('author');
  });

  it('covers directory members activity read-state and runtime diagnostics', async () => {
    env.ADMIN_ALLOWLIST = 'directorya#0001';
    const tokenA = await registerAndToken('directorya');
    const tokenB = await registerAndToken('directoryb');

    const serverResponse = await api('/api/v1/servers', { method: 'POST', headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Directory Server', directory_opt_in: true }) });
    const server = await serverResponse.json() as { data: { id: string } };
    await api(`/api/v1/servers/${server.data.id}/join`, { method: 'POST', headers: { authorization: `Bearer ${tokenB}` } });

    const channelResponse = await api(`/api/v1/channels/server/${server.data.id}`, { method: 'POST', headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'general', type: 'text' }) });
    const channel = await channelResponse.json() as { data: { id: string } };

    const messageResponse = await api(`/api/v1/messages/channels/${channel.data.id}`, { method: 'POST', headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello directory' }) });
    const message = await messageResponse.json() as { data: { id: string } };

    expect((await api('/api/v1/users/lookup?q=directorya', { headers: { authorization: `Bearer ${tokenA}` } })).status).toBe(200);
    expect((await api('/api/v1/users/directory', { headers: { authorization: `Bearer ${tokenA}` } })).status).toBe(200);
    expect((await api('/api/v1/servers/directory', { headers: { authorization: `Bearer ${tokenA}` } })).status).toBe(200);
    expect((await api(`/api/v1/servers/${server.data.id}/members`, { headers: { authorization: `Bearer ${tokenA}` } })).status).toBe(200);
    expect((await api(`/api/v1/servers/${server.data.id}/members/user_2`, { method: 'PATCH', headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'moderator' }) })).status).toBe(200);
    expect((await api(`/api/v1/servers/${server.data.id}/activity`, { headers: { authorization: `Bearer ${tokenA}` } })).status).toBe(200);
    expect((await api(`/api/v1/channels/${channel.data.id}/read-state`, { method: 'PUT', headers: { authorization: `Bearer ${tokenB}`, 'content-type': 'application/json' }, body: JSON.stringify({ last_read_message_id: message.data.id }) })).status).toBe(200);
    expect((await api('/api/v1/users/me/read-states', { headers: { authorization: `Bearer ${tokenB}` } })).status).toBe(200);
    expect((await api('/api/v1/runtime/ui-variants', { headers: { authorization: `Bearer ${tokenA}` } })).status).toBe(404);
    expect((await api('/api/v1/runtime/ui-variants/vote', { method: 'PUT', headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' }, body: JSON.stringify({ variant_key: 'ui_a' }) })).status).toBe(404);
    expect((await api('/api/v1/runtime/export-state', { headers: { authorization: `Bearer ${tokenA}` } })).status).toBe(200);

    const diagnostics = await api('/api/v1/runtime/diagnostics', { headers: { authorization: `Bearer ${tokenA}` } });
    expect(diagnostics.status).toBe(200);
    const diagnosticsBody = await diagnostics.json() as {
      data: {
        persistence_mode: string;
        realtime_mode: string;
        media_mode: string;
        bindings: { presence_room: boolean; app_state_room: boolean; realtime_hub: boolean; media_bucket: boolean };
      };
    };
    expect(diagnosticsBody.data.persistence_mode).toBe('memory');
    expect(diagnosticsBody.data.realtime_mode).toBe('shim');
    expect(diagnosticsBody.data.media_mode).toBe('app_state');
    expect(diagnosticsBody.data.bindings.presence_room).toBe(true);
    expect(diagnosticsBody.data.bindings.app_state_room).toBe(false);
    expect(diagnosticsBody.data.bindings.realtime_hub).toBe(false);
    expect(diagnosticsBody.data.bindings.media_bucket).toBe(false);

    expect((await api('/api/v1/runtime/verify/state-room', { headers: { authorization: `Bearer ${tokenA}` } })).status).toBe(503);
    expect((await api('/api/v1/runtime/verify/realtime-hub', { headers: { authorization: `Bearer ${tokenA}` } })).status).toBe(503);
    expect((await api('/api/v1/runtime/verify/realtime-connect', { method: 'POST', headers: { authorization: `Bearer ${tokenA}` } })).status).toBe(503);
    expect((await api('/api/v1/runtime/verify/media-bucket/nonexistent', { headers: { authorization: `Bearer ${tokenA}` } })).status).toBe(503);
  });


  it('serves public legal pages', async () => {
    const terms = await api('/legal/terms');
    expect(terms.status).toBe(200);
    const privacy = await api('/legal/privacy');
    expect(privacy.status).toBe(200);
    expect((await api('/legal/terms')).status).toBe(200);
    expect((await api('/legal/privacy')).status).toBe(200);
    expect((await api('/legal/unknown')).status).toBe(404);
  });


  it('keeps legacy UI variants on non-production internal test routes', async () => {
    expect((await api('/invite/demo-code')).status).toBe(200);
    expect((await api('/edge')).status).toBe(404);
    expect((await api('/edge/ui/original')).status).toBe(404);
    expect((await api('/__internal/test/ui/original')).status).toBe(200);
    expect((await api('/__internal/test/ui/a')).status).toBe(200);
    expect((await api('/__internal/test/ui/b')).status).toBe(200);
    expect((await api('/admin')).status).toBe(200);
    expect((await api('/admin/')).status).toBe(200);
    expect((await api('/changelog.md')).status).toBe(200);
    expect((await api('/wyvern_logo.png')).status).toBe(200);
    expect((await api('/wyvern_logo_transparent.png')).status).toBe(200);
    expect((await api('/mcp-doc/demo-ticket')).status).toBe(404);
  });


  it('serves auth callback page', async () => {
    expect((await api('/auth/callback')).status).toBe(200);
  });


  it('records realtime event payloads', async () => {
    const token = await registerAndToken('events');
    const serverResponse = await api('/api/v1/servers', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Events' }) });
    const server = await serverResponse.json() as { data: { id: string } };
    const channelResponse = await api(`/api/v1/channels/server/${server.data.id}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'general', type: 'text' }) });
    const channel = await channelResponse.json() as { data: { id: string } };
    await api('/api/v1/users/me', { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ display_name: 'Events User' }) });
    const messageResponse = await api(`/api/v1/messages/channels/${channel.data.id}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ content: 'hello' }) });
    const message = await messageResponse.json() as { data: { id: string } };
    await api(`/api/v1/messages/${message.data.id}/reactions`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ emoji: '🔥' }) });
    const events = await api('/api/v1/ws/events', { headers: { authorization: `Bearer ${token}` } });
    expect(events.status).toBe(200);
    const body = await events.json() as { data: { items: Array<{ event: string }> } };
    expect(body.data.items.some((item) => item.event === 'server.created')).toBe(true);
    expect(body.data.items.some((item) => item.event === 'server.member.created')).toBe(true);
    expect(body.data.items.some((item) => item.event === 'user.updated')).toBe(true);
    expect(body.data.items.some((item) => item.event === 'channel.created')).toBe(true);
    expect(body.data.items.some((item) => item.event === 'message.created')).toBe(true);
    expect(body.data.items.some((item) => item.event === 'reaction.added')).toBe(true);
  });


  it('records update and delete realtime events for shell reducers', async () => {
    const token = await registerAndToken('mutations');
    const serverResponse = await api('/api/v1/servers', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Mutable' })
    });
    const server = await serverResponse.json() as { data: { id: string } };

    const channelResponse = await api(`/api/v1/channels/server/${server.data.id}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'general', type: 'text' })
    });
    const channel = await channelResponse.json() as { data: { id: string } };

    const messageResponse = await api(`/api/v1/messages/channels/${channel.data.id}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'draft' })
    });
    const message = await messageResponse.json() as { data: { id: string } };

    await api(`/api/v1/servers/${server.data.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Mutable Updated' })
    });
    await api(`/api/v1/channels/${channel.data.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'general-2' })
    });
    await api(`/api/v1/messages/${message.data.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'published' })
    });
    await api(`/api/v1/messages/${message.data.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` }
    });
    await api(`/api/v1/channels/${channel.data.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` }
    });
    await api(`/api/v1/servers/${server.data.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` }
    });

    const events = await api('/api/v1/ws/events', { headers: { authorization: `Bearer ${token}` } });
    expect(events.status).toBe(200);
    const body = await events.json() as { data: { items: Array<{ event: string }> } };
    expect(body.data.items.some((item) => item.event === 'server.updated')).toBe(true);
    expect(body.data.items.some((item) => item.event === 'channel.updated')).toBe(true);
    expect(body.data.items.some((item) => item.event === 'message.updated')).toBe(true);
    expect(body.data.items.some((item) => item.event === 'message.deleted')).toBe(true);
    expect(body.data.items.some((item) => item.event === 'channel.deleted')).toBe(true);
    expect(body.data.items.some((item) => item.event === 'server.deleted')).toBe(true);
  });


  it('supports edge api alias and event emit endpoint', async () => {
    const token = await registerAndToken('edgeuser');
    const edgeHealth = await api('/edge/api/v1/health');
    expect(edgeHealth.status).toBe(200);
    const edgeWs = await api(`/api/v1/edge/ws?token=${encodeURIComponent(token)}`);
    expect(edgeWs.status).toBe(426);
    const emit = await api('/api/v1/ws/emit', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ event: 'typing.updated', payload: { channel_id: 'channel_1', user_ids: ['user_1'] } }) });
    expect(emit.status).toBe(200);
  });

  it('does not expose AI model routes before AI is designed and costed', async () => {
    const response = await api('/api/v1/openai/v1/models');
    expect(response.status).toBe(404);
    expect((await api('/api/v1/openai/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'demo', messages: [] }) })).status).toBe(404);
    expect((await api('/api/v1/openai/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'demo', input: 'hi' }) })).status).toBe(404);
  });

  it('does not expose MCP OAuth or transport endpoints before an AI launch', async () => {
    const requests = [
      api('/api/v1/mcp/sse'),
      api('/.well-known/oauth-protected-resource/mcp'),
      api('/mcp/.well-known/oauth-authorization-server'),
      api('/mcp/.well-known/openid-configuration'),
      api('/.well-known/oauth-authorization-server/mcp'),
      api('/.well-known/openid-configuration/mcp'),
      api('/mcp/authorize'),
      api('/mcp/authorize', { method: 'POST' }),
      api('/mcp/token', { method: 'POST' }),
      api('/mcp/register', { method: 'POST' }),
      api('/mcp/oauth/authorize'),
      api('/mcp/oauth/authorize', { method: 'POST' }),
      api('/mcp'),
      api('/mcp/', { method: 'POST' }),
      api('/mcp', { method: 'OPTIONS' }),
    ];
    const responses = await Promise.all(requests);
    responses.slice(0, -1).forEach((response) => expect(response.status).toBe(404));
    // CORS handles an OPTIONS preflight before route matching; it exposes no
    // transport or authorization behavior.
    expect(responses.at(-1)?.status).toBe(204);
  });

  it('enforces signed Wyv bridge session exchange when configured', async () => {
    env.WYV_SHARED_SECRET = 'test-bridge-secret';
    const token = await registerAndToken('bridgeuser');
    const handoff = await api('/api/v1/auth/edge-handoff', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    const handoffBody = await handoff.json() as { data: { grant: string } };

    const bad = await api('/api/v1/internal/wyv/session-exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant: handoffBody.data.grant }),
    });
    expect(bad.status).toBe(401);

    const body = JSON.stringify({ grant: handoffBody.data.grant });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(env.WYV_SHARED_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const payload = new Uint8Array(timestamp.length + 1 + body.length);
    payload.set(encoder.encode(timestamp));
    payload.set(encoder.encode('.'), timestamp.length);
    payload.set(encoder.encode(body), timestamp.length + 1);
    const sigBuffer = await crypto.subtle.sign('HMAC', key, payload);
    const signature = Array.from(new Uint8Array(sigBuffer)).map((item) => item.toString(16).padStart(2, '0')).join('');

    const good = await api('/api/v1/internal/wyv/session-exchange', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Wyv-Bridge-Timestamp': timestamp,
        'X-Wyv-Bridge-Signature': signature,
      },
      body,
    });
    expect(good.status).toBe(200);
    env.WYV_SHARED_SECRET = undefined as never;
  });

  it('enforces signed sync bootstrap when configured', async () => {
    env.WYV_SHARED_SECRET = 'test-sync-secret';
    const unauthorized = await api('/api/v1/internal/sync/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(unauthorized.status).toBe(401);

    const body = JSON.stringify({ mode: 'bootstrap' });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(env.WYV_SHARED_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const payload = new Uint8Array(timestamp.length + 1 + body.length);
    payload.set(encoder.encode(timestamp));
    payload.set(encoder.encode('.'), timestamp.length);
    payload.set(encoder.encode(body), timestamp.length + 1);
    const sigBuffer = await crypto.subtle.sign('HMAC', key, payload);
    const signature = Array.from(new Uint8Array(sigBuffer)).map((item) => item.toString(16).padStart(2, '0')).join('');

    const authorized = await api('/api/v1/internal/sync/bootstrap', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Wyvern-Bridge-Timestamp': timestamp,
        'X-Wyvern-Bridge-Signature': signature,
      },
      body,
    });
    expect(authorized.status).toBe(200);
    env.WYV_SHARED_SECRET = undefined as never;
  });

});
