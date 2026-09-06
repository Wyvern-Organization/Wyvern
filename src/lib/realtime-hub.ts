import { authorizeRealtimeChannel, authorizeVoiceParticipation } from './realtime-access';
import { loadRepository } from './state';
import type { AuthenticatedUser, Env } from './types';

type ClientSession = {
  socket: WebSocket;
  user: AuthenticatedUser;
  channelIds: Set<string>;
  connectedAt: string;
};

type IncomingAction = {
  action?: string;
  channel_ids?: string[];
  channel_id?: string | null;
  target_user_id?: string | null;
  signal_type?: string | null;
  payload?: Record<string, unknown>;
  active?: boolean;
  status?: string;
};

type EventEnvelope = {
  type: string;
  channel_id?: string | null;
  payload?: Record<string, unknown>;
};

export class RealtimeHub {
  private state: DurableObjectState;
  private env: Env;
  private sessions = new Map<WebSocket, ClientSession>();
  private voiceParticipants = new Map<string, Set<string>>();
  private typingUsers = new Map<string, Set<string>>();
  private lifecycleEvents: Array<{ type: string; user_id: string; at: string }> = [];

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket' && url.pathname.endsWith('/connect')) {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      const userHeader = request.headers.get('x-wyvern-user');
      const user = userHeader ? JSON.parse(userHeader) as AuthenticatedUser : null;
      if (!user?.user_id) {
        client.close(1008, 'unauthorized');
        return new Response(null, { status: 101, webSocket: server });
      }
      server.accept();
      this.sessions.set(server, { socket: server, user, channelIds: new Set(), connectedAt: new Date().toISOString() });
      this.lifecycleEvents.push({ type: 'socket.connected', user_id: user.user_id, at: new Date().toISOString() });
      server.send(JSON.stringify({ type: 'connected', backend: request.headers.get('x-wyvern-realtime-backend') || 'durable_object' }));
      server.addEventListener('message', (event) => { void this.handleSocketMessage(server, String(event.data || '')); });
      server.addEventListener('close', () => this.handleSocketClose(server));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === 'POST' && url.pathname.endsWith('/emit')) {
      const body = await request.json() as EventEnvelope;
      this.broadcast(body.type, body.payload || {}, body.channel_id || null);
      return Response.json({ success: true, data: { emitted: true }, error: null });
    }

    if (request.method === 'POST' && url.pathname.endsWith('/revoke-voice')) {
      const body = await request.json().catch(() => null) as { server_id?: unknown; user_id?: unknown } | null;
      const serverId = typeof body?.server_id === 'string' ? body.server_id : '';
      const userId = typeof body?.user_id === 'string' ? body.user_id : '';
      if (!serverId || !userId) return new Response('Invalid revoke request', { status: 400 });
      const repo = await loadRepository(this.env);
      for (const [channelId, participants] of this.voiceParticipants.entries()) {
        if (repo.state.channels[channelId]?.server_id !== serverId || !participants.delete(userId)) continue;
        this.broadcast('voice.participants', { channel_id: channelId, user_ids: Array.from(participants) }, channelId);
      }
      this.broadcast('voice.timeout', { server_id: serverId }, null, userId);
      return Response.json({ success: true, data: { revoked: true }, error: null });
    }

    if (request.method === 'GET' && url.pathname.endsWith('/snapshot')) {
      return Response.json({
        success: true,
        data: {
          backend: 'durable_object',
          sessions: this.sessions.size,
          channels: Array.from(new Set(Array.from(this.sessions.values()).flatMap((session) => Array.from(session.channelIds)))),
          users: Array.from(new Set(Array.from(this.sessions.values()).map((session) => session.user.user_id))),
          typing_users: Object.fromEntries(Array.from(this.typingUsers.entries()).map(([channelId, users]) => [channelId, Array.from(users)])),
          voice_participants: Object.fromEntries(Array.from(this.voiceParticipants.entries()).map(([channelId, users]) => [channelId, Array.from(users)])),
          subscriptions: Object.fromEntries(Array.from(this.sessions.values()).map((session) => [session.user.user_id, Array.from(session.channelIds)])),
          session_details: Array.from(this.sessions.values()).map((session) => ({
            user_id: session.user.user_id,
            connected_at: session.connectedAt,
            subscribed_channels: Array.from(session.channelIds),
          })),
          lifecycle_events: this.lifecycleEvents.slice(-50),
        },
        error: null,
      });
    }

    if (request.method === 'POST' && url.pathname.endsWith('/verify-connect')) {
      const userHeader = request.headers.get('x-wyvern-user');
      const user = userHeader ? JSON.parse(userHeader) as AuthenticatedUser : null;
      return Response.json({
        success: true,
        data: {
          backend: 'durable_object',
          connect_ready: !!user?.user_id,
          user_id: user?.user_id || null,
        },
        error: null,
      });
    }

    return new Response('Not found', { status: 404 });
  }

  private async handleSocketMessage(socket: WebSocket, raw: string) {
    let body: IncomingAction = {};
    try {
      body = JSON.parse(raw) as IncomingAction;
    } catch {
      return;
    }
    const session = this.sessions.get(socket);
    if (!session) return;

    const action = String(body.action || '');
    if (action === 'ping') {
      socket.send(JSON.stringify({ type: 'pong' }));
      return;
    }
    if (action === 'disconnect') {
      this.handleSocketClose(socket);
      try {
        socket.close(1000, 'client requested');
      } catch {}
      return;
    }
    if (action === 'subscribe') {
      const denied: Array<{ channel_id: string; code: string }> = [];
      for (const rawChannelId of body.channel_ids || []) {
        const channelId = String(rawChannelId);
        const access = await authorizeRealtimeChannel(this.env, session.user.user_id, channelId);
        if (access.allowed) session.channelIds.add(channelId);
        else denied.push({ channel_id: channelId, code: access.code });
      }
      socket.send(JSON.stringify({ type: 'subscribed', channel_ids: Array.from(session.channelIds) }));
      if (denied.length) socket.send(JSON.stringify({ event: 'realtime.denied', data: { action: 'subscribe', denied } }));
      return;
    }
    if (action === 'unsubscribe') {
      for (const channelId of body.channel_ids || []) session.channelIds.delete(String(channelId));
      socket.send(JSON.stringify({ type: 'unsubscribed', channel_ids: Array.from(session.channelIds) }));
      return;
    }
    if (action === 'typing') {
      const channelId = String(body.channel_id || '');
      if (!channelId) return;
      const access = await authorizeRealtimeChannel(this.env, session.user.user_id, channelId);
      if (!access.allowed) return this.sendDenied(socket, action, access.code, access.message, channelId);
      const channelUsers = this.typingUsers.get(channelId) || new Set<string>();
      if (body.active === false) channelUsers.delete(session.user.user_id);
      else channelUsers.add(session.user.user_id);
      this.typingUsers.set(channelId, channelUsers);
      this.broadcast('typing.updated', { channel_id: channelId, user_ids: Array.from(channelUsers) }, channelId);
      return;
    }
    if (action === 'join_voice') {
      const channelId = String(body.channel_id || '');
      if (!channelId) return;
      const access = await authorizeVoiceParticipation(this.env, session.user.user_id, channelId);
      if (!access.allowed) return this.sendDenied(socket, action, access.code, access.message, channelId);
      const participants = this.voiceParticipants.get(channelId) || new Set<string>();
      participants.add(session.user.user_id);
      this.voiceParticipants.set(channelId, participants);
      this.broadcast('voice.participants', { channel_id: channelId, user_ids: Array.from(participants) }, channelId);
      return;
    }
    if (action === 'leave_voice') {
      const channelId = String(body.channel_id || '');
      if (!channelId) return;
      const participants = this.voiceParticipants.get(channelId) || new Set<string>();
      participants.delete(session.user.user_id);
      this.voiceParticipants.set(channelId, participants);
      this.broadcast('voice.participants', { channel_id: channelId, user_ids: Array.from(participants) }, channelId);
      return;
    }
    if (action === 'voice.status') {
      const channelId = String(body.channel_id || '') || null;
      if (!channelId) return;
      const access = await authorizeVoiceParticipation(this.env, session.user.user_id, channelId);
      if (!access.allowed) return this.sendDenied(socket, action, access.code, access.message, channelId);
      this.broadcast('voice.status', { user_id: session.user.user_id, channel_id: channelId, ...(body.payload || {}) }, channelId);
      return;
    }
    if (action === 'call.signal') {
      const channelId = String(body.channel_id || '') || null;
      if (!channelId) return;
      const access = await authorizeRealtimeChannel(this.env, session.user.user_id, channelId);
      if (!access.allowed) return this.sendDenied(socket, action, access.code, access.message, channelId);
      const targetUserId = String(body.target_user_id || '') || null;
      this.broadcast('call.signal', {
        channel_id: channelId,
        from_user_id: session.user.user_id,
        target_user_id: targetUserId,
        signal_type: String(body.signal_type || ''),
        payload: body.payload || null,
      }, channelId, targetUserId);
      return;
    }
    if (action === 'presence' || action === 'presence.update') {
      this.broadcast('presence.updated', { user_id: session.user.user_id, ...(body.payload || {}), status: body.status || body.payload?.status || 'online' }, null);
      return;
    }
  }

  private sendDenied(socket: WebSocket, action: string, code: string, message: string, channelId: string | null = null) {
    socket.send(JSON.stringify({ event: 'realtime.denied', channel_id: channelId, data: { action, code, message } }));
  }

  private handleSocketClose(socket: WebSocket) {
    const session = this.sessions.get(socket);
    if (!session) return;
    this.sessions.delete(socket);
    this.lifecycleEvents.push({ type: 'socket.disconnected', user_id: session.user.user_id, at: new Date().toISOString() });
    for (const users of this.typingUsers.values()) users.delete(session.user.user_id);
    for (const participants of this.voiceParticipants.values()) participants.delete(session.user.user_id);
  }

  private broadcast(type: string, payload: Record<string, unknown>, channelId: string | null, targetUserId: string | null = null) {
    const event = JSON.stringify({ event: type, channel_id: channelId, data: payload });
    for (const [socket, session] of this.sessions.entries()) {
      if (targetUserId && session.user.user_id !== targetUserId) continue;
      if (channelId && !session.channelIds.has(channelId)) continue;
      try {
        socket.send(event);
      } catch {
        this.sessions.delete(socket);
      }
    }
  }
}
