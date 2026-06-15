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

async function registerAndToken(username: string, email?: string) {
  const register = await api('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, email: email || `${username}@example.com`, password: 'correct horse battery', accepted_legal: true, terms_version: '2026-05-22', privacy_version: '2026-05-22' }),
  });
  const body = await register.json() as { data: { tokens: { access_token: string } } };
  return body.data.tokens.access_token;
}

describe('wyvern workers api', () => {
  beforeEach(() => {
    resetRepository(env);
    env.ADMIN_ALLOWLIST = '';
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

  it('supports api tokens and wyv introspection', async () => {
    const token = await registerAndToken('axel');
    const createResponse = await api('/api/v1/ai/api-tokens', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Primary' }) });
    expect(createResponse.status).toBe(200);
    const created = await createResponse.json() as { data: { token: { token: string } } };

    const introspectResponse = await api('/api/v1/internal/wyv/api-token-introspect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: created.data.token.token }) });
    expect(introspectResponse.status).toBe(200);

    expect((await api('/api/v1/ai/api-tokens/revoke-all', { method: 'POST', headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await api('/api/v1/ai/api-tokens/rotate-all', { method: 'POST', headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await api('/api/v1/ai/mcp-connection', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await api('/api/v1/ai/mcp-connection', { method: 'POST', headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await api('/api/v1/ai/mcp-connection', { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
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
    const response = await api(`/api/v1/ws?token=${encodeURIComponent(token)}`, {
      headers: { Upgrade: 'websocket' }
    });
    const ws = (response as Response & { webSocket?: WebSocket }).webSocket!;
    ws.accept();
    ws.send(JSON.stringify({ action: 'subscribe', channel_ids: ['channel_1'] }));
    ws.send(JSON.stringify({ action: 'typing', channel_id: 'channel_1', active: true }));
    ws.send(JSON.stringify({ action: 'typing', channel_id: 'channel_1', active: false }));
    ws.send(JSON.stringify({ action: 'join_voice', channel_id: 'channel_1' }));
    ws.send(JSON.stringify({ action: 'presence.update', payload: { status: 'online' } }));
    expect(env.__REALTIME_TEST__?.sockets).toBeGreaterThan(0);

    const snapshot = await api('/api/v1/ws/snapshot', { headers: { authorization: `Bearer ${token}` } });
    expect(snapshot.status).toBe(200);
    const snapshotBody = await snapshot.json() as { data: { backend: string; sessions: number; channels: string[]; subscriptions: Record<string, string[]>; voice_participants: Record<string, string[]> } };
    expect(snapshotBody.data.backend).toBe('shim');
    expect(snapshotBody.data.sessions).toBeGreaterThan(0);
    expect(snapshotBody.data.subscriptions).toBeDefined();
    expect(snapshotBody.data.voice_participants).toBeDefined();
  });


  it('supports bookmarks and sync endpoints', async () => {
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
    expect(syncBootstrap.status).toBe(200);
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

  it('covers directory members activity read-state and runtime variants', async () => {
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
    expect((await api('/api/v1/runtime/ui-variants', { headers: { authorization: `Bearer ${tokenA}` } })).status).toBe(200);
    expect((await api('/api/v1/runtime/ui-variants/vote', { method: 'PUT', headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' }, body: JSON.stringify({ variant_key: 'ui_a' }) })).status).toBe(200);
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


  it('serves edge shell and admin public assets', async () => {
    expect((await api('/invite/demo-code')).status).toBe(200);
    expect((await api('/edge')).status).toBe(200);
    expect((await api('/edge/')).status).toBe(200);
    expect((await api('/edge/ui')).status).toBe(200);
    expect((await api('/edge/ui/original')).status).toBe(200);
    expect((await api('/edge/ui/a')).status).toBe(200);
    expect((await api('/edge/ui/b')).status).toBe(200);
    expect((await api('/admin')).status).toBe(200);
    expect((await api('/admin/')).status).toBe(200);
    expect((await api('/changelog.md')).status).toBe(200);
    expect((await api('/wyvern_logo.png')).status).toBe(200);
    expect((await api('/wyvern_logo_transparent.png')).status).toBe(200);
    expect((await api('/mcp-doc/demo-ticket')).status).toBe(200);
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

  it('returns gateway moved for legacy openai routes', async () => {
    const response = await api('/api/v1/openai/v1/models');
    expect(response.status).toBe(410);
    expect((await api('/api/v1/openai/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'demo', messages: [] }) })).status).toBe(410);
    expect((await api('/api/v1/openai/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'demo', input: 'hi' }) })).status).toBe(410);
  });

  it('serves MCP OAuth compatibility endpoints', async () => {
    expect((await api('/.well-known/oauth-protected-resource/mcp')).status).toBe(200);
    expect((await api('/mcp/.well-known/oauth-authorization-server')).status).toBe(200);
    expect((await api('/mcp/.well-known/openid-configuration')).status).toBe(200);
    expect((await api('/.well-known/oauth-authorization-server/mcp')).status).toBe(200);
    expect((await api('/.well-known/openid-configuration/mcp')).status).toBe(200);
    expect((await api('/mcp/authorize')).status).toBe(200);
    expect((await api('/mcp/authorize', { method: 'POST' })).status).toBe(200);
    expect((await api('/mcp/token', { method: 'POST' })).status).toBe(200);
    expect((await api('/mcp/register', { method: 'POST' })).status).toBe(201);
    expect((await api('/mcp/oauth/authorize')).status).toBe(200);
    expect((await api('/mcp/oauth/authorize', { method: 'POST' })).status).toBe(200);
    expect((await api('/mcp')).status).toBe(200);
    expect((await api('/mcp/', { method: 'POST' })).status).toBe(200);
    expect((await api('/mcp', { method: 'OPTIONS' })).status).toBe(204);
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
