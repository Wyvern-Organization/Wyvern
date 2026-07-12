import { getConfig } from './config';
import { dmHiddenKey, dmParticipantKey, getRuntimeControls, loadRepository, memberKey } from './state';
import type { Env } from './types';

export type RealtimeAccessResult =
  | { allowed: true }
  | { allowed: false; code: string; message: string };

function denied(code: string, message: string): RealtimeAccessResult {
  return { allowed: false, code, message };
}

function hasActiveServerBan(state: Awaited<ReturnType<typeof loadRepository>>['state'], serverId: string, userId: string): boolean {
  return Object.values(state.serverBans).some((ban) => ban.server_id === serverId && ban.user_id === userId && !ban.unbanned_at);
}

function hasActiveServerTimeout(state: Awaited<ReturnType<typeof loadRepository>>['state'], serverId: string, userId: string): boolean {
  const now = Date.now();
  return Object.values(state.serverTimeouts).some((timeout) => (
    timeout.server_id === serverId
    && timeout.user_id === userId
    && !timeout.revoked_at
    && new Date(timeout.expires_at).getTime() > now
  ));
}

export async function authorizeRealtimeChannel(env: Env, userId: string, channelId: string): Promise<RealtimeAccessResult> {
  const repo = await loadRepository(env);
  const user = repo.state.users[userId];
  const moderation = repo.state.userModerationRecords[userId];
  if (!user || (moderation && moderation.status !== 'active')) {
    return denied('ACCOUNT_UNAVAILABLE', 'This account cannot use realtime services');
  }

  const channel = repo.state.channels[channelId];
  if (!channel) return denied('CHANNEL_NOT_FOUND', 'Channel not found');

  if (channel.type === 'dm') {
    if (!repo.state.dmParticipants[dmParticipantKey(channel.id, userId)] || repo.state.dmHiddenStates[dmHiddenKey(channel.id, userId)]) {
      return denied('CHANNEL_FORBIDDEN', 'You do not have access to this direct message');
    }
    return { allowed: true };
  }

  if (!channel.server_id || hasActiveServerBan(repo.state, channel.server_id, userId) || !repo.state.serverMembers[memberKey(channel.server_id, userId)]) {
    return denied('CHANNEL_FORBIDDEN', 'You do not have access to this server channel');
  }
  return { allowed: true };
}

export async function authorizeVoiceParticipation(env: Env, userId: string, channelId: string): Promise<RealtimeAccessResult> {
  const channelAccess = await authorizeRealtimeChannel(env, userId, channelId);
  if (!channelAccess.allowed) return channelAccess;

  const repo = await loadRepository(env);
  const channel = repo.state.channels[channelId];
  if (!channel || !['voice', 'dm'].includes(channel.type)) {
    return denied('VOICE_CHANNEL_REQUIRED', 'This channel does not support voice');
  }

  const persisted = getRuntimeControls(repo.state);
  const controls = persisted.updated_at ? persisted : getConfig(env).runtimeControlDefaults;
  if (!controls.voice_enabled) return denied('FEATURE_DISABLED', 'Voice is temporarily unavailable');
  if (channel.server_id && hasActiveServerTimeout(repo.state, channel.server_id, userId)) {
    return denied('SERVER_TIMEOUT_ACTIVE', 'You are temporarily unable to participate in voice in this server');
  }
  return { allowed: true };
}
