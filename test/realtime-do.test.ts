import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src';
import { resetRepository } from '../src/lib/state';
import { bindTestSocket } from './realtime.helpers';

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

async function registerAndSession(username: string) {
  const token = await registerAndToken(username);
  const meResponse = await api('/api/v1/users/me', { headers: { authorization: `Bearer ${token}` } });
  const meBody = await meResponse.json() as { data: { id: string; username: string } };
  return { token, user: meBody.data };
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

async function waitForDurableSessions(token: string, expected: number) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const snapshot = await api('/api/v1/ws/snapshot', { headers: { authorization: `Bearer ${token}` } });
    const snapshotBody = await snapshot.json() as { data: { sessions: number } };
    if (snapshotBody.data.sessions === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for durable sessions=${expected}`);
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

  it('supports multi-client realtime fanout and targeted signaling in durable object mode', async () => {
    const alpha = await registerAndSession('doalpha');
    const beta = await registerAndSession('dobeta');
    const gamma = await registerAndSession('dogamma');

    const serverResponse = await api('/api/v1/servers', {
      method: 'POST',
      headers: { authorization: `Bearer ${alpha.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'DO Realtime Builders' })
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
        body: JSON.stringify({ content: 'do fanout message' })
      });
      const message = await messageResponse.json() as { data: { id: string } };
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
        payload: { sdp: 'durable-offer' }
      }));
      await betaSocket.waitForMessage((event) => event.event === 'call.signal' && event.channel_id === voiceChannel.data.id && event.data?.from_user_id === alpha.user.id && event.data?.target_user_id === beta.user.id && event.data?.signal_type === 'offer', callSignalBeta);
      await alphaSocket.expectNoMessage((event) => event.event === 'call.signal' && event.channel_id === voiceChannel.data.id, callSignalAlpha);
      await gammaSocket.expectNoMessage((event) => event.event === 'call.signal' && event.channel_id === voiceChannel.data.id, callSignalGamma);

      const snapshot = await api('/api/v1/ws/snapshot', { headers: { authorization: `Bearer ${alpha.token}` } });
      expect(snapshot.status).toBe(200);
      const snapshotBody = await snapshot.json() as { data: { backend: string; sessions: number; subscriptions: Record<string, string[]>; typing_users: Record<string, string[]>; voice_participants: Record<string, string[]> } };
      expect(snapshotBody.data.backend).toBe('durable_object');
      expect(snapshotBody.data.sessions).toBe(3);
      expect(Object.values(snapshotBody.data.subscriptions)).toContainEqual(expect.arrayContaining([textChannel.data.id, voiceChannel.data.id]));
      expect(snapshotBody.data.typing_users[textChannel.data.id]).toContain(alpha.user.id);
      expect(snapshotBody.data.voice_participants[voiceChannel.data.id]).toContain(alpha.user.id);
    } finally {
      alphaSocket.requestDisconnect();
      betaSocket.requestDisconnect();
      gammaSocket.requestDisconnect();
      await waitForDurableSessions(alpha.token, 0);
    }
  });
});
