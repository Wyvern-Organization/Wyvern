import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { getConfig } from '../lib/config';
import { errorResponse, successResponse } from '../lib/responses';
import { issueAccessToken, issueWyvHandoffGrant, readBearerToken, verifyAccessToken } from '../lib/auth';
import type { AuthenticatedUser, Env } from '../lib/types';
import { dmHiddenKey, dmParticipantKey, getRefreshTokenByHash, getUserByEmail, listChannelMessages, listDmParticipants, listMessageReactions, listServerChannels, listServerMembers, listUserDms, listUserServers, loadRepository, memberKey, readStateKey, reactionKey } from '../lib/state';
import { decodeWyvHandoffGrant, futureIso, hashPassword, hashToken, isExpired, legalVersions, nowIso, randomToken, requiresLegalReacceptance, verifyBridgeSignature, verifyPassword } from '../lib/security';
import { encodeMediaBytes, saveMediaObject } from '../lib/media';
import type { ApiTokenRecord, ChannelRecord, CommunityActivityRecord, MediaObjectRecord, MemberRole, MessageRecord, ServerRecord, UserRecord, WebhookRecord, WorkspaceDocumentRecord, WorkspaceRevisionRecord } from '../lib/domain';

const registerSchema = z.object({ username: z.string().min(2).max(80), display_name: z.string().min(1).max(80).optional(), email: z.string().email(), password: z.string().min(8), accepted_legal: z.boolean(), terms_version: z.string(), privacy_version: z.string() });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const refreshSchema = z.object({ refresh_token: z.string().min(1) });
const logoutSchema = refreshSchema;
const presenceSchema = z.object({ status: z.enum(['online', 'idle', 'dnd']) });
const serverCreateSchema = z.object({ name: z.string().min(2).max(120), description: z.string().max(512).nullish(), icon: z.string().nullish(), directory_opt_in: z.boolean().default(false) });
const serverUpdateSchema = serverCreateSchema.partial();
const channelCreateSchema = z.object({ name: z.string().min(1).max(120), type: z.enum(['text', 'voice', 'dm']).default('text'), position: z.number().int().default(0), category: z.string().nullish() });
const channelUpdateSchema = z.object({ name: z.string().min(1).max(120).optional(), position: z.number().int().optional(), category: z.string().nullable().optional() });
const dmCreateSchema = z.object({ recipient_id: z.string().min(1) });
const messageCreateSchema = z.object({ content: z.string().max(4000).default(''), attachments: z.array(z.string()).max(12).default([]), reply_to_id: z.string().nullable().optional(), is_nsfw: z.boolean().default(false) });
const messageUpdateSchema = z.object({ content: z.string().max(4000) });
const reactionSchema = z.object({ emoji: z.string().min(1).max(64) });
const readStateSchema = z.object({ last_read_message_id: z.string().nullable().optional() });
const webhookCreateSchema = z.object({ name: z.string().min(2).max(120), description: z.string().max(255).nullable().optional(), channel_id: z.string().min(1) });
const webhookMessageSchema = z.object({ content: z.string().max(4000).default(''), attachments: z.array(z.string()).max(12).default([]), username: z.string().max(120).nullable().optional(), avatar_url: z.string().max(1024).nullable().optional(), reply_to_id: z.string().nullable().optional() });
const workspaceUpdateSchema = z.object({ title: z.string().max(120).nullable().optional(), mode: z.string().max(16).nullable().optional(), language: z.string().max(32).nullable().optional(), visibility: z.string().max(16).nullable().optional(), content: z.string().max(200000).default(''), log_activity: z.boolean().default(false) });
const uiVariantVoteSchema = z.object({ variant_key: z.enum(['original', 'ui_a', 'ui_b']) });
const apiTokenCreateSchema = z.object({ name: z.string().min(1).max(120) });
const wyvGrantSchema = z.object({ grant: z.string().min(1) });
const wyvTokenIntrospectSchema = z.object({ token: z.string().min(1) });

type AppContext = Context<{ Bindings: Env }>;
const testPresence = new Map<string, string>();
const LEGAL_CONTACT_EMAIL = 'legal@wyvernhub.net';
const SUPPORT_CONTACT_EMAIL = 'support@wyvernhub.net';
const OPERATOR_NAME = 'Wyvern Team';
const UI_VARIANTS = {
  original: { key: 'original', label: 'Original', route: '/edge' },
  ui_a: { key: 'ui_a', label: 'UI A', route: '/edge/ui-a' },
  ui_b: { key: 'ui_b', label: 'UI B', route: '/edge/ui-b' },
} as const;

async function emitRealtime(env: Env, type: string, payload: Record<string, unknown>, channelId: string | null = null) {
  if (env.__REALTIME_TEST__) {
    env.__REALTIME_TEST__.events.push({ type, payload, channel_id: channelId });
  }
  if (env.REALTIME_HUB) {
    const stub = env.REALTIME_HUB.get(env.REALTIME_HUB.idFromName('global'));
    await stub.fetch('https://realtime.internal/emit', {
      method: 'POST',
      body: JSON.stringify({ type, payload, channel_id: channelId }),
    });
  }
}

async function handleWebSocketUpgrade(c: Context<{ Bindings: Env }>, auth: AuthenticatedUser) {
  if (!c.env.REALTIME_HUB) {
    return testRealtimeUpgrade(c.env);
  }
  const stub = c.env.REALTIME_HUB.get(c.env.REALTIME_HUB.idFromName('global'));
  const headers = new Headers(c.req.header());
  headers.set('x-wyvern-user', JSON.stringify(auth));
  headers.set('Upgrade', 'websocket');
  headers.set('x-wyvern-realtime-backend', 'durable_object');
  
  const response = await stub.fetch(new Request('https://realtime.internal/connect', {
    headers: headers,
  }));
  return response;
}

function testRealtimeUpgrade(env: Env) {
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();
  if (!env.__REALTIME_TEST__) env.__REALTIME_TEST__ = { events: [], sockets: 0, subscriptions: {}, typingUsers: {}, voiceParticipants: {}, messages: [] };
  env.__REALTIME_TEST__.sockets += 1;
  const record = (payload: string) => {
    env.__REALTIME_TEST__!.messages.push(payload);
    server.send(payload);
  };
  server.addEventListener('message', (event) => {
    try {
      const body = JSON.parse(String(event.data || '{}')) as { action?: string; channel_ids?: string[]; channel_id?: string; active?: boolean; status?: string; payload?: Record<string, unknown> };
      if (body.action === 'ping') {
        record(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (body.action === 'subscribe') {
        env.__REALTIME_TEST__!.subscriptions[`socket_${env.__REALTIME_TEST__!.sockets}`] = (body.channel_ids || []).map(String);
        record(JSON.stringify({ type: 'subscribed', channel_ids: body.channel_ids || [] }));
        return;
      }
      if (body.action === 'unsubscribe') {
        env.__REALTIME_TEST__!.subscriptions[`socket_${env.__REALTIME_TEST__!.sockets}`] = [];
        record(JSON.stringify({ type: 'unsubscribed', channel_ids: body.channel_ids || [] }));
        return;
      }
      if (body.action === 'typing' && body.channel_id) {
        const existing = new Set(env.__REALTIME_TEST__!.typingUsers[body.channel_id] || []);
        if (body.active === false) existing.delete('self');
        else existing.add('self');
        env.__REALTIME_TEST__!.typingUsers[body.channel_id] = Array.from(existing);
        record(JSON.stringify({ event: 'typing.updated', channel_id: body.channel_id, data: { channel_id: body.channel_id, user_ids: env.__REALTIME_TEST__!.typingUsers[body.channel_id] } }));
        return;
      }
      if (body.action === 'join_voice' && body.channel_id) {
        const existing = new Set(env.__REALTIME_TEST__!.voiceParticipants[body.channel_id] || []);
        existing.add('self');
        env.__REALTIME_TEST__!.voiceParticipants[body.channel_id] = Array.from(existing);
        record(JSON.stringify({ event: 'voice.participants', channel_id: body.channel_id, data: { channel_id: body.channel_id, user_ids: env.__REALTIME_TEST__!.voiceParticipants[body.channel_id] } }));
        return;
      }
      if (body.action === 'leave_voice' && body.channel_id) {
        const existing = new Set(env.__REALTIME_TEST__!.voiceParticipants[body.channel_id] || []);
        existing.delete('self');
        env.__REALTIME_TEST__!.voiceParticipants[body.channel_id] = Array.from(existing);
        record(JSON.stringify({ event: 'voice.participants', channel_id: body.channel_id, data: { channel_id: body.channel_id, user_ids: env.__REALTIME_TEST__!.voiceParticipants[body.channel_id] } }));
        return;
      }
      if (body.action === 'voice.status') {
        record(JSON.stringify({ event: 'voice.status', channel_id: body.channel_id || null, data: { ...(body.payload || {}), channel_id: body.channel_id || null } }));
        return;
      }
      if (body.action === 'call.signal') {
        record(JSON.stringify({ event: 'call.signal', channel_id: body.channel_id || null, data: { ...(body.payload || {}), channel_id: body.channel_id || null } }));
        return;
      }
      if (body.action === 'presence' || body.action === 'presence.update') {
        record(JSON.stringify({ event: 'presence.updated', data: { ...(body.payload || {}), status: body.status || body.payload?.status || 'online' } }));
      }
    } catch {}
  });
  record(JSON.stringify({ type: 'connected', backend: 'shim' }));
  server.addEventListener('close', () => {
    record(JSON.stringify({ type: 'disconnected', backend: 'shim' }));
  });
  return new Response(null, { status: 101, webSocket: client });
}

export function buildApiRouter() {
  const api = new Hono<{ Bindings: Env }>();

  api.get('/health', (c) => successResponse({ status: 'ok', app_name: getConfig(c.env).appName, environment: getConfig(c.env).environment, runtime: 'cloudflare-workers' }));
  api.get('/runtime-config', async (c) => {
    const repo = await loadRepository(c.env);
    return successResponse({ app_name: getConfig(c.env).appName, backend_url: null, client_mode: 'stable', release_channel: 'stable', node_role: 'main', node_id: 'workers', indexing: false, edge_mode_enabled: false, sync_peer_api_url: null, edge_mode_available: false, bridge_schema_version: 1, sync_enabled: false, wyv_public_base_url: getConfig(c.env).wyvPublicBaseUrl, feature_flags: { community_tools: true, shell_refresh: true, directory_recommendations: true, admin_diagnostics_button: true, edge_release_banner: false }, giphy_api_key: null, giphy_rating: 'g', giphy_limit: 24, bridge_health: { configured: false, node_role: 'main', peer_url: null, sync_enabled: false, edge_mode_enabled: false, edge_mode_available: false, pending_outbox: 0, dead_letter_outbox: 0, last_outbox_delivery_at: null, last_inbound_at: null }, legal: legalMetadata(), metrics: { users: Object.keys(repo.state.users).length, servers: Object.keys(repo.state.servers).length, messages: Object.keys(repo.state.messages).length } });
  });


  api.get('/edge/ws', async (c) => {
    const token = c.req.query('token');
    if (!token) return errorResponse('UNAUTHORIZED', 'Missing token', 401);
    let auth;
    try {
      auth = await verifyAccessToken(c.env, token);
    } catch {
      return errorResponse('UNAUTHORIZED', 'Invalid token', 401);
    }
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }
    return handleWebSocketUpgrade(c, auth);
  });

  api.get('/ws', async (c) => {
    const token = c.req.query('token');
    if (!token) return errorResponse('UNAUTHORIZED', 'Missing token', 401);
    let auth;
    try {
      auth = await verifyAccessToken(c.env, token);
    } catch {
      return errorResponse('UNAUTHORIZED', 'Invalid token', 401);
    }
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }
    return handleWebSocketUpgrade(c, auth);
  });

  api.get('/ws/events', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const items = Object.values(repo.state.realtimeEvents)
      .filter((item) => !item.user_id || item.user_id === auth.user_id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    return successResponse({ items });
  });

  api.get('/ws/snapshot', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);

    if (!c.env.REALTIME_HUB) {
      const subscriptions = c.env.__REALTIME_TEST__?.subscriptions || {};
      const typedChannels = Object.keys(c.env.__REALTIME_TEST__?.typingUsers || {});
      const voiceChannels = Object.keys(c.env.__REALTIME_TEST__?.voiceParticipants || {});
      return successResponse({
        backend: 'shim',
        sessions: c.env.__REALTIME_TEST__?.sockets || 0,
        subscriptions,
        channels: Array.from(new Set([...Object.values(subscriptions).flat(), ...typedChannels, ...voiceChannels])),
        typing_users: c.env.__REALTIME_TEST__?.typingUsers || {},
        voice_participants: c.env.__REALTIME_TEST__?.voiceParticipants || {},
        buffered_messages: c.env.__REALTIME_TEST__?.messages || [],
      });
    }

    const stub = c.env.REALTIME_HUB.get(c.env.REALTIME_HUB.idFromName('global'));
    const response = await stub.fetch('https://realtime.internal/snapshot');
    if (!response.ok) return errorResponse('HTTP_ERROR', `Realtime snapshot failed with ${response.status}`, 502);
    const payload = await response.json() as { data?: Record<string, unknown> };
    return successResponse({ backend: 'durable_object', ...(payload.data || {}) });
  });

  api.post('/ws/emit', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const body = await c.req.json().catch(() => ({})) as { event?: string; channel_id?: string | null; payload?: Record<string, unknown> };
    const repo = await loadRepository(c.env);
    const eventName = String(body.event || 'custom.event');
    queueRealtimeEvent(repo, eventName, body.payload || {}, body.channel_id || null, auth.user_id);
    await repo.save();
    await emitRealtime(c.env, eventName, body.payload || {}, body.channel_id || null);
    return successResponse({ emitted: true });
  });

  api.get('/runtime/ui-variants', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const currentVote = repo.state.uiVariantVotes[auth.user_id]?.variant_key || null;
    return successResponse(buildUiVariantCatalog(repo, currentVote));
  });

  api.get('/runtime/diagnostics', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const realtimeMode = c.env.REALTIME_HUB ? 'durable_object' : 'shim';
    const persistenceMode = c.env.APP_STATE_ROOM ? 'durable_object_with_fallback' : 'memory';
    const mediaMode = c.env.MEDIA_BUCKET ? 'r2_with_fallback' : 'app_state';

    return successResponse({
      environment: c.env.ENVIRONMENT || 'development',
      persistence_mode: persistenceMode,
      realtime_mode: realtimeMode,
      media_mode: mediaMode,
      counts: {
        users: Object.keys(repo.state.users).length,
        servers: Object.keys(repo.state.servers).length,
        channels: Object.keys(repo.state.channels).length,
        messages: Object.keys(repo.state.messages).length,
        media_objects: Object.keys(repo.state.mediaObjects).length,
        realtime_events: Object.keys(repo.state.realtimeEvents).length,
      },
      bindings: {
        app_state_room: !!c.env.APP_STATE_ROOM,
        realtime_hub: !!c.env.REALTIME_HUB,
        media_bucket: !!c.env.MEDIA_BUCKET,
        presence_room: !!c.env.PRESENCE_ROOM,
      },
      realtime_test_state: c.env.__REALTIME_TEST__
        ? {
            sockets: c.env.__REALTIME_TEST__.sockets,
            subscriptions: Object.keys(c.env.__REALTIME_TEST__.subscriptions).length,
            buffered_events: c.env.__REALTIME_TEST__.events.length,
          }
        : null,
    });
  });

  api.get('/runtime/verify/state-room', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    if (!c.env.APP_STATE_ROOM) return errorResponse('HTTP_ERROR', 'APP_STATE_ROOM is not bound', 503);

    const stub = c.env.APP_STATE_ROOM.get(c.env.APP_STATE_ROOM.idFromName(c.env.ENVIRONMENT || 'default'));
    const response = await stub.fetch('https://app-state.internal/state');
    if (!response.ok) return errorResponse('HTTP_ERROR', `State room fetch failed with ${response.status}`, 502);
    const payload = await response.json() as { data?: { users?: Record<string, unknown>; servers?: Record<string, unknown>; channels?: Record<string, unknown> } };

    return successResponse({
      ok: true,
      backend: 'durable_object',
      counts: {
        users: Object.keys(payload.data?.users || {}).length,
        servers: Object.keys(payload.data?.servers || {}).length,
        channels: Object.keys(payload.data?.channels || {}).length,
      },
    });
  });

  api.get('/runtime/export-state', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const user = repo.state.users[auth.user_id];
    if (!user || !isAdmin(user, c.env)) return errorResponse('FORBIDDEN', 'Admin access required', 403);
    return successResponse({ state: repo.state, exported_at: nowIso(), environment: c.env.ENVIRONMENT || 'development' });
  });

  api.post('/runtime/import-state', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const user = repo.state.users[auth.user_id];
    if (!user || !isAdmin(user, c.env)) return errorResponse('FORBIDDEN', 'Admin access required', 403);
    const payload = await c.req.json() as { state?: Record<string, unknown> };
    if (!payload.state) return errorResponse('HTTP_ERROR', 'Missing state payload', 400);

    if (!c.env.APP_STATE_ROOM) return errorResponse('HTTP_ERROR', 'APP_STATE_ROOM is not bound', 503);
    const stub = c.env.APP_STATE_ROOM.get(c.env.APP_STATE_ROOM.idFromName(c.env.ENVIRONMENT || 'default'));
    const response = await stub.fetch('https://app-state.internal/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload.state),
    });
    if (!response.ok) return errorResponse('HTTP_ERROR', `State import failed with ${response.status}`, 502);
    return successResponse({ imported: true, imported_at: nowIso() });
  });

  api.post('/runtime/backup-state', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    if (!c.env.BACKUP_BUCKET) return errorResponse('HTTP_ERROR', 'BACKUP_BUCKET is not bound', 503);

    const repo = await loadRepository(c.env);
    const user = repo.state.users[auth.user_id];
    if (!user || !isAdmin(user, c.env)) return errorResponse('FORBIDDEN', 'Admin access required', 403);
    const timestamp = nowIso().replace(/[:.]/g, '-');
    const key = `state/${c.env.ENVIRONMENT || 'development'}/${timestamp}.json`;
    await c.env.BACKUP_BUCKET.put(key, JSON.stringify({ exported_at: nowIso(), environment: c.env.ENVIRONMENT || 'development', state: repo.state }), {
      httpMetadata: { contentType: 'application/json' },
    });
    return successResponse({ backed_up: true, key });
  });

  api.post('/runtime/restore-state', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    if (!c.env.BACKUP_BUCKET) return errorResponse('HTTP_ERROR', 'BACKUP_BUCKET is not bound', 503);
    if (!c.env.APP_STATE_ROOM) return errorResponse('HTTP_ERROR', 'APP_STATE_ROOM is not bound', 503);

    const repo = await loadRepository(c.env);
    const user = repo.state.users[auth.user_id];
    if (!user || !isAdmin(user, c.env)) return errorResponse('FORBIDDEN', 'Admin access required', 403);

    const payload = await c.req.json() as { key?: string };
    if (!payload.key) return errorResponse('HTTP_ERROR', 'Missing backup key', 400);

    const object = await c.env.BACKUP_BUCKET.get(payload.key);
    if (!object) return errorResponse('NOT_FOUND', 'Backup object not found', 404);
    const backup = await object.json() as { state?: Record<string, unknown> };
    if (!backup.state) return errorResponse('HTTP_ERROR', 'Backup object is missing state', 400);

    const stub = c.env.APP_STATE_ROOM.get(c.env.APP_STATE_ROOM.idFromName(c.env.ENVIRONMENT || 'default'));
    const response = await stub.fetch('https://app-state.internal/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(backup.state),
    });
    if (!response.ok) return errorResponse('HTTP_ERROR', `State restore failed with ${response.status}`, 502);
    return successResponse({ restored: true, key: payload.key, restored_at: nowIso() });
  });

  api.get('/runtime/verify/realtime-hub', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    if (!c.env.REALTIME_HUB) return errorResponse('HTTP_ERROR', 'REALTIME_HUB is not bound', 503);

    const stub = c.env.REALTIME_HUB.get(c.env.REALTIME_HUB.idFromName('global'));
    const response = await stub.fetch('https://realtime.internal/snapshot');
    if (!response.ok) return errorResponse('HTTP_ERROR', `Realtime hub fetch failed with ${response.status}`, 502);
    const payload = await response.json() as { data?: { sessions?: number; channels?: string[] } };

    return successResponse({
      ok: true,
      backend: 'durable_object',
      snapshot: {
        sessions: payload.data?.sessions || 0,
        channels: payload.data?.channels || [],
      },
    });
  });

  api.post('/runtime/verify/realtime-connect', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    if (!c.env.REALTIME_HUB) return errorResponse('HTTP_ERROR', 'REALTIME_HUB is not bound', 503);

    const stub = c.env.REALTIME_HUB.get(c.env.REALTIME_HUB.idFromName('global'));
    const response = await stub.fetch('https://realtime.internal/verify-connect', {
      method: 'POST',
      headers: {
        'x-wyvern-user': JSON.stringify(auth),
      },
    });
    if (!response.ok) return errorResponse('HTTP_ERROR', `Realtime connect verification failed with ${response.status}`, 502);
    const payload = await response.json() as { data?: Record<string, unknown> };
    return successResponse({ ok: true, ...(payload.data || {}) });
  });

  api.get('/runtime/verify/media-bucket/:uploadId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    if (!c.env.MEDIA_BUCKET) return errorResponse('HTTP_ERROR', 'MEDIA_BUCKET is not bound', 503);

    const repo = await loadRepository(c.env);
    const uploadId = String(c.req.param('uploadId') || '');
    const item = repo.state.mediaObjects[uploadId];
    if (!item) return errorResponse('NOT_FOUND', 'Media object not found', 404);

    const object = await c.env.MEDIA_BUCKET.get(item.path.replace(/^\//, ''));
    if (!object) return errorResponse('NOT_FOUND', 'Media object not found in R2', 404);

    return successResponse({
      ok: true,
      backend: 'r2',
      key: item.path.replace(/^\//, ''),
      size: object.size,
      http_metadata: {
        content_type: object.httpMetadata?.contentType || item.content_type,
      },
    });
  });

  api.put('/runtime/ui-variants/vote', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const body = uiVariantVoteSchema.parse(await c.req.json());
    const repo = await loadRepository(c.env);
    repo.state.uiVariantVotes[auth.user_id] = { user_id: auth.user_id, variant_key: body.variant_key, updated_at: nowIso() };
    await repo.save();
    return successResponse(buildUiVariantCatalog(repo, body.variant_key));
  });

  api.post('/auth/register', async (c) => {
    const repo = await loadRepository(c.env);
    const payload = registerSchema.parse(await c.req.json());
    const legal = legalVersions();
    if (!payload.accepted_legal || payload.terms_version !== legal.terms_version || payload.privacy_version !== legal.privacy_version) return errorResponse('HTTP_ERROR', 'Current legal terms must be accepted', 400);
    if (getUserByEmail(repo.state, payload.email)) return errorResponse('HTTP_ERROR', 'Email already in use', 400);
    const userId = repo.nextId('user');
    const sameNameCount = Object.values(repo.state.users).filter((item) => item.username.toLowerCase() === payload.username.toLowerCase()).length + 1;
    const createdAt = nowIso();
    const user: UserRecord = { id: userId, username: payload.username, discriminator: String(sameNameCount).padStart(4, '0'), display_name: payload.display_name || payload.username, bio: null, directory_opt_in: false, email: payload.email.toLowerCase(), avatar: null, is_paid: false, created_at: createdAt, password_hash: await hashPassword(payload.password), accepted_terms_version: legal.terms_version, accepted_privacy_version: legal.privacy_version, legal_accepted_at: createdAt, ai_opt_in: false, nsfw_18_verified: false };
    repo.state.users[user.id] = user;
    const refreshToken = randomToken('refresh');
    const refreshId = repo.nextId('refresh_token');
    repo.state.refreshTokens[refreshId] = { id: refreshId, user_id: user.id, token_hash: await hashToken(refreshToken), expires_at: futureIso(getConfig(c.env).refreshTokenExpireDays), created_at: createdAt, is_revoked: false };
    await repo.save();
    return successResponse({ user: serializeMe(user, c.env), tokens: { access_token: await issueAccessToken(c.env, toAuthUser(user), getConfig(c.env).accessTokenExpireMinutes), refresh_token: refreshToken } });
  });

  api.post('/auth/login', async (c) => {
    const repo = await loadRepository(c.env);
    const payload = loginSchema.parse(await c.req.json());
    const user = getUserByEmail(repo.state, payload.email.toLowerCase().trim());
    if (!user || !(await verifyPassword(payload.password, user.password_hash))) return errorResponse('HTTP_ERROR', 'Invalid credentials', 401);
    const refreshToken = randomToken('refresh');
    const refreshId = repo.nextId('refresh_token');
    repo.state.refreshTokens[refreshId] = { id: refreshId, user_id: user.id, token_hash: await hashToken(refreshToken), expires_at: futureIso(getConfig(c.env).refreshTokenExpireDays), created_at: nowIso(), is_revoked: false };
    await repo.save();
    return successResponse({ user: serializeMe(user, c.env), tokens: { access_token: await issueAccessToken(c.env, toAuthUser(user), getConfig(c.env).accessTokenExpireMinutes), refresh_token: refreshToken } });
  });

  api.post('/auth/refresh', async (c) => {
    const repo = await loadRepository(c.env);
    const payload = refreshSchema.parse(await c.req.json());
    const token = getRefreshTokenByHash(repo.state, await hashToken(payload.refresh_token));
    if (!token || token.is_revoked || isExpired(token.expires_at)) return errorResponse('HTTP_ERROR', 'Invalid refresh token', 401);
    const user = repo.state.users[token.user_id];
    if (!user) return errorResponse('HTTP_ERROR', 'Invalid refresh token', 401);
    return successResponse({ access_token: await issueAccessToken(c.env, toAuthUser(user), getConfig(c.env).accessTokenExpireMinutes), refresh_token: payload.refresh_token });
  });

  api.post('/auth/logout', async (c) => {
    const repo = await loadRepository(c.env);
    const payload = logoutSchema.parse(await c.req.json());
    const token = getRefreshTokenByHash(repo.state, await hashToken(payload.refresh_token));
    if (token) token.is_revoked = true;
    await repo.save();
    return successResponse({ revoked: true });
  });

  api.post('/auth/wyv-handoff', async (c) => {
    const user = await requireUser(c);
    if (!user) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    return successResponse({ grant: await issueWyvHandoffGrant(c.env, user, 60), expires_at: futureIso(1) });
  });

  api.post('/auth/edge-handoff', async (c) => {
    const user = await requireUser(c);
    if (!user) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    return successResponse({ grant: await issueWyvHandoffGrant(c.env, user, 60), expires_at: futureIso(1) });
  });

  api.post('/auth/edge-exchange', async (c) => {
    const payload = z.object({ grant: z.string().min(1) }).parse(await c.req.json());
    const repo = await loadRepository(c.env);
    let grantPayload: Record<string, unknown>;
    try {
      grantPayload = await decodeWyvHandoffGrant(c.env.WYV_SHARED_SECRET || c.env.JWT_SECRET_KEY || 'dev-only-wyvern-workers-secret-key-change-me', payload.grant);
    } catch {
      return errorResponse('UNAUTHORIZED', 'Invalid or expired edge handoff grant', 401);
    }
    const userId = String(grantPayload.user_id || grantPayload.sub || (grantPayload.user as { user_id?: unknown } | undefined)?.user_id || '');
    const user = repo.state.users[userId];
    if (!user) return errorResponse('NOT_FOUND', 'Edge handoff user not found', 404);
    const refreshToken = randomToken('refresh');
    const refreshId = repo.nextId('refresh_token');
    repo.state.refreshTokens[refreshId] = { id: refreshId, user_id: user.id, token_hash: await hashToken(refreshToken), expires_at: futureIso(getConfig(c.env).refreshTokenExpireDays), created_at: nowIso(), is_revoked: false };
    await repo.save();
    return successResponse({ user: serializeMe(user, c.env), tokens: { access_token: await issueAccessToken(c.env, toAuthUser(user), getConfig(c.env).accessTokenExpireMinutes), refresh_token: refreshToken }, grant: payload.grant });
  });

  api.get('/legal/current', async () => successResponse(legalMetadata()));

  api.post('/legal/accept', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const payload = z.object({ accepted_legal: z.boolean(), terms_version: z.string(), privacy_version: z.string() }).parse(await c.req.json());
    const legal = legalVersions();
    if (!payload.accepted_legal || payload.terms_version != legal.terms_version || payload.privacy_version != legal.privacy_version) {
      return errorResponse('HTTP_ERROR', 'Current legal terms must be accepted', 400);
    }
    const repo = await loadRepository(c.env);
    const user = repo.state.users[auth.user_id];
    if (!user) return errorResponse('NOT_FOUND', 'User not found', 404);
    user.accepted_terms_version = legal.terms_version;
    user.accepted_privacy_version = legal.privacy_version;
    user.legal_accepted_at = nowIso();
    await repo.save();
    return successResponse({ accepted_terms_version: user.accepted_terms_version, accepted_privacy_version: user.accepted_privacy_version, legal_accepted_at: user.legal_accepted_at, legal_reaccept_required: false, legal: legalMetadata(), message: 'Legal acceptance updated.' });
  });

  api.get('/users/me', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const user = repo.state.users[auth.user_id];
    if (!user) return errorResponse('NOT_FOUND', 'User not found', 404);
    return successResponse(serializeMe(user, c.env));
  });

  api.patch('/users/me', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const user = repo.state.users[auth.user_id];
    if (!user) return errorResponse('NOT_FOUND', 'User not found', 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.username === 'string') {
      const username = body.username.trim();
      if (username.length < 2 || username.length > 32) return errorResponse('HTTP_ERROR', 'Username must be between 2 and 32 characters', 400);
      const collision = Object.values(repo.state.users).some((item) => item.id !== user.id && item.username.toLowerCase() === username.toLowerCase() && item.discriminator === user.discriminator);
      if (collision) return errorResponse('HTTP_ERROR', 'Username and discriminator are already in use', 409);
      user.username = username;
    }
    if (typeof body.display_name === 'string') user.display_name = body.display_name;
    if (typeof body.bio === 'string' || body.bio === null) user.bio = body.bio as string | null;
    if (typeof body.avatar === 'string' || body.avatar === null) user.avatar = body.avatar as string | null;
    if (typeof body.directory_opt_in === 'boolean') user.directory_opt_in = body.directory_opt_in;
    if (typeof body.ai_opt_in === 'boolean') user.ai_opt_in = body.ai_opt_in;
    if (typeof body.nsfw_18_verified === 'boolean') user.nsfw_18_verified = body.nsfw_18_verified;
    queueRealtimeEvent(repo, 'user.updated', serializePublicUser(user) as unknown as Record<string, unknown>, null, auth.user_id);
    await repo.save();
    await emitRealtime(c.env, 'user.updated', serializePublicUser(user) as unknown as Record<string, unknown>, null);
    return successResponse(serializeMe(user, c.env));
  });

  api.get('/users/me/read-states', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    return successResponse(Object.values(repo.state.channelReadStates).filter((item) => item.user_id === auth.user_id));
  });

  api.get('/users/lookup', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const query = (c.req.query('q') || '').trim();
    if (query.length < 2) return errorResponse('HTTP_ERROR', 'Search query is too short', 400);
    const repo = await loadRepository(c.env);
    let user: UserRecord | undefined;
    if (query.includes('#')) {
      const [username, discriminator] = query.split(/#(?=[^#]+$)/);
      user = Object.values(repo.state.users).find((item) => item.username.toLowerCase() === username.trim().toLowerCase() && item.discriminator === discriminator.trim());
    } else {
      const normalized = query.toLowerCase();
      user = Object.values(repo.state.users).find((item) => item.username.toLowerCase() === normalized || item.display_name?.toLowerCase() === normalized);
    }
    if (!user) return errorResponse('NOT_FOUND', 'User not found', 404);
    return successResponse(serializePublicUser(user));
  });

  api.get('/users/directory', async (c) => {
    const repo = await loadRepository(c.env);
    return successResponse(Object.values(repo.state.users).filter((item) => item.directory_opt_in).map((user) => serializePublicUser(user)));
  });

  api.get('/users/:userId', async (c) => {
    const repo = await loadRepository(c.env);
    const user = repo.state.users[c.req.param('userId')];
    if (!user) return errorResponse('NOT_FOUND', 'User not found', 404);
    return successResponse(serializePublicUser(user));
  });

  api.put('/users/me/presence', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const body = presenceSchema.parse(await c.req.json());
    testPresence.set(auth.user_id, body.status);
    const repo = await loadRepository(c.env);
    queueRealtimeEvent(repo, 'presence.updated', { user_id: auth.user_id, status: body.status }, null, auth.user_id);
    await repo.save();
    await emitRealtime(c.env, 'presence.updated', { user_id: auth.user_id, status: body.status }, null);
    return successResponse({ user_id: auth.user_id, status: body.status });
  });

  api.get('/users/:userId/presence', async (c) => successResponse({ user_id: c.req.param('userId'), status: testPresence.get(c.req.param('userId')) || 'offline' }));

  api.get('/ai/api-tokens', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    return Response.json({ tokens: Object.values(repo.state.apiTokens).filter((item) => item.user_id === auth.user_id).map(serializeApiToken) });
  });

  api.post('/ai/api-tokens', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const body = apiTokenCreateSchema.parse(await c.req.json());
    const repo = await loadRepository(c.env);
    const rawToken = randomToken('wyvern_api');
    const id = repo.nextId('api_token');
    const token: ApiTokenRecord = { id, user_id: auth.user_id, name: body.name, token_hash: await hashToken(rawToken), plaintext_token: rawToken, created_at: nowIso(), last_used_at: null, revoked_at: null };
    repo.state.apiTokens[id] = token;
    await repo.save();
    return successResponse({ token: { ...serializeApiToken(token), token: rawToken } });
  });

  api.delete('/ai/api-tokens/:tokenId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const token = repo.state.apiTokens[c.req.param('tokenId')];
    if (!token || token.user_id !== auth.user_id) return errorResponse('NOT_FOUND', 'API token not found', 404);
    token.revoked_at = nowIso();
    await repo.save();
    return successResponse({ revoked: true });
  });

  api.post('/ai/api-tokens/:tokenId/rotate', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const token = repo.state.apiTokens[c.req.param('tokenId')];
    if (!token || token.user_id !== auth.user_id) return errorResponse('NOT_FOUND', 'API token not found', 404);
    const rawToken = randomToken('wyvern_api');
    token.plaintext_token = rawToken;
    token.token_hash = await hashToken(rawToken);
    token.last_used_at = nowIso();
    await repo.save();
    return successResponse({ token: { ...serializeApiToken(token), token: rawToken } });
  });

  api.post('/ai/api-tokens/revoke-all', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    for (const token of Object.values(repo.state.apiTokens)) if (token.user_id === auth.user_id) token.revoked_at = nowIso();
    await repo.save();
    return successResponse({ revoked: true });
  });

  api.post('/ai/api-tokens/rotate-all', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const rotated = [] as Array<{ id: string; token: string }>;
    for (const token of Object.values(repo.state.apiTokens)) {
      if (token.user_id === auth.user_id && !token.revoked_at) {
        const raw = randomToken('wyvern_api');
        token.plaintext_token = raw;
        token.token_hash = await hashToken(raw);
        token.last_used_at = nowIso();
        rotated.push({ id: token.id, token: raw });
      }
    }
    await repo.save();
    return successResponse({ rotated });
  });

  api.get('/ai/mcp-connection', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const base = new URL(c.req.url);
    return successResponse({
      connected: true,
      connection: {
        server_url: `${base.origin}/api/v1/mcp/sse`,
        app_name: 'Wyvern',
        recommended_client: 'ChatGPT Apps',
        auth_method: 'OAuth 2.1',
        published_ready: true,
        instructions: [
          'For testing in ChatGPT developer mode, create a custom connector and paste this URL.',
          'For a published ChatGPT app, submit this same MCP URL through OpenAI app submission.',
          'Users connect by signing into their Wyvern account. No API token pasting is required.',
        ],
      },
    });
  });

  api.post('/ai/mcp-connection', async (c) => {
    const base = new URL(c.req.url);
    return successResponse({
      connected: true,
      connection: {
        server_url: `${base.origin}/api/v1/mcp/sse`,
        app_name: 'Wyvern',
        recommended_client: 'ChatGPT Apps',
        auth_method: 'OAuth 2.1',
        published_ready: true,
        instructions: [
          'For testing in ChatGPT developer mode, create a custom connector and paste this URL.',
          'For a published ChatGPT app, submit this same MCP URL through OpenAI app submission.',
          'Users connect by signing into their Wyvern account. No API token pasting is required.',
        ],
      },
    });
  });

  api.delete('/ai/mcp-connection', async () =>
    successResponse({ connected: true, connection: null, revoked_count: 0, message: 'Connector revocation is managed externally in this Workers build.' })
  );

  api.get('/mcp/sse', async () =>
    new Response('event: ready\ndata: {"app":"Wyvern","transport":"sse"}\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
    })
  );

  api.post('/servers', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const payload = serverCreateSchema.parse(await c.req.json());
    const server: ServerRecord = { id: repo.nextId('server'), name: payload.name, description: payload.description ?? null, icon: payload.icon ?? null, directory_opt_in: payload.directory_opt_in, owner_id: auth.user_id, created_at: nowIso() };
    repo.state.servers[server.id] = server;
    repo.state.serverMembers[memberKey(server.id, auth.user_id)] = { server_id: server.id, user_id: auth.user_id, role: 'owner', joined_at: nowIso() };
    queueRealtimeEvent(repo, 'server.created', serializeServer(repo.state, server, auth.user_id) as unknown as Record<string, unknown>, null, auth.user_id);
    queueRealtimeEvent(repo, 'server.member.created', { server_id: server.id, user_id: auth.user_id, role: 'owner' }, null, auth.user_id);
    await repo.save();
    await emitRealtime(c.env, 'server.created', serializeServer(repo.state, server, auth.user_id) as unknown as Record<string, unknown>, null);
    await emitRealtime(c.env, 'server.member.created', { server_id: server.id, user_id: auth.user_id, role: 'owner' }, null);
    return successResponse(serializeServer(repo.state, server, auth.user_id));
  });

  api.get('/servers', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    return successResponse(listUserServers(repo.state, auth.user_id).map((server) => serializeServer(repo.state, server, auth.user_id)));
  });

  api.get('/servers/directory', async (c) => {
    const auth = await requireUser(c);
    const repo = await loadRepository(c.env);
    return successResponse({ items: Object.values(repo.state.servers).filter((item) => item.directory_opt_in).map((server) => ({ server: serializeServer(repo.state, server, auth?.user_id), member_count: listServerMembers(repo.state, server.id).length, joined: !!auth && !!repo.state.serverMembers[memberKey(server.id, auth.user_id)] })) });
  });

  api.get('/servers/:serverId', async (c) => {
    const repo = await loadRepository(c.env);
    const auth = await requireUser(c);
    const server = repo.state.servers[c.req.param('serverId')];
    if (!server) return errorResponse('NOT_FOUND', 'Server not found', 404);
    return successResponse(serializeServer(repo.state, server, auth?.user_id));
  });

  api.patch('/servers/:serverId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const server = repo.state.servers[c.req.param('serverId')];
    if (!server) return errorResponse('NOT_FOUND', 'Server not found', 404);
    if (!canManageServer(repo.state, server.id, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    const payload = serverUpdateSchema.parse(await c.req.json());
    if (payload.name !== undefined) server.name = payload.name;
    if (payload.description !== undefined) server.description = payload.description ?? null;
    if (payload.icon !== undefined) server.icon = payload.icon ?? null;
    if (payload.directory_opt_in !== undefined) server.directory_opt_in = payload.directory_opt_in;
    queueRealtimeEvent(repo, 'server.updated', serializeServer(repo.state, server, auth.user_id) as unknown as Record<string, unknown>, null, auth.user_id);
    await repo.save();
    await emitRealtime(c.env, 'server.updated', serializeServer(repo.state, server, auth.user_id) as unknown as Record<string, unknown>, null);
    return successResponse(serializeServer(repo.state, server, auth.user_id));
  });

  api.delete('/servers/:serverId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const serverId = c.req.param('serverId');
    const server = repo.state.servers[serverId];
    if (!server) return errorResponse('NOT_FOUND', 'Server not found', 404);
    if (server.owner_id !== auth.user_id) return errorResponse('FORBIDDEN', 'Only the owner can delete a server', 403);
    queueRealtimeEvent(repo, 'server.deleted', { id: serverId }, null, auth.user_id);
    await emitRealtime(c.env, 'server.deleted', { id: serverId }, null);
    delete repo.state.servers[serverId];
    for (const key of Object.keys(repo.state.serverMembers)) if (repo.state.serverMembers[key].server_id === serverId) delete repo.state.serverMembers[key];
    for (const key of Object.keys(repo.state.channels)) if (repo.state.channels[key].server_id === serverId) delete repo.state.channels[key];
    await repo.save();
    return successResponse({ deleted: true });
  });

  api.post('/servers/:serverId/join', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const serverId = c.req.param('serverId');
    const server = repo.state.servers[serverId];
    if (!server) return errorResponse('NOT_FOUND', 'Server not found', 404);
    repo.state.serverMembers[memberKey(serverId, auth.user_id)] = { server_id: serverId, user_id: auth.user_id, role: 'member', joined_at: nowIso() };
    queueRealtimeEvent(repo, 'server.member.created', { server_id: serverId, user_id: auth.user_id, role: 'member' }, null, auth.user_id);
    await repo.save();
    await emitRealtime(c.env, 'server.member.created', { server_id: serverId, user_id: auth.user_id, role: 'member' }, null);
    return successResponse({ joined: true, server: serializeServer(repo.state, server, auth.user_id) });
  });

  api.post('/servers/:serverId/invites', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const serverId = c.req.param('serverId');
    if (!canManageServer(repo.state, serverId, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    const code = randomToken('invite').replace('invite_', '').slice(0, 12);
    repo.state.serverInvites[code] = { code, server_id: serverId, created_by: auth.user_id, created_at: nowIso() };
    await repo.save();
    return successResponse({ code, server_id: serverId, created_by: auth.user_id, created_at: repo.state.serverInvites[code].created_at, invite_path: `/invite/${code}` });
  });

  api.get('/servers/invites/:code', async (c) => {
    const repo = await loadRepository(c.env);
    const invite = repo.state.serverInvites[c.req.param('code')];
    if (!invite) return errorResponse('NOT_FOUND', 'Invite not found', 404);
    const server = repo.state.servers[invite.server_id];
    if (!server) return errorResponse('NOT_FOUND', 'Server not found', 404);
    const auth = await requireUser(c);
    return successResponse({ code: invite.code, server: serializeServer(repo.state, server, auth?.user_id) });
  });

  api.post('/servers/invites/:code/join', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const invite = repo.state.serverInvites[c.req.param('code')];
    if (!invite) return errorResponse('NOT_FOUND', 'Invite not found', 404);
    const server = repo.state.servers[invite.server_id];
    if (!server) return errorResponse('NOT_FOUND', 'Server not found', 404);
    const membership = { server_id: server.id, user_id: auth.user_id, role: 'member' as const, joined_at: nowIso() };
    repo.state.serverMembers[memberKey(server.id, auth.user_id)] = membership;
    await repo.save();
    return successResponse({ server: serializeServer(repo.state, server, auth.user_id), membership });
  });

  api.post('/servers/:serverId/leave', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    delete repo.state.serverMembers[memberKey(c.req.param('serverId'), auth.user_id)];
    await repo.save();
    return successResponse({ left: true });
  });

  api.get('/servers/:serverId/members', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const serverId = c.req.param('serverId');
    if (!repo.state.serverMembers[memberKey(serverId, auth.user_id)]) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    return successResponse(
      listServerMembers(repo.state, serverId).map((item) => {
        const user = repo.state.users[item.user_id];
        return {
          ...item,
          user: user ? serializePublicUser(user) : null,
          display_name: user?.display_name || null,
          username: user?.username || null,
          discriminator: user?.discriminator || null,
          avatar: user?.avatar || null,
        };
      }),
    );
  });

  api.patch('/servers/:serverId/members/:userId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const serverId = c.req.param('serverId');
    if (!canManageServer(repo.state, serverId, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    const membership = repo.state.serverMembers[memberKey(serverId, c.req.param('userId'))];
    if (!membership) return errorResponse('NOT_FOUND', 'Membership not found', 404);
    membership.role = (c.req.query('role') || 'member') as MemberRole;
    await repo.save();
    const user = repo.state.users[membership.user_id];
    return successResponse({
      ...membership,
      user: user ? serializePublicUser(user) : null,
      display_name: user?.display_name || null,
      username: user?.username || null,
      discriminator: user?.discriminator || null,
      avatar: user?.avatar || null,
    });
  });

  api.get('/servers/:serverId/activity', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const serverId = c.req.param('serverId');
    if (!repo.state.serverMembers[memberKey(serverId, auth.user_id)]) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    return successResponse({ items: Object.values(repo.state.communityActivities).filter((item) => item.server_id === serverId) });
  });

  api.post('/channels/server/:serverId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const serverId = c.req.param('serverId');
    if (!repo.state.serverMembers[memberKey(serverId, auth.user_id)]) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    const payload = channelCreateSchema.parse(await c.req.json());
    const channel: ChannelRecord = { id: repo.nextId('channel'), server_id: serverId, name: payload.name, type: payload.type, position: payload.position, category: payload.category ?? null, created_by: auth.user_id, created_at: nowIso() };
    repo.state.channels[channel.id] = channel;
    queueRealtimeEvent(repo, 'channel.created', channel as unknown as Record<string, unknown>, channel.id, auth.user_id);
    await repo.save();
    await emitRealtime(c.env, 'channel.created', channel as unknown as Record<string, unknown>, channel.id);
    return successResponse(channel);
  });

  api.get('/channels/server/:serverId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const serverId = c.req.param('serverId');
    if (!repo.state.serverMembers[memberKey(serverId, auth.user_id)]) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    return successResponse(listServerChannels(repo.state, serverId));
  });
  api.get('/channels/:channelId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const channel = repo.state.channels[c.req.param('channelId')];
    if (!channel) return errorResponse('NOT_FOUND', 'Channel not found', 404);
    if (!canAccessChannel(repo.state, channel.id, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    return successResponse(channel);
  });

  api.put('/channels/:channelId/read-state', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const channelId = c.req.param('channelId');
    if (!canAccessChannel(repo.state, channelId, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    const payload = readStateSchema.parse(await c.req.json());
    const now = nowIso();
    const key = readStateKey(channelId, auth.user_id);
    repo.state.channelReadStates[key] = { channel_id: channelId, user_id: auth.user_id, last_read_message_id: payload.last_read_message_id ?? null, last_read_at: now, updated_at: now };
    await repo.save();
    return successResponse(repo.state.channelReadStates[key]);
  });

  api.patch('/channels/:channelId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const channel = repo.state.channels[c.req.param('channelId')];
    if (!channel) return errorResponse('NOT_FOUND', 'Channel not found', 404);
    if (channel.server_id && !canManageServer(repo.state, channel.server_id, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    const payload = channelUpdateSchema.parse(await c.req.json());
    if (payload.name !== undefined) channel.name = payload.name;
    if (payload.position !== undefined) channel.position = payload.position;
    if (payload.category !== undefined) channel.category = payload.category ?? null;
    queueRealtimeEvent(repo, 'channel.updated', channel as unknown as Record<string, unknown>, channel.id, auth.user_id);
    await repo.save();
    await emitRealtime(c.env, 'channel.updated', channel as unknown as Record<string, unknown>, channel.id);
    return successResponse(channel);
  });

  api.delete('/channels/:channelId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const channel = repo.state.channels[c.req.param('channelId')];
    if (!channel) return errorResponse('NOT_FOUND', 'Channel not found', 404);
    if (channel.server_id && !canManageServer(repo.state, channel.server_id, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    queueRealtimeEvent(repo, 'channel.deleted', { id: channel.id, server_id: channel.server_id }, channel.id, auth.user_id);
    delete repo.state.channels[channel.id];
    await repo.save();
    await emitRealtime(c.env, 'channel.deleted', { id: channel.id, server_id: channel.server_id }, channel.id);
    return successResponse({ deleted: true });
  });

  api.post('/dms', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const payload = dmCreateSchema.parse(await c.req.json());
    if (!repo.state.users[payload.recipient_id]) return errorResponse('NOT_FOUND', 'Recipient not found', 404);
    const existing = Object.values(repo.state.channels).find((channel) => channel.type === 'dm' && listDmParticipants(repo.state, channel.id).map((item) => item.user_id).sort().join(',') === [auth.user_id, payload.recipient_id].sort().join(','));
    const channel = existing || { id: repo.nextId('channel'), server_id: null, name: 'Direct Message', type: 'dm' as const, position: 0, category: null, created_by: auth.user_id, created_at: nowIso() };
    repo.state.channels[channel.id] = channel;
    repo.state.dmParticipants[dmParticipantKey(channel.id, auth.user_id)] = { channel_id: channel.id, user_id: auth.user_id, joined_at: nowIso() };
    repo.state.dmParticipants[dmParticipantKey(channel.id, payload.recipient_id)] = { channel_id: channel.id, user_id: payload.recipient_id, joined_at: nowIso() };
    delete repo.state.dmHiddenStates[dmHiddenKey(channel.id, auth.user_id)];
    queueRealtimeEvent(repo, 'dm.created', serializeDmChannel(repo.state, channel, auth.user_id) as unknown as Record<string, unknown>, channel.id, auth.user_id);
    await repo.save();
    await emitRealtime(c.env, 'dm.created', serializeDmChannel(repo.state, channel, auth.user_id) as unknown as Record<string, unknown>, channel.id);
    return successResponse(serializeDmChannel(repo.state, channel, auth.user_id));
  });

  api.get('/dms', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    return successResponse(listUserDms(repo.state, auth.user_id).map((channel) => serializeDmChannel(repo.state, channel, auth.user_id)));
  });

  api.get('/dms/:channelId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const channel = repo.state.channels[c.req.param('channelId')];
    if (!channel || channel.type !== 'dm') return errorResponse('NOT_FOUND', 'DM not found', 404);
    if (!repo.state.dmParticipants[dmParticipantKey(channel.id, auth.user_id)]) return errorResponse('FORBIDDEN', 'No DM access', 403);
    if (repo.state.dmHiddenStates[dmHiddenKey(channel.id, auth.user_id)]) return errorResponse('NOT_FOUND', 'DM not found', 404);
    return successResponse(serializeDmChannel(repo.state, channel, auth.user_id));
  });

  api.delete('/dms/:channelId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const channelId = c.req.param('channelId');
    const channel = repo.state.channels[channelId];
    if (!channel || channel.type !== 'dm') return errorResponse('NOT_FOUND', 'DM not found', 404);
    if (!repo.state.dmParticipants[dmParticipantKey(channelId, auth.user_id)]) return errorResponse('FORBIDDEN', 'No DM access', 403);
    repo.state.dmHiddenStates[dmHiddenKey(channelId, auth.user_id)] = { channel_id: channelId, user_id: auth.user_id, hidden_at: nowIso() };
    queueRealtimeEvent(repo, 'dm.deleted', { id: channelId }, channelId, auth.user_id);
    await emitRealtime(c.env, 'dm.deleted', { id: channelId }, channelId);
    await repo.save();
    return successResponse({ deleted: true });
  });

  api.get('/messages/channels/:channelId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const channelId = c.req.param('channelId');
    if (!canAccessChannel(repo.state, channelId, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
    const cursor = c.req.query('cursor');

    let allMessages = listChannelMessages(repo.state, channelId);
    
    // Sort descending to handle cursor correctly
    allMessages.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));

    if (cursor) {
      const [cursorTime, cursorId] = cursor.split('|');
      allMessages = allMessages.filter((m) => m.created_at < cursorTime || (m.created_at === cursorTime && m.id < cursorId));
    }

    const hasMore = allMessages.length > limit;
    const paginatedMessages = allMessages.slice(0, limit);

    const items = paginatedMessages.map((message) => serializeMessage(repo.state, message, auth.user_id)).reverse();
    const nextCursor = hasMore ? `${paginatedMessages[limit - 1].created_at}|${paginatedMessages[limit - 1].id}` : null;

    return successResponse({ items, next_cursor: nextCursor });
  });

  api.post('/messages/channels/:channelId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const channel = repo.state.channels[c.req.param('channelId')];
    if (!channel) return errorResponse('NOT_FOUND', 'Channel not found', 404);
    if (!canAccessChannel(repo.state, channel.id, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    const payload = messageCreateSchema.parse(await c.req.json());
    const message: MessageRecord = { id: repo.nextId('message'), channel_id: channel.id, author_id: auth.user_id, reply_to_id: payload.reply_to_id ?? null, content: payload.content, attachments: payload.attachments, created_at: nowIso(), edited_at: null, is_pinned: false, is_nsfw: payload.is_nsfw, webhook_name: null, webhook_avatar: null };
    repo.state.messages[message.id] = message;
    const serialized = serializeMessage(repo.state, message, auth.user_id);
    queueRealtimeEvent(repo, 'message.created', serialized as unknown as Record<string, unknown>, message.channel_id, auth.user_id);
    await repo.save();
    await emitRealtime(c.env, 'message.created', serialized as unknown as Record<string, unknown>, message.channel_id);
    return successResponse(serialized);
  });

  api.get('/messages/search', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const q = (c.req.query('q') || '').toLowerCase();
    const authorId = c.req.query('author_id');
    const channelId = c.req.query('channel_id');
    const serverId = c.req.query('server_id');
    const before = c.req.query('before');
    const after = c.req.query('after');

    const items = Object.values(repo.state.messages)
      .filter((message) => {
        if (!canAccessChannel(repo.state, message.channel_id, auth.user_id)) return false;
        if (q && !message.content.toLowerCase().includes(q)) return false;
        if (authorId && message.author_id !== authorId) return false;
        if (channelId && message.channel_id !== channelId) return false;
        if (serverId) {
          const channel = repo.state.channels[message.channel_id];
          if (!channel || channel.server_id !== serverId) return false;
        }
        if (before && message.created_at >= before) return false;
        if (after && message.created_at <= after) return false;
        return true;
      })
      .map((message) => {
        const channel = repo.state.channels[message.channel_id];
        const server = channel?.server_id ? repo.state.servers[channel.server_id] : null;
        return {
          message: serializeMessage(repo.state, message),
          channel_id: message.channel_id,
          channel_name: channel?.name || 'Unknown channel',
          channel_type: channel?.type || 'text',
          server_id: server?.id || null,
          server_name: server?.name || null,
        };
      });

    return successResponse({ items });
  });

  api.patch('/messages/:messageId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const message = repo.state.messages[c.req.param('messageId')];
    if (!message) return errorResponse('NOT_FOUND', 'Message not found', 404);
    if (message.author_id !== auth.user_id) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    const payload = messageUpdateSchema.parse(await c.req.json());
    message.content = payload.content;
    message.edited_at = nowIso();
    const serialized = serializeMessage(repo.state, message);
    queueRealtimeEvent(repo, 'message.updated', serialized as unknown as Record<string, unknown>, message.channel_id, auth.user_id);
    await repo.save();
    await emitRealtime(c.env, 'message.updated', serialized as unknown as Record<string, unknown>, message.channel_id);
    return successResponse(serialized);
  });

  api.delete('/messages/:messageId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const message = repo.state.messages[c.req.param('messageId')];
    if (!message) return errorResponse('NOT_FOUND', 'Message not found', 404);
    if (message.author_id !== auth.user_id) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    delete repo.state.messages[message.id];
    queueRealtimeEvent(repo, 'message.deleted', { id: message.id, channel_id: message.channel_id }, message.channel_id, auth.user_id);
    await repo.save();
    await emitRealtime(c.env, 'message.deleted', { id: message.id, channel_id: message.channel_id }, message.channel_id);
    return successResponse({ deleted: true });
  });

  api.get('/messages/pins/channels/:channelId', async (c) => { const auth = await requireUser(c); if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401); const repo = await loadRepository(c.env); const channelId = c.req.param('channelId'); if (!canAccessChannel(repo.state, channelId, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403); return successResponse(listChannelMessages(repo.state, channelId).filter((item) => item.is_pinned).map((message) => serializeMessage(repo.state, message, auth.user_id))); });
  api.put('/messages/:messageId/pin', async (c) => { const auth = await requireUser(c); if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401); const repo = await loadRepository(c.env); const message = repo.state.messages[c.req.param('messageId')]; if (!message) return errorResponse('NOT_FOUND', 'Message not found', 404); if (!canPinMessage(repo.state, message, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403); message.is_pinned = true; await repo.save(); return successResponse(serializeMessage(repo.state, message, auth.user_id)); });
  api.delete('/messages/:messageId/pin', async (c) => { const auth = await requireUser(c); if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401); const repo = await loadRepository(c.env); const message = repo.state.messages[c.req.param('messageId')]; if (!message) return errorResponse('NOT_FOUND', 'Message not found', 404); if (!canPinMessage(repo.state, message, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403); message.is_pinned = false; await repo.save(); return successResponse(serializeMessage(repo.state, message, auth.user_id)); });
  api.get('/messages/bookmarks', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const items = Object.values(repo.state.messageBookmarks)
      .filter((item) => item.user_id === auth.user_id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((bookmark) => {
        const message = repo.state.messages[bookmark.message_id];
        return message ? {
          saved_at: bookmark.created_at,
          message: serializeMessage(repo.state, message, auth.user_id),
        } : null;
      })
      .filter((item): item is { saved_at: string; message: ReturnType<typeof serializeMessage> } => !!item);
    return successResponse({ items });
  });
  api.put('/messages/:messageId/bookmark', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const message = repo.state.messages[c.req.param('messageId')];
    if (!message) return errorResponse('NOT_FOUND', 'Message not found', 404);
    let existing = Object.values(repo.state.messageBookmarks).find((item) => item.user_id === auth.user_id && item.message_id === message.id);
    if (!existing) {
      existing = { id: repo.nextId('message_bookmark'), user_id: auth.user_id, message_id: message.id, created_at: nowIso() };
      repo.state.messageBookmarks[existing.id] = existing;
      if (repo.state.channels[message.channel_id]?.server_id) {
        const activityId = repo.nextId('activity');
        repo.state.communityActivities[activityId] = { id: activityId, server_id: repo.state.channels[message.channel_id].server_id, actor_user_id: auth.user_id, action: 'message.bookmarked', target_type: 'message', target_id: message.id, activity_metadata: null, created_at: nowIso() };
      }
      await repo.save();
    }
    return successResponse({ bookmarked: true, message: serializeMessage(repo.state, message, auth.user_id) });
  });
  api.delete('/messages/:messageId/bookmark', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const message = repo.state.messages[c.req.param('messageId')];
    if (!message) return errorResponse('NOT_FOUND', 'Message not found', 404);
    for (const [key, bookmark] of Object.entries(repo.state.messageBookmarks)) {
      if (bookmark.user_id === auth.user_id && bookmark.message_id === message.id) delete repo.state.messageBookmarks[key];
    }
    await repo.save();
    return successResponse({ bookmarked: false, message: serializeMessage(repo.state, message, auth.user_id) });
  });
  api.put('/messages/:messageId/reactions', async (c) => { const auth = await requireUser(c); if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401); const repo = await loadRepository(c.env); const message = repo.state.messages[c.req.param('messageId')]; if (!message) return errorResponse('NOT_FOUND', 'Message not found', 404); const payload = reactionSchema.parse(await c.req.json()); repo.state.reactions[reactionKey(message.id, payload.emoji, auth.user_id)] = { message_id: message.id, emoji: payload.emoji, user_id: auth.user_id }; queueRealtimeEvent(repo, 'reaction.added', { message_id: message.id, emoji: payload.emoji, user_id: auth.user_id, channel_id: message.channel_id }, message.channel_id, auth.user_id); await repo.save(); await emitRealtime(c.env, 'reaction.added', { message_id: message.id, emoji: payload.emoji, user_id: auth.user_id, channel_id: message.channel_id }, message.channel_id); return successResponse(serializeMessage(repo.state, message)); });
  api.delete('/messages/:messageId/reactions', async (c) => { const auth = await requireUser(c); if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401); const repo = await loadRepository(c.env); const emoji = c.req.query('emoji') || ''; delete repo.state.reactions[reactionKey(c.req.param('messageId'), emoji, auth.user_id)]; const message = repo.state.messages[c.req.param('messageId')]; if (message) queueRealtimeEvent(repo, 'reaction.removed', { message_id: message.id, emoji, user_id: auth.user_id, channel_id: message.channel_id }, message.channel_id, auth.user_id); await repo.save(); if (message) await emitRealtime(c.env, 'reaction.removed', { message_id: message.id, emoji, user_id: auth.user_id, channel_id: message.channel_id }, message.channel_id); return successResponse(message ? serializeMessage(repo.state, message) : { removed: true }); });

  api.post('/uploads', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file') as File | string | null | undefined;
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') return errorResponse('HTTP_ERROR', 'Missing upload file', 400);
    if (!isAllowedUpload(file.type, file.name)) return errorResponse('HTTP_ERROR', 'Unsupported file type', 400);

    const bodyBytes = new Uint8Array(await file.arrayBuffer());
    const sizeLimit = 1_073_741_824;
    if (bodyBytes.byteLength > sizeLimit) return errorResponse('HTTP_ERROR', `Free-tier uploads are limited to ${sizeLimit} bytes`, 413);

    const safeName = sanitizeUploadFilename(file.name);
    const uploadId = `${crypto.randomUUID()}-${safeName}`;
    const bodyBase64 = encodeMediaBytes(bodyBytes);
    const media: MediaObjectRecord = {
      id: uploadId,
      owner_user_id: auth.user_id,
      path: `/media/${auth.user_id}/${uploadId}`,
      filename: file.name || safeName,
      content_type: file.type || 'application/octet-stream',
      size: bodyBytes.byteLength,
      body_base64: bodyBase64,
      uploaded_at: nowIso(),
    };
    repo.state.mediaObjects[uploadId] = media;
    await saveMediaObject(c.env, media);
    await repo.save();
    return successResponse({ id: media.id, url: media.path, filename: media.filename, content_type: media.content_type, size: media.size });
  });

  api.get('/servers/:serverId/webhooks', async (c) => {
    const repo = await loadRepository(c.env);
    const serverId = c.req.param('serverId');
    return successResponse({ items: Object.values(repo.state.webhooks).filter((item) => item.server_id === serverId).map((item) => serializeWebhook(item)) });
  });

  api.post('/servers/:serverId/webhooks', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const serverId = c.req.param('serverId');
    if (!canManageServer(repo.state, serverId, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    const payload = webhookCreateSchema.parse(await c.req.json());
    const token = randomToken('wh');
    const webhook: WebhookRecord = { id: repo.nextId('webhook'), server_id: serverId, channel_id: payload.channel_id, name: payload.name, description: payload.description ?? null, active: true, created_by: auth.user_id, created_at: nowIso(), updated_at: nowIso(), last_used_at: null, token_plaintext: token, token_hash: await hashToken(token) };
    repo.state.webhooks[webhook.id] = webhook;
    await repo.save();
    return successResponse({ webhook: serializeWebhook(webhook), token, webhook_url: `/api/v1/webhooks/${webhook.id}/${token}` });
  });

  api.delete('/webhooks/:webhookId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const webhook = repo.state.webhooks[c.req.param('webhookId')];
    if (!webhook) return errorResponse('NOT_FOUND', 'Webhook not found', 404);
    if (!canManageServer(repo.state, webhook.server_id, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    delete repo.state.webhooks[webhook.id];
    await repo.save();
    return successResponse({ deleted: true });
  });

  api.post('/webhooks/:webhookId/rotate', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const webhook = repo.state.webhooks[c.req.param('webhookId')];
    if (!webhook) return errorResponse('NOT_FOUND', 'Webhook not found', 404);
    if (!canManageServer(repo.state, webhook.server_id, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    const token = randomToken('wh');
    webhook.token_plaintext = token;
    webhook.token_hash = await hashToken(token);
    webhook.updated_at = nowIso();
    await repo.save();
    return successResponse({ webhook: serializeWebhook(webhook), token, webhook_url: `/api/v1/webhooks/${webhook.id}/${token}` });
  });

  api.post('/webhooks/:webhookId/:token', async (c) => {
    const repo = await loadRepository(c.env);
    const webhook = repo.state.webhooks[c.req.param('webhookId')];
    if (!webhook || !webhook.active || webhook.token_plaintext !== c.req.param('token')) return errorResponse('UNAUTHORIZED', 'Invalid webhook token', 401);
    const payload = webhookMessageSchema.parse(await c.req.json());
    const message: MessageRecord = { id: repo.nextId('message'), channel_id: webhook.channel_id, author_id: webhook.created_by || 'webhook', reply_to_id: payload.reply_to_id ?? null, content: payload.content, attachments: payload.attachments, created_at: nowIso(), edited_at: null, is_pinned: false, is_nsfw: false, webhook_name: payload.username || webhook.name, webhook_avatar: payload.avatar_url ?? null };
    repo.state.messages[message.id] = message;
    webhook.last_used_at = nowIso();
    const deliveryId = repo.nextId('delivery');
    repo.state.webhookDeliveries[deliveryId] = { id: deliveryId, webhook_id: webhook.id, request_id: randomToken('req'), status: 'delivered', attempts: 1, response_message: null, created_at: nowIso() };
    await repo.save();
    return successResponse(serializeMessage(repo.state, message));
  });

  api.get('/servers/:serverId/webhooks/:webhookId/deliveries', async (c) => {
    const repo = await loadRepository(c.env);
    return successResponse({ items: Object.values(repo.state.webhookDeliveries).filter((item) => item.webhook_id === c.req.param('webhookId')) });
  });

  api.get('/channels/:channelId/workspace', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const channel = repo.state.channels[c.req.param('channelId')];
    if (!channel) return errorResponse('NOT_FOUND', 'Channel not found', 404);
    if (channel.type === 'voice') return errorResponse('HTTP_ERROR', 'Voice channels do not have workspaces', 400);
    const visibility = (c.req.query('visibility') || 'public').trim();
    
    const existing = Object.values(repo.state.workspaceDocuments).find((item) => {
      if (item.channel_id !== channel.id) return false;
      if (item.visibility !== visibility) return false;
      if (visibility === 'private' && item.owner_user_id !== auth.user_id) return false;
      if (visibility === 'public' && item.owner_user_id !== null) return false;
      return true;
    });

    if (!existing) return successResponse(buildWorkspacePlaceholder(channel, auth.user_id, visibility));
    return successResponse(serializeWorkspace(repo, existing));
  });

  api.patch('/channels/:channelId/workspace', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const channel = repo.state.channels[c.req.param('channelId')];
    if (!channel) return errorResponse('NOT_FOUND', 'Channel not found', 404);
    if (channel.type === 'voice') return errorResponse('HTTP_ERROR', 'Voice channels do not have workspaces', 400);
    const payload = workspaceUpdateSchema.parse(await c.req.json());
    const visibility = (payload.visibility || 'public').trim();
    
    let document = Object.values(repo.state.workspaceDocuments).find((item) => {
      if (item.channel_id !== channel.id) return false;
      if (item.visibility !== visibility) return false;
      if (visibility === 'private' && item.owner_user_id !== auth.user_id) return false;
      if (visibility === 'public' && item.owner_user_id !== null) return false;
      return true;
    });

    const now = nowIso();
    if (!document) {
      document = { 
        id: repo.nextId('workspace'), 
        channel_id: channel.id, 
        title: payload.title || defaultWorkspaceTitle(channel), 
        mode: payload.mode || 'markdown', 
        language: payload.language || 'plaintext', 
        visibility, 
        content: payload.content, 
        owner_user_id: visibility === 'private' ? auth.user_id : null, 
        updated_by_user_id: auth.user_id, 
        created_at: now, 
        updated_at: now 
      };
      repo.state.workspaceDocuments[document.id] = document;
    } else {
      document.title = payload.title || document.title;
      document.mode = payload.mode || document.mode;
      document.language = payload.language || document.language;
      document.visibility = visibility;
      document.content = payload.content;
      document.updated_by_user_id = auth.user_id;
      document.updated_at = now;
    }
    const revision: WorkspaceRevisionRecord = { id: repo.nextId('workspace_revision'), document_id: document.id, editor_user_id: auth.user_id, content: document.content, created_at: now };
    repo.state.workspaceRevisions[revision.id] = revision;
    if (payload.log_activity && channel.server_id) {
      const activity: CommunityActivityRecord = { id: repo.nextId('activity'), server_id: channel.server_id, actor_user_id: auth.user_id, action: 'workspace.updated', target_type: 'workspace', target_id: document.id, activity_metadata: { channel_id: channel.id }, created_at: now };
      repo.state.communityActivities[activity.id] = activity;
    }
    const workspacePayload = serializeWorkspace(repo, document);
    queueRealtimeEvent(repo, 'workspace.updated', workspacePayload as unknown as Record<string, unknown>, channel.id, auth.user_id);
    await repo.save();
    return successResponse(workspacePayload);
  });

  api.get('/admin/overview', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const user = repo.state.users[auth.user_id];
    if (!user || !isAdmin(user, c.env)) return errorResponse('FORBIDDEN', 'Admin access required', 403);

    const users = Object.values(repo.state.users).map(serializeAdminUser);
    const servers = Object.values(repo.state.servers).map((server) => ({
      ...server,
      member_count: listServerMembers(repo.state, server.id).length
    }));

    const activities: any[] = [];

    // Message activity
    Object.values(repo.state.messages).forEach((msg) => {
      const channel = repo.state.channels[msg.channel_id];
      const author = repo.state.users[msg.author_id];
      const server = channel?.server_id ? repo.state.servers[channel.server_id] : null;
      
      let subtitle = channel?.type === 'dm' ? 'Direct Message' : `#${channel?.name || 'channel'}`;
      if (server) subtitle += ` in ${server.name}`;

      activities.push({
        type: 'message.created',
        timestamp: msg.created_at,
        title: `${author?.display_name || author?.username || 'Unknown'} sent a message`,
        subtitle,
        preview: msg.content.slice(0, 120),
        meta: { message_id: msg.id, channel_id: msg.channel_id, author_id: msg.author_id, server_id: server?.id }
      });
    });

    // Server member activity
    Object.values(repo.state.serverMembers).forEach((m) => {
      const server = repo.state.servers[m.server_id];
      const u = repo.state.users[m.user_id];
      activities.push({
        type: 'server.member.joined',
        timestamp: m.joined_at,
        title: `${u?.display_name || u?.username || 'Unknown'} joined a server`,
        subtitle: server?.name || 'Unknown server',
        preview: `Role: ${m.role}`,
        meta: { server_id: m.server_id, user_id: m.user_id, role: m.role }
      });
    });

    // User creation
    Object.values(repo.state.users).forEach((u) => {
      activities.push({
        type: 'user.created',
        timestamp: u.created_at,
        title: `New user registered: ${u.display_name || u.username}`,
        subtitle: `${u.username}#${u.discriminator}`,
        preview: 'Account created',
        meta: { user_id: u.id }
      });
    });

    // Server creation
    Object.values(repo.state.servers).forEach((s) => {
      const owner = repo.state.users[s.owner_id];
      activities.push({
        type: 'server.created',
        timestamp: s.created_at,
        title: `Server created: ${s.name}`,
        subtitle: `Owner: ${owner?.display_name || owner?.username || 'Unknown'}`,
        preview: s.description || '',
        meta: { server_id: s.id, owner_id: s.owner_id }
      });
    });

    activities.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const activitySlice = activities.slice(0, 400);

    return successResponse({
      users,
      servers,
      activity: activitySlice,
      metrics: {
        user_count: users.length,
        server_count: servers.length,
        message_count: Object.keys(repo.state.messages).length
      }
    });
  });

  api.get('/admin/releases', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const user = repo.state.users[auth.user_id];
    if (!user || !isAdmin(user, c.env)) return errorResponse('FORBIDDEN', 'Admin access required', 403);
    return successResponse({
      items: [
        {
          release_channel: 'stable',
          flags: [
            {
              key: 'community_tools',
              description: 'Enable search, pins, bookmarks, webhooks, and collaborative workspaces.',
              stable_enabled: true,
              edge_enabled: true,
              channel_locked: false,
              updated_by_user_id: null,
              updated_at: null,
              last_promoted_at: null,
            },
          ],
          pending_promotions: 0,
          bridge_health: {
            configured: false,
            node_role: 'main',
            peer_url: null,
            sync_enabled: false,
            edge_mode_enabled: false,
            edge_mode_available: false,
            pending_outbox: 0,
            dead_letter_outbox: 0,
            last_outbox_delivery_at: null,
            last_inbound_at: null,
          },
        },
      ],
    });
  });

  api.get('/admin/releases/audit', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const user = repo.state.users[auth.user_id];
    if (!user || !isAdmin(user, c.env)) return errorResponse('FORBIDDEN', 'Admin access required', 403);
    return successResponse({ items: [], message: 'No release audit entries recorded in this Workers build yet.' });
  });

  api.post('/admin/releases/promote', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const user = repo.state.users[auth.user_id];
    if (!user || !isAdmin(user, c.env)) return errorResponse('FORBIDDEN', 'Admin access required', 403);
    return successResponse({
      promoted: true,
      release_channel: 'stable',
      promoted_by_user_id: auth.user_id,
      promoted_at: nowIso(),
    });
  });

  api.post('/internal/wyv/session-exchange', async (c) => {
    const secret = getConfig(c.env).wyvSharedSecret;
    if (!secret) return errorResponse('HTTP_ERROR', 'Wyv bridge is not configured', 503);

    const body = await c.req.arrayBuffer();
    try {
      await verifyBridgeSignature(
        secret,
        body,
        c.req.header('X-Wyv-Bridge-Timestamp') || null,
        c.req.header('X-Wyv-Bridge-Signature') || null
      );
    } catch (err) {
      return errorResponse('UNAUTHORIZED', (err as Error).message, 401);
    }

    const payload = wyvGrantSchema.parse(JSON.parse(new TextDecoder().decode(body)));
    let grantPayload;
    try {
      grantPayload = await decodeWyvHandoffGrant(secret, payload.grant);
    } catch (err) {
      return errorResponse('UNAUTHORIZED', (err as Error).message, 401);
    }

    const userId = String(grantPayload.sub || '').trim();
    if (!userId) return errorResponse('HTTP_ERROR', 'Wyv handoff grant is missing a user id', 400);

    const repo = await loadRepository(c.env);
    const user = repo.state.users[userId];

    if (!user) {
      if (grantPayload.user) return successResponse({ user: grantPayload.user });
      return errorResponse('NOT_FOUND', 'Wyvern user not found', 404);
    }

    return successResponse({ user: serializeWyvUser(user) });
  });

  api.post('/internal/wyv/api-token-introspect', async (c) => {
    const secret = getConfig(c.env).wyvSharedSecret;
    const body = await c.req.arrayBuffer();
    if (secret) {
      try {
        await verifyBridgeSignature(
          secret,
          body,
          c.req.header('X-Wyv-Bridge-Timestamp') || null,
          c.req.header('X-Wyv-Bridge-Signature') || null
        );
      } catch (err) {
        return errorResponse('UNAUTHORIZED', (err as Error).message, 401);
      }
    }

    const payload = wyvTokenIntrospectSchema.parse(JSON.parse(new TextDecoder().decode(body)));
    const repo = await loadRepository(c.env);
    const token = Object.values(repo.state.apiTokens).find((item) => item.plaintext_token === payload.token && !item.revoked_at);
    if (!token) return errorResponse('UNAUTHORIZED', 'Invalid API token', 401);
    
    token.last_used_at = nowIso();
    await repo.save();
    
    const user = repo.state.users[token.user_id];
    if (!user) return errorResponse('UNAUTHORIZED', 'API token user not found', 401);
    
    return successResponse({ active: true, token_id: token.id, token_name: token.name, user: serializeWyvUser(user) });
  });

  api.post('/internal/sync/batch', async (c) => {
    const secret = getConfig(c.env).wyvSharedSecret;
    const body = await c.req.arrayBuffer();
    if (secret) {
      try {
        await verifyBridgeSignature(
          secret,
          body,
          c.req.header('X-Wyvern-Bridge-Timestamp') || null,
          c.req.header('X-Wyvern-Bridge-Signature') || null
        );
      } catch (err) {
        return errorResponse('UNAUTHORIZED', (err as Error).message, 401);
      }
    }

    const payload = JSON.parse(new TextDecoder().decode(body));
    return successResponse({ ok: true, mode: 'workers', received: payload });
  });
  
  api.post('/internal/sync/bootstrap', async (c) => {
    const secret = getConfig(c.env).wyvSharedSecret;
    const body = await c.req.arrayBuffer();
    if (secret) {
      try {
        await verifyBridgeSignature(
          secret,
          body,
          c.req.header('X-Wyvern-Bridge-Timestamp') || null,
          c.req.header('X-Wyvern-Bridge-Signature') || null
        );
      } catch (err) {
        return errorResponse('UNAUTHORIZED', (err as Error).message, 401);
      }
    }

    const repo = await loadRepository(c.env);
    return successResponse({ ok: true, users: Object.keys(repo.state.users).length, servers: Object.keys(repo.state.servers).length, channels: Object.keys(repo.state.channels).length });
  });
  
  api.post('/internal/sync/realtime', async (c) => {
    const secret = getConfig(c.env).wyvSharedSecret;
    const body = await c.req.arrayBuffer();
    if (secret) {
      try {
        await verifyBridgeSignature(
          secret,
          body,
          c.req.header('X-Wyvern-Bridge-Timestamp') || null,
          c.req.header('X-Wyvern-Bridge-Signature') || null
        );
      } catch (err) {
        return errorResponse('UNAUTHORIZED', (err as Error).message, 401);
      }
    }

    const payload = JSON.parse(new TextDecoder().decode(body));
    return successResponse({ ok: true, accepted: payload });
  });

  api.get('/openai/v1/models', (c) => new Response(JSON.stringify({ success: false, data: null, error: { code: 'GATEWAY_MOVED', message: 'Wyvern legacy OpenAI routes are disabled. Use Wyv /openai/v1 instead.', details: { wyv_public_base_url: getConfig(c.env).wyvPublicBaseUrl } } }, null, 2), { status: 410, headers: { 'content-type': 'application/json; charset=utf-8' } }));
  api.post('/openai/v1/chat/completions', (c) => errorResponse('GATEWAY_MOVED', 'Wyvern legacy OpenAI routes are disabled. Use Wyv /openai/v1 instead.', 410, { wyv_public_base_url: getConfig(c.env).wyvPublicBaseUrl }));
  api.post('/openai/v1/responses', (c) => errorResponse('GATEWAY_MOVED', 'Wyvern legacy OpenAI routes are disabled. Use Wyv /openai/v1 instead.', 410, { wyv_public_base_url: getConfig(c.env).wyvPublicBaseUrl }));
  api.all('/openai/v1/*', (c) => errorResponse('GATEWAY_MOVED', 'Wyvern legacy OpenAI routes are disabled. Use Wyv /openai/v1 instead.', 410, { wyv_public_base_url: getConfig(c.env).wyvPublicBaseUrl }));
  api.all('*', (c) => errorResponse('NOT_FOUND', `Route not found: ${new URL(c.req.url).pathname}`, 404));
  return api;
}

async function requireUser(c: AppContext): Promise<AuthenticatedUser | null> {
  const token = readBearerToken(c.req.header('authorization') || null);
  if (!token) return null;
  try { return await verifyAccessToken(c.env, token); } catch { return null; }
}

function toAuthUser(user: UserRecord): AuthenticatedUser { return { user_id: user.id, username: user.username, discriminator: user.discriminator, display_name: user.display_name || undefined, email: user.email, avatar: user.avatar || undefined }; }
function serializeUser(user: UserRecord) { return { id: user.id, username: user.username, discriminator: user.discriminator, display_name: user.display_name, bio: user.bio, directory_opt_in: user.directory_opt_in, email: user.email, avatar: user.avatar, is_paid: user.is_paid, created_at: user.created_at }; }
function serializePublicUser(user: UserRecord) { const full = serializeUser(user); return { id: full.id, username: full.username, discriminator: full.discriminator, display_name: full.display_name, bio: full.bio, directory_opt_in: full.directory_opt_in, avatar: full.avatar, created_at: full.created_at }; }
function serializeMe(user: UserRecord, env: Env) { return { ...serializeUser(user), is_admin: isAdmin(user, env), accepted_terms_version: user.accepted_terms_version, accepted_privacy_version: user.accepted_privacy_version, legal_accepted_at: user.legal_accepted_at, legal_reaccept_required: requiresLegalReacceptance(user), ai_opt_in: user.ai_opt_in, nsfw_18_verified: user.nsfw_18_verified }; }
function serializeServer(state: Awaited<ReturnType<typeof loadRepository>>['state'], server: ServerRecord, currentUserId?: string) { const owner = state.users[server.owner_id]; const membership = currentUserId ? state.serverMembers[memberKey(server.id, currentUserId)] : null; return { ...server, owner: owner ? serializePublicUser(owner) : null, owner_display_name: owner?.display_name || null, member_count: listServerMembers(state, server.id).length, current_user_membership: membership ? { ...membership } : null }; }
function canManageServer(state: Awaited<ReturnType<typeof loadRepository>>['state'], serverId: string, userId: string): boolean { const membership = state.serverMembers[memberKey(serverId, userId)]; return !!membership && ['owner', 'admin', 'moderator'].includes(membership.role); }
function canAccessChannel(state: Awaited<ReturnType<typeof loadRepository>>['state'], channelId: string, userId: string): boolean { const channel = state.channels[channelId]; if (!channel) return false; if (channel.type === 'dm') return !!state.dmParticipants[dmParticipantKey(channelId, userId)] && !state.dmHiddenStates[dmHiddenKey(channelId, userId)]; return !!channel.server_id && !!state.serverMembers[memberKey(channel.server_id, userId)]; }
function canPinMessage(state: Awaited<ReturnType<typeof loadRepository>>['state'], message: MessageRecord, userId: string): boolean { if (message.author_id === userId) return true; const channel = state.channels[message.channel_id]; if (!channel) return false; if (channel.type === 'dm') return canAccessChannel(state, channel.id, userId); return !!channel.server_id && canManageServer(state, channel.server_id, userId); }
function serializeDmChannel(state: Awaited<ReturnType<typeof loadRepository>>['state'], channel: ChannelRecord, currentUserId?: string) { const participants = listDmParticipants(state, channel.id).map((participant) => state.users[participant.user_id]).filter(Boolean).map((user) => ({ id: user.id, username: user.username, discriminator: user.discriminator, display_name: user.display_name, avatar: user.avatar })); const recipient = currentUserId ? participants.find((user) => user.id !== currentUserId) || null : participants[0] || null; return { ...channel, participants, recipient, display_name: recipient?.display_name || recipient?.username || channel.name || 'Direct Message' }; }
function serializeMessage(state: Awaited<ReturnType<typeof loadRepository>>['state'], message: MessageRecord | undefined, currentUserId?: string) { if (!message) return null; const author = state.users[message.author_id]; const grouped = new Map<string, string[]>(); for (const reaction of listMessageReactions(state, message.id)) { const users = grouped.get(reaction.emoji) || []; users.push(reaction.user_id); grouped.set(reaction.emoji, users); } const bookmarkedByMe = !!currentUserId && Object.values(state.messageBookmarks).some((item) => item.user_id === currentUserId && item.message_id === message.id); return { ...message, author: author ? serializePublicUser(author) : null, bookmarked_by_me: bookmarkedByMe, reply_to: message.reply_to_id ? previewReply(state, state.messages[message.reply_to_id]) : null, reactions: Array.from(grouped.entries()).map(([emoji, users]) => ({ emoji, count: users.length, users })) }; }
function previewReply(state: Awaited<ReturnType<typeof loadRepository>>['state'], message: MessageRecord | undefined) { if (!message) return null; const author = state.users[message.author_id]; return { id: message.id, author_id: message.author_id, author: author ? serializePublicUser(author) : null, content: message.content, attachments: message.attachments, created_at: message.created_at, edited_at: message.edited_at, is_nsfw: message.is_nsfw }; }
function legalMetadata() { return { terms_version: '2026-05-22', privacy_version: '2026-05-22', effective_date: '2026-05-22', effective_date_label: 'May 22, 2026', terms_url: '/legal/terms', privacy_url: '/legal/privacy', legal_contact_email: LEGAL_CONTACT_EMAIL, support_contact_email: SUPPORT_CONTACT_EMAIL, operator_name: OPERATOR_NAME }; }
function buildUiVariantCatalog(repo: Awaited<ReturnType<typeof loadRepository>>, currentVote: 'original' | 'ui_a' | 'ui_b' | null) { const counts = { original: 0, ui_a: 0, ui_b: 0 } as Record<'original' | 'ui_a' | 'ui_b', number>; for (const vote of Object.values(repo.state.uiVariantVotes)) counts[vote.variant_key] += 1; return { poll_key: 'edge-ui-variant', current_vote: currentVote, variants: Object.values(UI_VARIANTS).map((variant) => ({ ...variant, available: true, vote_count: counts[variant.key], current_user_vote: currentVote === variant.key })) }; }
function serializeApiToken(token: ApiTokenRecord) { return { id: token.id, user_id: token.user_id, name: token.name, created_at: token.created_at, last_used_at: token.last_used_at, revoked_at: token.revoked_at }; }
function serializeWebhook(webhook: WebhookRecord) { return { id: webhook.id, server_id: webhook.server_id, channel_id: webhook.channel_id, name: webhook.name, description: webhook.description, active: webhook.active, created_by: webhook.created_by, created_at: webhook.created_at, updated_at: webhook.updated_at, last_used_at: webhook.last_used_at, webhook_url: `/api/v1/webhooks/${webhook.id}/${webhook.token_plaintext}` }; }
function defaultWorkspaceTitle(channel: ChannelRecord) { return `${channel.name} workspace`; }
function buildWorkspacePlaceholder(channel: ChannelRecord, currentUserId: string, visibility: string) { return { id: null, channel_id: channel.id, title: defaultWorkspaceTitle(channel), mode: 'markdown', language: 'plaintext', visibility, content: '', owner_user_id: visibility === 'private' ? currentUserId : null, updated_by_user_id: currentUserId, created_at: nowIso(), updated_at: nowIso(), revisions: [] }; }
function serializeWorkspace(repo: Awaited<ReturnType<typeof loadRepository>>, document: WorkspaceDocumentRecord) { return { ...document, revisions: Object.values(repo.state.workspaceRevisions).filter((item) => item.document_id === document.id).sort((a, b) => a.created_at.localeCompare(b.created_at)) }; }
function serializeAdminUser(user: UserRecord) { return { id: user.id, username: user.username, discriminator: user.discriminator, display_name: user.display_name, bio: user.bio, directory_opt_in: user.directory_opt_in, avatar: user.avatar, is_paid: user.is_paid, created_at: user.created_at }; }
function isAdmin(user: UserRecord, env: Env) { return getConfig(env).adminAllowlist.includes(`${user.username}#${user.discriminator}`); }
function serializeWyvUser(user: UserRecord) { return { user_id: user.id, sync_id: null, username: user.username, discriminator: user.discriminator, display_name: user.display_name, email: user.email, avatar: user.avatar, bio: user.bio, directory_opt_in: user.directory_opt_in, ai_opt_in: user.ai_opt_in, nsfw_18_verified: user.nsfw_18_verified }; }

const blockedUploadTypes = new Set([
  'application/javascript',
  'application/xhtml+xml',
  'application/xml',
  'image/svg+xml',
  'text/html',
  'text/javascript',
  'text/xml',
]);
const allowedDocumentTypes = new Set([
  'application/json',
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'text/markdown',
  'text/plain',
]);
const blockedUploadExtensions = new Set(['.htm', '.html', '.js', '.mjs', '.svg', '.xhtml', '.xml']);

function isAllowedUpload(contentType: string, filename: string): boolean {
  const normalizedType = contentType.split(';', 1)[0].trim().toLowerCase();
  const extensionMatch = filename.toLowerCase().match(/\.[a-z0-9]+$/);
  if (!normalizedType || blockedUploadTypes.has(normalizedType) || (extensionMatch && blockedUploadExtensions.has(extensionMatch[0]))) return false;
  return normalizedType.startsWith('image/')
    || normalizedType.startsWith('video/')
    || normalizedType.startsWith('audio/')
    || allowedDocumentTypes.has(normalizedType);
}

function sanitizeUploadFilename(filename: string): string {
  const basename = (filename || 'upload.bin').split(/[\\/]/).pop() || 'upload.bin';
  const sanitized = basename.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized.slice(-180) || 'upload.bin';
}

function queueRealtimeEvent(repo: Awaited<ReturnType<typeof loadRepository>>, event: string, payload: Record<string, unknown>, channelId: string | null, userId: string | null) {
  const id = repo.nextId('realtime_event');
  repo.state.realtimeEvents[id] = { id, event, channel_id: channelId, user_id: userId, payload, created_at: nowIso() };
}
