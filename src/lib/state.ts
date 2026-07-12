import { DEFAULT_RUNTIME_CONTROLS, type AppState, type ChannelRecord, type DMParticipantRecord, type EmailVerificationRecord, type MessageRecord, type PremiumEntitlementRecord, type ProfileCosmetics, type ReactionRecord, type RefreshTokenRecord, type RuntimeControls, type ServerMemberRecord, type ServerRecord, type UserRecord, type WorkspaceGitCommitRecord } from './domain';
import type { Env } from './types';

export interface AppRepository {
  state: AppState;
  save(): Promise<void>;
  nextId(prefix: string): string;
}

export class AppStateConflictError extends Error {
  constructor() {
    super('Application state changed before this request could be saved');
    this.name = 'AppStateConflictError';
  }
}

export const WORKSPACE_GIT_MAX_REPOSITORY_BYTES = 1 * 1024 * 1024;

export type WorkspaceGitPushFailure = 'access_revoked' | 'branch_changed' | 'document_changed' | 'invalid_push' | 'repository_limit';

export interface WorkspaceGitPushPatch {
  repository_id: string;
  credential_id: string;
  user_id: string;
  expected_head: string | null;
  required_email_verification_version: number;
  commit: WorkspaceGitCommitRecord;
  objects: Array<{
    sha: string;
    type: 'commit' | 'tree' | 'blob' | 'tag';
    content_base64: string;
    size: number;
    created_at: string;
  }>;
  document: {
    id: string;
    expected_updated_at: string;
    content: string;
    updated_at: string;
    updated_by_user_id: string;
  };
  repository_updated_at: string;
}

export type WorkspaceGitPushResult = { applied: true; head: string } | { applied: false; reason: WorkspaceGitPushFailure };

const globalState = new Map<string, AppState>();

interface LoadedState {
  state: AppState;
  revision: number | null;
}

export async function loadRepository(env: Env): Promise<AppRepository> {
  const key = env.ENVIRONMENT || 'default';
  const loaded = await loadState(env, key);
  const state = normalizeState(loaded.state);
  let revision = loaded.revision;
  env.__APP_STATE__ = state;

  return {
    state,
    async save() {
      revision = await saveState(env, key, state, revision);
      env.__APP_STATE__ = state;
    },
    nextId(prefix: string) {
      const value = (state.counters[prefix] || 0) + 1;
      state.counters[prefix] = value;
      return `${prefix}_${value}`;
    },
  };
}

async function loadState(env: Env, key: string): Promise<LoadedState> {
  if (!env.APP_STATE_ROOM) {
    if (!globalState.has(key)) {
      globalState.set(key, env.__APP_STATE__ || createEmptyState());
    }
    return { state: globalState.get(key)!, revision: null };
  }

  const stub = env.APP_STATE_ROOM.get(env.APP_STATE_ROOM.idFromName(key));
  const response = await stub.fetch('https://app-state.internal/state');
  if (!response.ok) throw new Error(`app-state load failed: ${response.status}`);
  const payload = await response.json() as { data?: AppState; revision?: number };
  return { state: payload.data || createEmptyState(), revision: Number.isInteger(payload.revision) ? payload.revision! : 0 };
}

async function saveState(env: Env, key: string, state: AppState, expectedRevision: number | null = null): Promise<number | null> {
  if (!env.APP_STATE_ROOM) {
    globalState.set(key, state);
    return null;
  }

  const stub = env.APP_STATE_ROOM.get(env.APP_STATE_ROOM.idFromName(key));
  const response = await stub.fetch('https://app-state.internal/state', {
    method: 'PUT',
    headers: expectedRevision === null
      ? { 'content-type': 'application/json' }
      : { 'content-type': 'application/json', 'X-Wyvern-State-Revision': String(expectedRevision) },
    body: JSON.stringify(state),
  });
  if (response.status === 409) throw new AppStateConflictError();
  if (!response.ok) throw new Error(`app-state save failed: ${response.status}`);
  const payload = await response.json() as { data?: { revision?: number } };
  return Number.isInteger(payload.data?.revision) ? payload.data!.revision! : expectedRevision;
}

/**
 * Apply the small set of records changed by a Git push. Production routes this
 * through the state Durable Object, where it is serialized with all other
 * state mutations instead of writing a stale copy of the entire application.
 */
export async function applyWorkspaceGitPush(env: Env, patch: WorkspaceGitPushPatch): Promise<WorkspaceGitPushResult> {
  const key = env.ENVIRONMENT || 'default';
  if (!env.APP_STATE_ROOM) {
    const state = normalizeState(globalState.get(key) || env.__APP_STATE__ || createEmptyState());
    const result = applyWorkspaceGitPushPatch(state, patch);
    if (result.applied) {
      globalState.set(key, state);
      env.__APP_STATE__ = state;
    }
    return result;
  }

  const stub = env.APP_STATE_ROOM.get(env.APP_STATE_ROOM.idFromName(key));
  const response = await stub.fetch('https://app-state.internal/state/workspace-git-push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(`app-state Git push failed: ${response.status}`);
  const payload = await response.json() as { data?: WorkspaceGitPushResult };
  if (!payload.data || typeof payload.data.applied !== 'boolean') throw new Error('app-state Git push returned an invalid response');
  return payload.data;
}

/** Internal Durable Object helper; mutates only Git and Workspace records. */
export function applyWorkspaceGitPushPatch(state: AppState, patch: WorkspaceGitPushPatch): WorkspaceGitPushResult {
  normalizeState(state);
  if (!validWorkspaceGitPushPatch(patch)) return { applied: false, reason: 'invalid_push' };

  const repository = state.workspaceGitRepositories[patch.repository_id];
  const document = repository ? state.workspaceDocuments[repository.document_id] : null;
  if (!repository || !document || repository.document_id !== patch.document.id || patch.commit.repository_id !== repository.id) {
    return { applied: false, reason: 'invalid_push' };
  }
  if ((repository.head_commit_sha || null) !== patch.expected_head) return { applied: false, reason: 'branch_changed' };
  if (document.updated_at !== patch.document.expected_updated_at) return { applied: false, reason: 'document_changed' };
  if (!canUseWorkspaceGit(state, repository.id, patch.credential_id, patch.user_id, patch.required_email_verification_version)) {
    return { applied: false, reason: 'access_revoked' };
  }

  const existingCommit = state.workspaceGitCommits[patch.commit.sha];
  if (existingCommit && existingCommit.repository_id !== repository.id) return { applied: false, reason: 'invalid_push' };
  const objects = new Map<string, WorkspaceGitPushPatch['objects'][number]>();
  for (const object of patch.objects) {
    if (objects.has(object.sha)) return { applied: false, reason: 'invalid_push' };
    const existing = state.workspaceGitObjects[`${repository.id}:${object.sha}`];
    if (existing && (existing.type !== object.type || existing.content_base64 !== object.content_base64 || existing.size !== object.size)) {
      return { applied: false, reason: 'invalid_push' };
    }
    if (!existing) objects.set(object.sha, object);
  }
  const storedBytes = Object.values(state.workspaceGitObjects)
    .filter((object) => object.repository_id === repository.id)
    .reduce((total, object) => total + object.size, 0);
  const addedBytes = Array.from(objects.values()).reduce((total, object) => total + object.size, 0);
  if (storedBytes + addedBytes > WORKSPACE_GIT_MAX_REPOSITORY_BYTES) return { applied: false, reason: 'repository_limit' };

  for (const object of objects.values()) {
    const id = `${repository.id}:${object.sha}`;
    state.workspaceGitObjects[id] = { id, repository_id: repository.id, ...object };
  }
  state.workspaceGitCommits[patch.commit.sha] ||= patch.commit;
  document.content = patch.document.content;
  document.updated_at = patch.document.updated_at;
  document.updated_by_user_id = patch.document.updated_by_user_id;
  const revisionId = nextStateId(state, 'workspace_revision');
  state.workspaceRevisions[revisionId] = {
    id: revisionId,
    document_id: document.id,
    editor_user_id: patch.document.updated_by_user_id,
    content: document.content,
    created_at: document.updated_at,
  };
  repository.head_commit_sha = patch.commit.sha;
  repository.updated_at = patch.repository_updated_at;
  return { applied: true, head: repository.head_commit_sha };
}

function validWorkspaceGitPushPatch(patch: WorkspaceGitPushPatch): boolean {
  if (!/^[a-zA-Z0-9_-]{1,240}$/.test(patch.repository_id) || !/^[a-zA-Z0-9_-]{1,240}$/.test(patch.credential_id) || !/^[a-zA-Z0-9_-]{1,240}$/.test(patch.user_id)) return false;
  if (patch.expected_head !== null && !/^[a-f0-9]{40}$/.test(patch.expected_head)) return false;
  if (!/^[a-f0-9]{40}$/.test(patch.commit.sha) || !/^[a-f0-9]{40}$/.test(patch.commit.tree_sha) || !/^[a-f0-9]{40}$/.test(patch.commit.blob_sha)) return false;
  if (patch.commit.parent_sha !== null && !/^[a-f0-9]{40}$/.test(patch.commit.parent_sha)) return false;
  if (patch.document.content.length > 200_000 || new TextEncoder().encode(patch.document.content).length > 200_000) return false;
  if (!Number.isInteger(patch.required_email_verification_version) || patch.required_email_verification_version < 0 || patch.required_email_verification_version > 10_000) return false;
  if (patch.objects.length > 1_024) return false;
  return patch.objects.every((object) => /^[a-f0-9]{40}$/.test(object.sha)
    && ['commit', 'tree', 'blob', 'tag'].includes(object.type)
    && Number.isInteger(object.size)
    && object.size >= 0
    && object.size <= WORKSPACE_GIT_MAX_REPOSITORY_BYTES
    && typeof object.content_base64 === 'string');
}

function canUseWorkspaceGit(state: AppState, repositoryId: string, credentialId: string, userId: string, requiredVerificationVersion: number): boolean {
  const repository = state.workspaceGitRepositories[repositoryId];
  const document = repository ? state.workspaceDocuments[repository.document_id] : null;
  const channel = document ? state.channels[document.channel_id] : null;
  const credential = state.workspaceGitCredentials[credentialId];
  const user = state.users[userId];
  const controls = getRuntimeControls(state);
  if (!repository || !document || !channel || !credential || credential.repository_id !== repositoryId || credential.user_id !== userId || credential.scope !== 'write' || credential.revoked_at || (credential.expires_at && new Date(credential.expires_at).getTime() <= Date.now())) return false;
  if (!user || !user.email_verified_at || (user.email_verification_version || 0) < requiredVerificationVersion || controls.maintenance_mode || !controls.workspaces_enabled || !controls.community_tools_enabled) return false;
  if (state.userModerationRecords[userId] && state.userModerationRecords[userId].status !== 'active') return false;
  if (document.visibility === 'private') return document.owner_user_id === userId;
  if (channel.type === 'dm') return !!state.dmParticipants[dmParticipantKey(channel.id, userId)] && !state.dmHiddenStates[dmHiddenKey(channel.id, userId)];
  return !!channel.server_id
    && !!state.serverMembers[memberKey(channel.server_id, userId)]
    && !Object.values(state.serverBans).some((ban) => ban.server_id === channel.server_id && ban.user_id === userId && !ban.unbanned_at);
}

function nextStateId(state: AppState, prefix: string): string {
  const value = (state.counters[prefix] || 0) + 1;
  state.counters[prefix] = value;
  return `${prefix}_${value}`;
}

export async function loadStateForNamespace(env: Env, namespace: string): Promise<AppState> {
  return normalizeState((await loadState(env, namespace)).state);
}

export async function saveStateForNamespace(env: Env, namespace: string, state: AppState): Promise<void> {
  await saveState(env, namespace, normalizeState(state));
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
    emailVerifications: {},
    emailVerificationRateLimits: {},
    refreshTokens: {},
    apiTokens: {},
    stripeSubscriptions: {},
    stripeWebhookEvents: {},
    usageLedgerEntries: {},
    servers: {},
    serverMembers: {},
    serverInvites: {},
    reports: {},
    reportNotes: {},
    reportAudits: {},
    serverModerationActions: {},
    serverWarnings: {},
    serverBans: {},
    serverTimeouts: {},
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
    workspaceGitRepositories: {},
    workspaceGitCommits: {},
    workspaceGitCredentials: {},
    workspaceGitObjects: {},
    communityActivities: {},
    releaseFlags: {},
    releaseAudits: {},
    userModerationRecords: {},
    moderationAudits: {},
    mailInboxItems: {},
    mailDrafts: {},
    realtimeEvents: {},
    uiVariantVotes: {},
    runtimeControls: createDefaultRuntimeControls(),
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

export function createDefaultRuntimeControls(): RuntimeControls {
  return { ...DEFAULT_RUNTIME_CONTROLS };
}

export function getRuntimeControls(state: AppState): RuntimeControls {
  state.runtimeControls = normalizeRuntimeControls(state.runtimeControls);
  return state.runtimeControls;
}

export function normalizeState(state: AppState): AppState {
  state.users ||= {};
  state.emailVerifications ||= {};
  state.emailVerificationRateLimits ||= {};
  state.refreshTokens ||= {};
  state.apiTokens ||= {};
  state.stripeSubscriptions ||= {};
  state.stripeWebhookEvents ||= {};
  state.usageLedgerEntries ||= {};
  state.servers ||= {};
  state.serverMembers ||= {};
  state.serverInvites ||= {};
  state.reports ||= {};
  state.reportNotes ||= {};
  state.reportAudits ||= {};
  state.serverModerationActions ||= {};
  state.serverWarnings ||= {};
  state.serverBans ||= {};
  state.serverTimeouts ||= {};
  state.channels ||= {};
  state.dmParticipants ||= {};
  state.dmHiddenStates ||= {};
  state.messages ||= {};
  state.reactions ||= {};
  state.messageBookmarks ||= {};
  state.mediaObjects ||= {};
  state.channelReadStates ||= {};
  state.webhooks ||= {};
  state.webhookDeliveries ||= {};
  state.workspaceDocuments ||= {};
  state.workspaceRevisions ||= {};
  state.workspaceGitRepositories ||= {};
  state.workspaceGitCommits ||= {};
  state.workspaceGitCredentials ||= {};
  state.workspaceGitObjects ||= {};
  state.communityActivities ||= {};
  state.releaseFlags ||= {};
  state.releaseAudits ||= {};
  state.userModerationRecords ||= {};
  state.moderationAudits ||= {};
  state.mailInboxItems ||= {};
  state.mailDrafts ||= {};
  state.realtimeEvents ||= {};
  state.uiVariantVotes ||= {};
  state.runtimeControls = normalizeRuntimeControls(state.runtimeControls);
  state.counters ||= {};

  for (const user of Object.values(state.users)) {
    normalizeUser(state, user);
  }
  for (const media of Object.values(state.mediaObjects)) {
    media.storage_key ||= media.path.replace(/^\//, '');
    media.scan_status ||= 'skipped';
    media.scan_error ??= null;
    media.scanned_at ??= media.uploaded_at;
    media.scan_download_token_hash ??= null;
    media.scan_download_consumed_at ??= null;
  }
  // Delivery tokens are one-time display secrets. Historical snapshots may
  // carry a compatibility plaintext field, but verification uses token_hash.
  for (const webhook of Object.values(state.webhooks)) {
    delete (webhook as { token_plaintext?: unknown }).token_plaintext;
  }
  for (const token of Object.values(state.apiTokens)) {
    delete (token as { plaintext_token?: unknown }).plaintext_token;
  }
  for (const subscription of Object.values(state.stripeSubscriptions)) {
    subscription.latest_event_created_at ??= null;
  }
  for (const draft of Object.values(state.mailDrafts)) {
    draft.from_name ||= null;
    draft.sent_at ||= null;
    draft.sent_by_user_id ||= null;
    draft.provider_message_id ||= null;
    draft.provider_status ||= null;
    draft.last_error ||= null;
  }
  return state;
}

function normalizeUser(state: AppState, user: UserRecord): void {
  const legacyIsPaid = user.is_paid === true;
  const verification = normalizeEmailVerification(state.emailVerifications[user.id], user);
  state.emailVerifications[user.id] = verification;
  user.email_verified_at = verification.verified_at;
  user.email_verification_version ??= 0;
  user.profile_cosmetics = normalizeProfileCosmetics(user.profile_cosmetics, legacyIsPaid);
  user.premium_entitlement = normalizePremiumEntitlement(user, legacyIsPaid);
  // Keep the historic field consistent for older code paths and exported state.
  user.is_paid = user.premium_entitlement.is_active;
}

function normalizeEmailVerification(record: EmailVerificationRecord | undefined, user: UserRecord): EmailVerificationRecord {
  const verifiedAt = record?.verified_at ?? user.email_verified_at ?? null;
  const status = verifiedAt ? 'verified' : record?.status || 'pending';
  return {
    user_id: user.id,
    status,
    code_hash: record?.code_hash ?? null,
    expires_at: record?.expires_at ?? null,
    failed_attempt_count: record?.failed_attempt_count ?? 0,
    locked_until: record?.locked_until ?? null,
    request_count: record?.request_count ?? 0,
    last_requested_at: record?.last_requested_at ?? null,
    last_sent_at: record?.last_sent_at ?? null,
    last_request_ip_hash: record?.last_request_ip_hash ?? null,
    verified_at: verifiedAt,
    updated_at: record?.updated_at || user.created_at,
  };
}

function normalizeProfileCosmetics(value: ProfileCosmetics | undefined, legacyIsPaid: boolean): ProfileCosmetics {
  return {
    accent_color: value?.accent_color ?? null,
    banner_media_id: value?.banner_media_id ?? null,
    show_premium_badge: value?.show_premium_badge ?? legacyIsPaid,
    supporter_badge: value?.supporter_badge ?? legacyIsPaid,
    personalization: value?.personalization && typeof value.personalization === 'object' ? value.personalization : {},
    updated_at: value?.updated_at ?? null,
  };
}

function normalizePremiumEntitlement(user: UserRecord, legacyIsPaid: boolean): PremiumEntitlementRecord {
  const current = user.premium_entitlement;
  const status = current?.status || (legacyIsPaid ? 'active' : 'inactive');
  const isActive = status === 'active';
  return {
    user_id: user.id,
    tier: current?.tier || (isActive ? 'premium' : 'free'),
    status,
    source: current?.source || (legacyIsPaid ? 'legacy' : 'none'),
    is_active: isActive,
    stripe_customer_id: current?.stripe_customer_id ?? null,
    stripe_subscription_id: current?.stripe_subscription_id ?? null,
    stripe_price_id: current?.stripe_price_id ?? null,
    current_period_end_at: current?.current_period_end_at ?? null,
    cancel_at_period_end: current?.cancel_at_period_end ?? false,
    canceled_at: current?.canceled_at ?? null,
    ai_premium_eligible: current?.ai_premium_eligible ?? isActive,
    early_access_flags: Array.isArray(current?.early_access_flags) ? current.early_access_flags : [],
    granted_at: current?.granted_at ?? (isActive ? user.created_at : null),
    updated_at: current?.updated_at || user.created_at,
  };
}

function normalizeRuntimeControls(value: RuntimeControls | undefined): RuntimeControls {
  const controls = value || createDefaultRuntimeControls();
  return {
    maintenance_mode: controls.maintenance_mode ?? DEFAULT_RUNTIME_CONTROLS.maintenance_mode,
    maintenance_message: controls.maintenance_message ?? DEFAULT_RUNTIME_CONTROLS.maintenance_message,
    registrations_enabled: controls.registrations_enabled ?? DEFAULT_RUNTIME_CONTROLS.registrations_enabled,
    uploads_enabled: controls.uploads_enabled ?? DEFAULT_RUNTIME_CONTROLS.uploads_enabled,
    webhooks_enabled: controls.webhooks_enabled ?? DEFAULT_RUNTIME_CONTROLS.webhooks_enabled,
    workspaces_enabled: controls.workspaces_enabled ?? DEFAULT_RUNTIME_CONTROLS.workspaces_enabled,
    community_tools_enabled: controls.community_tools_enabled ?? DEFAULT_RUNTIME_CONTROLS.community_tools_enabled,
    voice_enabled: controls.voice_enabled ?? DEFAULT_RUNTIME_CONTROLS.voice_enabled,
    ai_enabled: controls.ai_enabled ?? DEFAULT_RUNTIME_CONTROLS.ai_enabled,
    updated_at: controls.updated_at ?? DEFAULT_RUNTIME_CONTROLS.updated_at,
    updated_by_user_id: controls.updated_by_user_id ?? DEFAULT_RUNTIME_CONTROLS.updated_by_user_id,
  };
}
