import type { AppState, ChannelRecord, DMParticipantRecord, MessageRecord, ReactionRecord, RefreshTokenRecord, ServerMemberRecord, ServerRecord, UserRecord } from './domain';
import type { Env } from './types';

export interface AppRepository {
  state: AppState;
  save(): Promise<void>;
  nextId(prefix: string): string;
}

const globalState = new Map<string, AppState>();

export async function loadRepository(env: Env): Promise<AppRepository> {
  const key = env.ENVIRONMENT || 'default';
  const state = normalizeState(await loadState(env, key));
  env.__APP_STATE__ = state;

  return {
    state,
    async save() {
      await saveState(env, key, state);
      env.__APP_STATE__ = state;
    },
    nextId(prefix: string) {
      const value = (state.counters[prefix] || 0) + 1;
      state.counters[prefix] = value;
      return `${prefix}_${value}`;
    },
  };
}

async function loadState(env: Env, key: string): Promise<AppState> {
  if (!env.APP_STATE_ROOM) {
    if (!globalState.has(key)) {
      globalState.set(key, env.__APP_STATE__ || createEmptyState());
    }
    return globalState.get(key)!;
  }

  try {
    const stub = env.APP_STATE_ROOM.get(env.APP_STATE_ROOM.idFromName(key));
    const response = await stub.fetch('https://app-state.internal/state');
    if (!response.ok) throw new Error(`app-state load failed: ${response.status}`);
    const payload = await response.json() as { data: AppState };
    return payload.data || createEmptyState();
  } catch {
    if (!globalState.has(key)) {
      globalState.set(key, env.__APP_STATE__ || createEmptyState());
    }
    return globalState.get(key)!;
  }
}

async function saveState(env: Env, key: string, state: AppState): Promise<void> {
  if (!env.APP_STATE_ROOM) {
    globalState.set(key, state);
    return;
  }

  try {
    const stub = env.APP_STATE_ROOM.get(env.APP_STATE_ROOM.idFromName(key));
    const response = await stub.fetch('https://app-state.internal/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(state),
    });
    if (!response.ok) throw new Error(`app-state save failed: ${response.status}`);
  } catch {
    globalState.set(key, state);
  }
}

export function resetRepository(env: Env): void {
  const key = env.ENVIRONMENT || 'default';
  const empty = createEmptyState();
  globalState.set(key, empty);
  env.__APP_STATE__ = empty;
}

export function createEmptyState(): AppState {
  return {
    users: {},
    refreshTokens: {},
    apiTokens: {},
    servers: {},
    serverMembers: {},
    serverInvites: {},
    channels: {},
    dmParticipants: {},
    dmHiddenStates: {},
    messages: {},
    reactions: {},
    messageBookmarks: {},
    mediaObjects: {},
    channelReadStates: {},
    webhooks: {},
    webhookDeliveries: {},
    workspaceDocuments: {},
    workspaceRevisions: {},
    communityActivities: {},
    realtimeEvents: {},
    uiVariantVotes: {},
    counters: {},
  };
}

export function memberKey(serverId: string, userId: string): string {
  return `${serverId}:${userId}`;
}

export function dmParticipantKey(channelId: string, userId: string): string {
  return `${channelId}:${userId}`;
}

export function dmHiddenKey(channelId: string, userId: string): string {
  return `${channelId}:${userId}`;
}

export function reactionKey(messageId: string, emoji: string, userId: string): string {
  return `${messageId}:${emoji}:${userId}`;
}

export function readStateKey(channelId: string, userId: string): string {
  return `${channelId}:${userId}`;
}

export function sortByCreated<T extends { created_at: string }>(items: T[]): T[] {
  return items.sort((left, right) => left.created_at.localeCompare(right.created_at));
}

export function sortChannels(items: ChannelRecord[]): ChannelRecord[] {
  return items.sort((left, right) => left.position - right.position || left.created_at.localeCompare(right.created_at));
}

export function listServerMembers(state: AppState, serverId: string): ServerMemberRecord[] {
  return Object.values(state.serverMembers).filter((item) => item.server_id === serverId);
}

export function listServerChannels(state: AppState, serverId: string): ChannelRecord[] {
  return sortChannels(Object.values(state.channels).filter((item) => item.server_id === serverId));
}

export function listDmParticipants(state: AppState, channelId: string): DMParticipantRecord[] {
  return Object.values(state.dmParticipants).filter((item) => item.channel_id === channelId);
}

export function listChannelMessages(state: AppState, channelId: string): MessageRecord[] {
  return sortByCreated(Object.values(state.messages).filter((item) => item.channel_id === channelId));
}

export function listMessageReactions(state: AppState, messageId: string): ReactionRecord[] {
  return Object.values(state.reactions).filter((item) => item.message_id === messageId);
}

export function listUserServers(state: AppState, userId: string): ServerRecord[] {
  const memberships = Object.values(state.serverMembers).filter((item) => item.user_id === userId);
  return memberships.map((item) => state.servers[item.server_id]).filter(Boolean);
}

export function listUserDms(state: AppState, userId: string): ChannelRecord[] {
  const participantChannelIds = new Set(Object.values(state.dmParticipants).filter((item) => item.user_id === userId).map((item) => item.channel_id));
  const hiddenChannelIds = new Set(Object.values(state.dmHiddenStates).filter((item) => item.user_id === userId).map((item) => item.channel_id));
  return sortChannels(Object.values(state.channels).filter((item) => item.type === 'dm' && participantChannelIds.has(item.id) && !hiddenChannelIds.has(item.id)));
}

export function getRefreshTokenByHash(state: AppState, tokenHash: string): RefreshTokenRecord | undefined {
  return Object.values(state.refreshTokens).find((item) => item.token_hash === tokenHash);
}

export function getUserByEmail(state: AppState, email: string): UserRecord | undefined {
  const normalized = email.trim().toLowerCase();
  return Object.values(state.users).find((item) => item.email.toLowerCase() === normalized);
}

function normalizeState(state: AppState): AppState {
  state.dmHiddenStates ||= {};
  state.mediaObjects ||= {};
  state.realtimeEvents ||= {};
  state.counters ||= {};
  return state;
}
