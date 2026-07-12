import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { getConfig } from '../lib/config';
import { errorResponse, successResponse } from '../lib/responses';
import { issueAccessToken, issueWyvHandoffGrant, readBearerToken, verifyAccessToken } from '../lib/auth';
import type { AuthenticatedUser, Env } from '../lib/types';
import { dmHiddenKey, dmParticipantKey, getRefreshTokenByHash, getRuntimeControls, getUserByEmail, listChannelMessages, listDmParticipants, listMessageReactions, listServerChannels, listServerMembers, listUserDms, listUserServers, loadRepository, loadStateForNamespace, memberKey, readStateKey, reactionKey, saveStateForNamespace } from '../lib/state';
import { decodeWyvHandoffGrant, futureIso, hashPassword, hashToken, isExpired, legalVersions, nowIso, randomToken, requiresLegalReacceptance, sha256, signBridgePayload, verifyBridgeSignature, verifyPassword } from '../lib/security';
import { deleteMediaBytes, encodeMediaBytes, loadMediaBytes, publishQuarantinedMedia, saveMediaObject } from '../lib/media';
import { sendViaSmtp2go } from '../lib/mail';
import { memberRoleRank, type ApiTokenRecord, type ChannelRecord, type CommunityActivityRecord, type EmailVerificationRecord, type MailDraftRecord, type MailInboxItemRecord, type MediaObjectRecord, type MemberRole, type MessageRecord, type ModerationAuditRecord, type PremiumEntitlementRecord, type ReleaseAuditRecord, type ReleaseFlagRecord, type ReportAudit, type ReportRecord, type ReportStatus, type RuntimeControls, type ServerBan, type ServerModerationAction, type ServerRecord, type ServerTimeout, type ServerWarning, type StripeSubscriptionRecord, type TierLimits, type UsageLedgerEntry, type UserModerationRecord, type UserModerationStatus, type UserRecord, type WebhookRecord, type WorkspaceDocumentRecord, type WorkspaceGitCredentialRecord, type WorkspaceGitRepositoryRecord, type WorkspaceRevisionRecord } from '../lib/domain';
import { checkRateLimit } from '../lib/rate-limit';
import { stateDigest, summarizeState, writeStateBackup } from '../lib/backups';
import { authorizeRealtimeChannel, authorizeVoiceParticipation } from '../lib/realtime-access';
import { ensureWorkspaceGitSnapshot, workspaceGitCommits } from '../lib/workspace-git';

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
const workspaceGitCredentialSchema = z.object({ name: z.string().trim().min(1).max(120), scope: z.enum(['read', 'write']).default('write'), expires_in_days: z.number().int().min(1).max(90).default(30) });
const apiTokenCreateSchema = z.object({ name: z.string().min(1).max(120) });
const wyvGrantSchema = z.object({ grant: z.string().min(1) });
const wyvTokenIntrospectSchema = z.object({ token: z.string().min(1) });
const scanResultSchema = z.object({ upload_id: z.string().min(1), verdict: z.enum(['clean', 'infected', 'error']), error: z.string().max(1000).nullish() });
const adminModerationActionSchema = z.object({ reason: z.string().trim().max(1000).nullish() });
const adminProfileRemovalSchema = z.object({
  fields: z.array(z.enum(['display_name', 'bio', 'avatar'])).min(1),
  reason: z.string().trim().max(1000).nullish(),
});
const adminUserQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(['active', 'suspended', 'banned', 'soft_deleted']).optional(),
  directory: z.enum(['on', 'off']).optional(),
  avatar: z.enum(['yes', 'no']).optional(),
  created_from: z.string().optional(),
  created_to: z.string().optional(),
});
const adminMailStatusSchema = z.object({ status: z.enum(['new', 'open', 'pending', 'closed', 'spam']) });
const adminMailTagsSchema = z.object({ tags: z.array(z.string().trim().min(1).max(64)).max(16) });
const adminMailAssignSchema = z.object({ assigned_to_user_id: z.string().trim().nullable() });
const adminMailDraftSchema = z.object({
  from_address: z.string().trim().email().nullable().optional(),
  from_name: z.string().trim().max(255).nullable().optional(),
  subject: z.string().trim().max(255).nullable().optional(),
  body: z.string().max(20000).nullable().optional(),
  note: z.string().max(5000).nullable().optional(),
});
const adminMailSendSchema = z.object({
  from_address: z.string().trim().email().nullable().optional(),
  from_name: z.string().trim().max(255).nullable().optional(),
  subject: z.string().trim().max(255).nullable().optional(),
  body: z.string().max(20000).nullable().optional(),
  close_after_send: z.boolean().default(true),
});
const inboundMailSchema = z.object({
  from_address: z.string().trim().email(),
  from_name: z.string().trim().max(255).nullable().optional(),
  to_address: z.string().trim().email(),
  subject: z.string().trim().max(255).nullable().optional(),
  text_body: z.string().max(200000).nullable().optional(),
  html_body: z.string().max(200000).nullable().optional(),
  received_at: z.string().trim().optional(),
  source_message_id: z.string().trim().max(512).nullable().optional(),
  thread_key: z.string().trim().max(512).nullable().optional(),
  headers: z.record(z.string()).optional(),
  attachments: z.array(z.object({
    filename: z.string().trim().max(255),
    content_type: z.string().trim().max(255).nullable().optional(),
    size: z.number().int().nonnegative().nullable().optional(),
    url: z.string().trim().max(2048).nullable().optional(),
  })).max(32).optional(),
});
const namespaceMigrationSchema = z.object({
  source: z.string().min(1).default('development'),
  target: z.string().min(1).default('production'),
  dry_run: z.boolean().default(true),
  overwrite: z.boolean().default(false),
  expected_source_digest: z.string().optional(),
});
const verificationConfirmSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Verification code must contain six digits'),
});
const billingReturnSchema = z.object({
  return_url: z.string().url().max(2048).optional(),
});
const reportCreateSchema = z.object({
  target_type: z.enum(['message', 'profile']),
  target_id: z.string().trim().min(1).max(255),
  reason: z.enum(['spam', 'harassment', 'hate_or_abuse', 'sexual_content', 'violence_or_threat', 'self_harm', 'illegal_content', 'impersonation', 'privacy', 'other']),
  details: z.string().trim().max(4000).nullish(),
});
const reportUpdateSchema = z.object({
  status: z.enum(['open', 'in_review', 'actioned', 'dismissed']).optional(),
  assigned_to_user_id: z.string().trim().max(255).nullable().optional(),
  resolution_reason: z.string().trim().max(4000).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one report update is required');
const reportNoteSchema = z.object({ body: z.string().trim().min(1).max(4000) });
const serverModerationTargetSchema = z.object({
  user_id: z.string().trim().min(1).max(255),
  reason: z.string().trim().min(1).max(1000),
});
const serverTimeoutSchema = serverModerationTargetSchema.extend({
  expires_at: z.string().datetime({ offset: true }),
});
const serverModerationMessageSchema = z.object({ reason: z.string().trim().min(1).max(1000) });
const runtimeControlsSchema = z.object({
  maintenance_mode: z.boolean().optional(),
  maintenance_message: z.string().trim().max(1000).nullable().optional(),
  registrations_enabled: z.boolean().optional(),
  uploads_enabled: z.boolean().optional(),
  webhooks_enabled: z.boolean().optional(),
  workspaces_enabled: z.boolean().optional(),
  community_tools_enabled: z.boolean().optional(),
  voice_enabled: z.boolean().optional(),
  ai_enabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one runtime control is required');

type AppContext = Context<{ Bindings: Env }>;
type ShimRealtimeSession = {
  id: string;
  socket: WebSocket;
  user: AuthenticatedUser;
  channelIds: Set<string>;
  connectedAt: string;
};
type ShimRealtimeState = {
  nextSocketId: number;
  sessions: Map<WebSocket, ShimRealtimeSession>;
};
const testPresence = new Map<string, string>();
const shimRealtimeState = new WeakMap<Env, ShimRealtimeState>();
const LEGAL_CONTACT_EMAIL = 'legal@wyvernhub.net';
const SUPPORT_CONTACT_EMAIL = 'support@wyvernhub.net';
const OPERATOR_NAME = 'Wyvern Team';
function clientRateKey(c: AppContext): string {
  return `ip:${(c.req.header('CF-Connecting-IP') || c.req.header('x-forwarded-for')?.split(',')[0] || 'unknown').trim()}`;
}

async function enforceRateLimit(c: AppContext, prefix: string, actor: string, limit: number, windowSeconds: number): Promise<Response | null> {
  const result = await checkRateLimit(c.env, prefix, actor, limit, windowSeconds);
  if (result.success) return null;
  const response = errorResponse('RATE_LIMITED', `Rate limit exceeded for ${prefix}`, 429, {
    limit,
    window_seconds: windowSeconds,
    retry_after: result.retry_after,
  });
  response.headers.set('Retry-After', String(result.retry_after));
  return response;
}

type RepositoryState = Awaited<ReturnType<typeof loadRepository>>['state'];
type RepositoryHandle = Awaited<ReturnType<typeof loadRepository>>;

const verificationCodeEncoder = new TextEncoder();
const PREMIUM_ACTIVE_STATUSES = new Set(['active', 'trialing']);

function resolvedRuntimeControls(repo: RepositoryHandle, env: Env): RuntimeControls {
  const stored = getRuntimeControls(repo.state);
  // A fresh namespace contains built-in safe defaults. Allow deployment vars to
  // seed that first state, then let a recorded admin update be authoritative.
  return stored.updated_at ? stored : { ...getConfig(env).runtimeControlDefaults };
}

function isRuntimeFeatureEnabled(repo: RepositoryHandle, env: Env, feature: keyof Pick<RuntimeControls, 'uploads_enabled' | 'webhooks_enabled' | 'workspaces_enabled' | 'community_tools_enabled' | 'voice_enabled' | 'ai_enabled'>): boolean {
  return resolvedRuntimeControls(repo, env)[feature];
}

function featureDisabledResponse(feature: string): Response {
  return errorResponse('FEATURE_DISABLED', `${feature} is temporarily unavailable`, 503, { feature });
}

function isEmailVerified(env: Env, user: UserRecord): boolean {
  return !!user.email_verified_at && (user.email_verification_version || 0) >= getConfig(env).emailVerificationRequiredVersion;
}

function requiresEmailReverificationOnLogin(env: Env, user: UserRecord): boolean {
  return !!user.email_verified_at && !isEmailVerified(env, user);
}

function resetEmailVerificationForReauthentication(repo: RepositoryHandle, user: UserRecord): void {
  const updatedAt = nowIso();
  user.email_verified_at = null;
  repo.state.emailVerifications[user.id] = {
    user_id: user.id,
    status: 'pending',
    code_hash: null,
    expires_at: null,
    failed_attempt_count: 0,
    locked_until: null,
    request_count: 0,
    last_requested_at: null,
    last_sent_at: null,
    last_request_ip_hash: null,
    verified_at: null,
    updated_at: updatedAt,
  };
}

function isPremiumUser(user: UserRecord): boolean {
  const entitlement = user.premium_entitlement;
  if (!entitlement) return user.is_paid === true;
  if (!entitlement.is_active || entitlement.tier !== 'premium') return false;
  if (entitlement.cancel_at_period_end && entitlement.current_period_end_at && new Date(entitlement.current_period_end_at).getTime() <= Date.now()) return false;
  if (entitlement.current_period_end_at && new Date(entitlement.current_period_end_at).getTime() <= Date.now() && entitlement.status !== 'active') return false;
  return true;
}

function hasPremiumAccess(env: Env, user: UserRecord): boolean {
  return getConfig(env).universalPremiumAccess || isPremiumUser(user);
}

function effectiveEntitlement(env: Env, user: UserRecord): PremiumEntitlementRecord {
  if (!getConfig(env).universalPremiumAccess) {
    return user.premium_entitlement || applyStripeEntitlement(user, null);
  }
  const current = user.premium_entitlement;
  return {
    user_id: user.id,
    tier: 'premium',
    status: 'active',
    source: 'manual',
    is_active: true,
    stripe_customer_id: current?.stripe_customer_id || null,
    stripe_subscription_id: current?.stripe_subscription_id || null,
    stripe_price_id: current?.stripe_price_id || null,
    current_period_end_at: null,
    cancel_at_period_end: false,
    canceled_at: null,
    ai_premium_eligible: true,
    early_access_flags: ['premium_early_access'],
    granted_at: current?.granted_at || user.created_at,
    updated_at: nowIso(),
  };
}

function limitsForUser(env: Env, user: UserRecord): TierLimits {
  const config = getConfig(env);
  return hasPremiumAccess(env, user) ? config.premiumTierLimits : config.freeTierLimits;
}

function storageBytesForUser(state: RepositoryState, userId: string): number {
  return Object.values(state.mediaObjects)
    .filter((item) => item.owner_user_id === userId && item.scan_status !== 'infected')
    .reduce((total, item) => total + item.size, 0);
}

function uploadsTodayForUser(state: RepositoryState, userId: string): number {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const boundary = dayStart.getTime();
  return Object.values(state.mediaObjects)
    .filter((item) => item.owner_user_id === userId && new Date(item.uploaded_at).getTime() >= boundary)
    .length;
}

function activeServerBan(state: RepositoryState, serverId: string, userId: string): ServerBan | undefined {
  return Object.values(state.serverBans).find((item) => item.server_id === serverId && item.user_id === userId && !item.unbanned_at);
}

function activeServerTimeout(state: RepositoryState, serverId: string, userId: string): ServerTimeout | undefined {
  const now = Date.now();
  return Object.values(state.serverTimeouts).find((item) => item.server_id === serverId && item.user_id === userId && !item.revoked_at && new Date(item.expires_at).getTime() > now);
}

function activeTimeoutForUser(state: RepositoryState, userId: string): ServerTimeout | undefined {
  const now = Date.now();
  return Object.values(state.serverTimeouts).find((item) => item.user_id === userId && !item.revoked_at && new Date(item.expires_at).getTime() > now);
}

function activeMember(state: RepositoryState, serverId: string, userId: string) {
  if (activeServerBan(state, serverId, userId)) return null;
  return state.serverMembers[memberKey(serverId, userId)] || null;
}

function canModerateServer(state: RepositoryState, serverId: string, userId: string): boolean {
  const member = activeMember(state, serverId, userId);
  return !!member && ['owner', 'admin', 'moderator'].includes(member.role);
}

function canManageServerSettings(state: RepositoryState, serverId: string, userId: string): boolean {
  const member = activeMember(state, serverId, userId);
  return !!member && ['owner', 'admin'].includes(member.role);
}

function canActOnServerMember(state: RepositoryState, serverId: string, actorUserId: string, targetUserId: string): boolean {
  if (actorUserId === targetUserId) return false;
  const actor = activeMember(state, serverId, actorUserId);
  const target = activeMember(state, serverId, targetUserId);
  if (!actor || !target || !['owner', 'admin', 'moderator'].includes(actor.role)) return false;
  return memberRoleRank(actor.role) > memberRoleRank(target.role);
}

function recordedTargetRole(state: RepositoryState, serverId: string, targetUserId: string): MemberRole | null {
  const active = activeMember(state, serverId, targetUserId);
  if (active) return active.role;
  if (state.servers[serverId]?.owner_id === targetUserId) return 'owner';
  const historical = Object.values(state.serverModerationActions)
    .filter((action) => action.server_id === serverId && action.target_user_id === targetUserId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
  const role = historical?.action_metadata?.target_role;
  return role === 'owner' || role === 'admin' || role === 'moderator' || role === 'member' ? role : null;
}

function canActOnFormerServerMember(state: RepositoryState, serverId: string, actorUserId: string, targetUserId: string, targetRole: MemberRole | null = null): boolean {
  if (actorUserId === targetUserId) return false;
  const actor = activeMember(state, serverId, actorUserId);
  if (!actor || !['owner', 'admin', 'moderator'].includes(actor.role)) return false;
  const role = targetRole || recordedTargetRole(state, serverId, targetUserId);
  // A moderator must never act on a departed account whose former hierarchy
  // cannot be proven. Owners and admins can handle orphaned local records.
  if (!role) return actor.role === 'owner' || actor.role === 'admin';
  return memberRoleRank(actor.role) > memberRoleRank(role);
}

function recordUsage(repo: RepositoryHandle, userId: string, kind: UsageLedgerEntry['kind'], quantity: number, options: Partial<Pick<UsageLedgerEntry, 'server_id' | 'resource_id' | 'period_start_at' | 'period_end_at' | 'usage_metadata'>> = {}): UsageLedgerEntry {
  const entry: UsageLedgerEntry = {
    id: repo.nextId('usage'),
    user_id: userId,
    kind,
    quantity,
    server_id: options.server_id ?? null,
    resource_id: options.resource_id ?? null,
    period_start_at: options.period_start_at ?? null,
    period_end_at: options.period_end_at ?? null,
    usage_metadata: options.usage_metadata ?? null,
    created_at: nowIso(),
  };
  repo.state.usageLedgerEntries[entry.id] = entry;
  return entry;
}

function reportCanBeReviewedBy(state: RepositoryState, report: ReportRecord, userId: string, env: Env): boolean {
  if (report.scope === 'server' && report.server_id) {
    return canActOnFormerServerMember(state, report.server_id, userId, report.reported_user_id, report.reported_member_role || null);
  }
  const user = state.users[userId];
  return !!user && isAdmin(user, env);
}

function addReportAudit(repo: RepositoryHandle, reportId: string, actorUserId: string | null, action: string, details: Record<string, unknown> | null = null): ReportAudit {
  const audit: ReportAudit = {
    id: repo.nextId('report_audit'),
    report_id: reportId,
    actor_user_id: actorUserId,
    action,
    details,
    created_at: nowIso(),
  };
  repo.state.reportAudits[audit.id] = audit;
  return audit;
}

function addServerModerationAction(repo: RepositoryHandle, input: Omit<ServerModerationAction, 'id' | 'created_at'>): ServerModerationAction {
  const actorRole = input.actor_user_id ? activeMember(repo.state, input.server_id, input.actor_user_id)?.role || null : null;
  const targetRole = input.target_user_id ? recordedTargetRole(repo.state, input.server_id, input.target_user_id) : null;
  const actionMetadata = {
    ...(input.action_metadata || {}),
    actor_role: actorRole,
    target_role: targetRole,
  };
  const action: ServerModerationAction = {
    id: repo.nextId('server_moderation_action'),
    ...input,
    action_metadata: actionMetadata,
    created_at: nowIso(),
  };
  repo.state.serverModerationActions[action.id] = action;
  return action;
}

function verificationCodeHash(userId: string, code: string): Promise<string> {
  return sha256(`wyvern-email-verification:${userId}:${code}`);
}

function generateVerificationCode(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 1_000_000).padStart(6, '0');
}

async function consumeEmailVerificationRateLimit(repo: RepositoryHandle, env: Env, userId: string, ipKey: string): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> {
  const config = getConfig(env);
  const now = Date.now();
  const windowMs = config.emailVerificationRateLimitWindowMinutes * 60_000;
  const subjects: Array<{ key: string; scope: 'user' | 'ip'; subject: string }> = [
    { key: `verification:user:${userId}`, scope: 'user', subject: userId },
    { key: `verification:ip:${await sha256(ipKey)}`, scope: 'ip', subject: await sha256(ipKey) },
  ];
  const records = subjects.map((subject) => {
    const existing = repo.state.emailVerificationRateLimits[subject.key];
    const windowStarted = existing ? new Date(existing.window_started_at).getTime() : 0;
    const outsideWindow = !existing || !Number.isFinite(windowStarted) || now - windowStarted >= windowMs;
    return {
      subject,
      record: outsideWindow || !existing
        ? {
            key: subject.key,
            scope: subject.scope,
            subject_hash: subject.subject,
            window_started_at: new Date(now).toISOString(),
            request_count: 0,
            blocked_until: null,
            updated_at: new Date(now).toISOString(),
          }
        : existing,
    };
  });
  const blocked = records.find(({ record }) => record.blocked_until && new Date(record.blocked_until).getTime() > now || record.request_count >= config.emailVerificationRequestLimit);
  if (blocked) {
    const retryAt = blocked.record.blocked_until
      ? new Date(blocked.record.blocked_until).getTime()
      : new Date(blocked.record.window_started_at).getTime() + windowMs;
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((retryAt - now) / 1000)) };
  }
  for (const { subject, record } of records) {
    record.request_count += 1;
    record.updated_at = new Date(now).toISOString();
    repo.state.emailVerificationRateLimits[subject.key] = record;
  }
  return { allowed: true };
}

function unixSecondsToIso(value: unknown): string | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(numeric) && numeric > 0 ? new Date(numeric * 1000).toISOString() : null;
}

function secureHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', verificationCodeEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, verificationCodeEncoder.encode(payload));
  return Array.from(new Uint8Array(signature)).map((item) => item.toString(16).padStart(2, '0')).join('');
}

async function verifyStripeSignature(secret: string, rawBody: string, header: string | null): Promise<void> {
  if (!header) throw new Error('Missing Stripe-Signature header');
  const fields = header.split(',').map((item) => item.split('=', 2));
  const timestamp = fields.find(([key]) => key === 't')?.[1];
  const signatures = fields.filter(([key]) => key === 'v1').map(([, value]) => value || '');
  const numericTimestamp = Number(timestamp);
  if (!timestamp || !Number.isFinite(numericTimestamp) || Math.abs(Math.floor(Date.now() / 1000) - numericTimestamp) > 300) {
    throw new Error('Expired or invalid Stripe signature');
  }
  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  if (!signatures.some((candidate) => secureHexEqual(expected, candidate))) throw new Error('Invalid Stripe signature');
}

function safeStripeReturnUrl(requestUrl: string, requestedUrl: string | undefined, configuredUrl: string | null, fallbackPath: string): string {
  const requestOrigin = new URL(requestUrl).origin;
  if (requestedUrl) {
    const parsed = new URL(requestedUrl);
    if (parsed.origin !== requestOrigin) throw new Error('Return URL must use this Wyvern origin');
    return parsed.toString();
  }
  if (configuredUrl) return configuredUrl;
  return new URL(fallbackPath, requestOrigin).toString();
}

async function stripeFormRequest(env: Env, path: string, form: URLSearchParams): Promise<Record<string, unknown>> {
  const secret = getConfig(env).stripeSecretKey;
  if (!secret) throw new Error('Stripe is not configured');
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = payload && typeof payload.error === 'object' && payload.error && 'message' in payload.error
      ? String((payload.error as { message?: unknown }).message || '')
      : '';
    throw new Error(message || `Stripe request failed with ${response.status}`);
  }
  return payload || {};
}

function stripeObjectId(value: unknown): string | null {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && 'id' in value && typeof (value as { id?: unknown }).id === 'string') return String((value as { id: string }).id);
  return null;
}

function findStripeSubscriptionForUser(state: RepositoryState, userId: string): StripeSubscriptionRecord | undefined {
  return Object.values(state.stripeSubscriptions)
    .filter((item) => item.user_id === userId)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
}

function applyStripeEntitlement(user: UserRecord, subscription: StripeSubscriptionRecord | null): PremiumEntitlementRecord {
  const now = nowIso();
  const periodEnded = !!subscription?.current_period_end_at && new Date(subscription.current_period_end_at).getTime() <= Date.now();
  const active = !!subscription && PREMIUM_ACTIVE_STATUSES.has(subscription.status) && !subscription.ended_at && !(subscription.cancel_at_period_end && periodEnded);
  const existing = user.premium_entitlement;
  const entitlement: PremiumEntitlementRecord = {
    user_id: user.id,
    tier: active ? 'premium' : 'free',
    status: active ? 'active' : subscription?.status === 'past_due' || subscription?.status === 'unpaid' ? 'past_due' : subscription?.status === 'canceled' ? 'canceled' : 'inactive',
    source: subscription ? 'stripe' : existing?.source || 'none',
    is_active: active,
    stripe_customer_id: subscription?.stripe_customer_id || existing?.stripe_customer_id || null,
    stripe_subscription_id: subscription?.id || existing?.stripe_subscription_id || null,
    stripe_price_id: subscription?.stripe_price_id || existing?.stripe_price_id || null,
    current_period_end_at: subscription?.current_period_end_at || existing?.current_period_end_at || null,
    cancel_at_period_end: subscription?.cancel_at_period_end || false,
    canceled_at: subscription?.canceled_at || null,
    ai_premium_eligible: active,
    early_access_flags: active ? ['premium_early_access'] : [],
    granted_at: active ? existing?.granted_at || now : null,
    updated_at: now,
  };
  user.premium_entitlement = entitlement;
  user.is_paid = entitlement.is_active;
  return entitlement;
}

function userIdFromStripeObject(object: Record<string, unknown>, state: RepositoryState): string | null {
  const metadata = object.metadata;
  if (metadata && typeof metadata === 'object') {
    const candidate = (metadata as Record<string, unknown>).wyvern_user_id;
    if (typeof candidate === 'string' && state.users[candidate]) return candidate;
  }
  const subscriptionId = stripeObjectId(object.id);
  const customerId = stripeObjectId(object.customer);
  const existing = Object.values(state.stripeSubscriptions).find((item) => item.id === subscriptionId || (customerId && item.stripe_customer_id === customerId));
  return existing?.user_id || null;
}

function upsertStripeSubscription(repo: RepositoryHandle, env: Env, object: Record<string, unknown>, userId: string, eventCreatedAt: string | null): StripeSubscriptionRecord | null {
  const id = stripeObjectId(object.id);
  const customerId = stripeObjectId(object.customer);
  if (!id || !customerId) return null;
  const items = object.items;
  const data = items && typeof items === 'object' && Array.isArray((items as { data?: unknown }).data) ? (items as { data: unknown[] }).data : [];
  const firstItem = data[0] as { price?: unknown } | undefined;
  const price = firstItem?.price;
  const configuredPriceId = getConfig(env).stripePriceId;
  const priceId = stripeObjectId(price);
  if (!configuredPriceId || !priceId || priceId !== configuredPriceId) return null;
  const existing = repo.state.stripeSubscriptions[id];
  if (existing?.latest_event_created_at && eventCreatedAt && eventCreatedAt <= existing.latest_event_created_at) return existing;
  const createdAt = existing?.created_at || nowIso();
  const status = String(object.status || existing?.status || 'incomplete') as StripeSubscriptionRecord['status'];
  const subscription: StripeSubscriptionRecord = {
    id,
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_price_id: priceId,
    status,
    current_period_start_at: unixSecondsToIso(object.current_period_start) || existing?.current_period_start_at || null,
    current_period_end_at: unixSecondsToIso(object.current_period_end) || existing?.current_period_end_at || null,
    cancel_at_period_end: object.cancel_at_period_end === true,
    canceled_at: unixSecondsToIso(object.canceled_at) || (status === 'canceled' ? nowIso() : null),
    ended_at: unixSecondsToIso(object.ended_at) || null,
    trial_ends_at: unixSecondsToIso(object.trial_end) || null,
    latest_event_id: existing?.latest_event_id || null,
    latest_event_created_at: eventCreatedAt || existing?.latest_event_created_at || null,
    created_at: createdAt,
    updated_at: nowIso(),
  };
  repo.state.stripeSubscriptions[id] = subscription;
  return subscription;
}

function defaultModerationRecord(userId: string): UserModerationRecord {
  return {
    user_id: userId,
    status: 'active',
    reason: null,
    updated_at: '',
    updated_by_user_id: null,
    suspended_at: null,
    banned_at: null,
    soft_deleted_at: null,
    restored_at: null,
    redacted_display_name: false,
    redacted_bio: false,
    redacted_avatar: false,
  };
}

function getModerationRecord(state: RepositoryState, userId: string): UserModerationRecord {
  return state.userModerationRecords[userId] || defaultModerationRecord(userId);
}

function ensureModerationRecord(repo: RepositoryHandle, userId: string): UserModerationRecord {
  repo.state.userModerationRecords[userId] ||= defaultModerationRecord(userId);
  return repo.state.userModerationRecords[userId];
}

function isBlockedModerationStatus(status: UserModerationStatus): boolean {
  return status === 'suspended' || status === 'banned' || status === 'soft_deleted';
}

function moderationMessage(status: UserModerationStatus): string {
  switch (status) {
    case 'suspended':
      return 'This account is suspended';
    case 'banned':
      return 'This account is banned';
    case 'soft_deleted':
      return 'This account has been deleted';
    default:
      return 'This account is unavailable';
  }
}

function getEffectiveDisplayName(user: UserRecord): string {
  return user.display_name?.trim() || user.username;
}

function serializeModerationRecord(record: UserModerationRecord) {
  return {
    user_id: record.user_id,
    status: record.status,
    reason: record.reason,
    updated_at: record.updated_at || null,
    updated_by_user_id: record.updated_by_user_id,
    suspended_at: record.suspended_at,
    banned_at: record.banned_at,
    soft_deleted_at: record.soft_deleted_at,
    restored_at: record.restored_at,
    redactions: {
      display_name: record.redacted_display_name,
      bio: record.redacted_bio,
      avatar: record.redacted_avatar,
    },
  };
}

function makeTombstoneUser(user: UserRecord) {
  return {
    id: user.id,
    username: 'deleted-user',
    discriminator: '0000',
    display_name: 'Deleted User',
    bio: null,
    directory_opt_in: false,
    email: null,
    avatar: null,
    is_paid: false,
    created_at: user.created_at,
    deleted: true,
  };
}

function sanitizeUserForPublic(state: RepositoryState, user: UserRecord) {
  const moderation = getModerationRecord(state, user.id);
  if (moderation.status === 'soft_deleted') return makeTombstoneUser(user);
  return {
    id: user.id,
    username: user.username,
    discriminator: user.discriminator,
    display_name: moderation.redacted_display_name ? null : user.display_name,
    bio: moderation.redacted_bio ? null : user.bio,
    directory_opt_in: user.directory_opt_in,
    email: user.email,
    avatar: moderation.redacted_avatar ? null : user.avatar,
    is_paid: user.is_paid,
    created_at: user.created_at,
    moderation_status: moderation.status,
    redactions: {
      display_name: moderation.redacted_display_name,
      bio: moderation.redacted_bio,
      avatar: moderation.redacted_avatar,
    },
  };
}

function revokeUserRefreshTokens(state: RepositoryState, userId: string) {
  for (const token of Object.values(state.refreshTokens)) {
    if (token.user_id === userId) token.is_revoked = true;
  }
}

function addModerationAudit(
  repo: RepositoryHandle,
  userId: string,
  actorUserId: string | null,
  action: string,
  reason: string | null,
  details: Record<string, unknown> | null = null,
) {
  const audit: ModerationAuditRecord = {
    id: repo.nextId('moderation_audit'),
    user_id: userId,
    actor_user_id: actorUserId,
    action,
    reason,
    details,
    created_at: nowIso(),
  };
  repo.state.moderationAudits[audit.id] = audit;
  return audit;
}

function listUserModerationHistory(state: RepositoryState, userId: string): ModerationAuditRecord[] {
  return Object.values(state.moderationAudits)
    .filter((item) => item.user_id === userId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

function listUserMedia(state: RepositoryState, userId: string): MediaObjectRecord[] {
  return Object.values(state.mediaObjects)
    .filter((item) => item.owner_user_id === userId)
    .sort((left, right) => right.uploaded_at.localeCompare(left.uploaded_at));
}

async function revokeProfileAvatar(repo: RepositoryHandle, env: Env, user: UserRecord) {
  const currentAvatar = user.avatar;
  user.avatar = null;
  if (!currentAvatar) return null;
  const media = Object.values(repo.state.mediaObjects).find((item) => item.path === currentAvatar || `/media/${item.owner_user_id}/${item.id}` === currentAvatar);
  if (!media) return null;
  await deleteMediaBytes(env, media);
  delete repo.state.mediaObjects[media.id];
  return media;
}

async function requireAdminRepo(c: AppContext): Promise<Response | { auth: AuthenticatedUser; repo: RepositoryHandle; user: UserRecord }> {
  const auth = await requireUser(c);
  if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
  const repo = await loadRepository(c.env);
  const user = repo.state.users[auth.user_id];
  if (!user || !isAdmin(user, c.env)) return errorResponse('FORBIDDEN', 'Admin access required', 403);
  return { auth, repo, user };
}

async function requireVerifiedUser(c: AppContext): Promise<Response | { auth: AuthenticatedUser; repo: RepositoryHandle; user: UserRecord }> {
  const auth = await requireUser(c);
  if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
  const repo = await loadRepository(c.env);
  const user = repo.state.users[auth.user_id];
  if (!user) return errorResponse('NOT_FOUND', 'User not found', 404);
  if (!isEmailVerified(c.env, user)) {
    return errorResponse('EMAIL_VERIFICATION_REQUIRED', 'Verify your email before using this feature', 403, {
      verification_required: true,
    });
  }
  return { auth, repo, user };
}

function applyUserModerationState(record: UserModerationRecord, status: UserModerationStatus, actorUserId: string, reason: string | null) {
  const now = nowIso();
  record.status = status;
  record.reason = reason;
  record.updated_at = now;
  record.updated_by_user_id = actorUserId;
  if (status === 'suspended') record.suspended_at = now;
  if (status === 'banned') record.banned_at = now;
  if (status === 'soft_deleted') record.soft_deleted_at = now;
  if (status === 'active') record.restored_at = now;
}

function adminUserMatchesFilters(user: UserRecord, moderation: UserModerationRecord, query: z.infer<typeof adminUserQuerySchema>) {
  const search = query.q?.toLowerCase();
  if (search) {
    const haystack = [user.id, user.username, user.display_name || '', user.email, `${user.username}#${user.discriminator}`].join(' ').toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  if (query.status && moderation.status !== query.status) return false;
  if (query.directory && user.directory_opt_in !== (query.directory === 'on')) return false;
  if (query.avatar && (!!user.avatar) !== (query.avatar === 'yes')) return false;
  if (query.created_from && user.created_at < query.created_from) return false;
  if (query.created_to && user.created_at > `${query.created_to}T23:59:59.999Z`) return false;
  return true;
}

function buildAdminUserSummary(state: RepositoryState, user: UserRecord) {
  const moderation = getModerationRecord(state, user.id);
  const memberships = Object.values(state.serverMembers).filter((item) => item.user_id === user.id);
  const dmCount = Object.values(state.dmParticipants).filter((item) => item.user_id === user.id).length;
  const messages = Object.values(state.messages).filter((item) => item.author_id === user.id);
  const recentMessageAt = messages.reduce<string | null>((latest, message) => !latest || message.created_at > latest ? message.created_at : latest, null);
  return {
    ...serializeAdminUser(user, state),
    moderation: serializeModerationRecord(moderation),
    server_membership_count: memberships.length,
    dm_count: dmCount,
    message_count: messages.length,
    recent_message_at: recentMessageAt,
  };
}

function buildUserDetail(state: RepositoryState, user: UserRecord) {
  const moderation = getModerationRecord(state, user.id);
  const memberships = Object.values(state.serverMembers).filter((item) => item.user_id === user.id);
  const messages = Object.values(state.messages)
    .filter((item) => item.author_id === user.id)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
  return {
    profile: serializeAdminUser(user, state),
    moderation: serializeModerationRecord(moderation),
    memberships: memberships.map((membership) => {
      const server = state.servers[membership.server_id];
      return {
        ...membership,
        server_name: server?.name || 'Unknown server',
      };
    }),
    counts: {
      servers: memberships.length,
      dms: Object.values(state.dmParticipants).filter((item) => item.user_id === user.id).length,
      messages: messages.length,
      uploads: listUserMedia(state, user.id).length,
    },
    recent_activity: {
      last_message_at: messages[0]?.created_at || null,
      messages: messages.slice(0, 10).map((message) => ({
        id: message.id,
        channel_id: message.channel_id,
        content: message.content,
        created_at: message.created_at,
      })),
    },
    moderation_history: listUserModerationHistory(state, user.id),
    media: listUserMedia(state, user.id).map((media) => serializeUpload(media)),
  };
}

function sortInboxItems(items: MailInboxItemRecord[]) {
  return items.sort((left, right) => right.received_at.localeCompare(left.received_at));
}

function buildReplySubject(item: MailInboxItemRecord, draftSubject?: string | null) {
  const candidate = (draftSubject || item.subject || '').trim();
  if (!candidate) return 'Re: your message to Wyvern';
  return /^re:/i.test(candidate) ? candidate : `Re: ${candidate}`;
}

function serializeMailDraft(draft: MailDraftRecord | null) {
  if (!draft) return null;
  return { ...draft };
}

function serializeMailInboxItem(state: RepositoryState, item: MailInboxItemRecord) {
  const assignee = item.assigned_to_user_id ? state.users[item.assigned_to_user_id] || null : null;
  const draft = Object.values(state.mailDrafts).find((entry) => entry.inbox_item_id === item.id) || null;
  return {
    ...item,
    assignee: assignee ? serializeAdminUser(assignee, state) : null,
    draft: serializeMailDraft(draft),
  };
}

function serializeReport(state: RepositoryState, report: ReportRecord, includeStaffContext = false) {
  const reported = state.users[report.reported_user_id];
  const reporter = state.users[report.reporter_user_id];
  const notes = Object.values(state.reportNotes)
    .filter((item) => item.report_id === report.id)
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  const audits = Object.values(state.reportAudits)
    .filter((item) => item.report_id === report.id)
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  return {
    ...report,
    reported_user: reported ? serializePublicUser(reported, state) : null,
    ...(includeStaffContext ? {
      reporter: reporter ? serializePublicUser(reporter, state) : null,
      notes,
      audits,
    } : {}),
  };
}

function serializeServerModerationAction(state: RepositoryState, action: ServerModerationAction) {
  const actor = action.actor_user_id ? state.users[action.actor_user_id] : null;
  const target = action.target_user_id ? state.users[action.target_user_id] : null;
  return {
    ...action,
    actor: actor ? serializePublicUser(actor, state) : null,
    target: target ? serializePublicUser(target, state) : null,
  };
}

async function emitRealtime(env: Env, type: string, payload: Record<string, unknown>, channelId: string | null = null) {
  if (env.__REALTIME_TEST__) {
    env.__REALTIME_TEST__.events.push({ type, payload, channel_id: channelId });
  }
  if (!env.REALTIME_HUB && env.__REALTIME_TEST__) {
    const targetUserId = type === 'call.signal' ? String(payload.target_user_id || '') || null : null;
    broadcastShimRealtime(env, type, payload, channelId, targetUserId);
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
    return testRealtimeUpgrade(c.env, auth);
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

function getShimRealtimeState(env: Env): ShimRealtimeState {
  let state = shimRealtimeState.get(env);
  if (!state) {
    state = {
      nextSocketId: 1,
      sessions: new Map(),
    };
    shimRealtimeState.set(env, state);
  }
  return state;
}

export function resetShimRealtimeState(env: Env) {
  const state = shimRealtimeState.get(env);
  if (!state) return;
  for (const socket of state.sessions.keys()) {
    try {
      socket.close(1000, 'test reset');
    } catch {}
  }
  state.sessions.clear();
  shimRealtimeState.delete(env);
}

function syncShimSnapshotState(env: Env) {
  if (!env.__REALTIME_TEST__) {
    env.__REALTIME_TEST__ = { events: [], sockets: 0, subscriptions: {}, typingUsers: {}, voiceParticipants: {}, messages: [] };
  }
  const state = getShimRealtimeState(env);
  env.__REALTIME_TEST__.sockets = state.sessions.size;
  env.__REALTIME_TEST__.subscriptions = Object.fromEntries(
    Array.from(state.sessions.values()).map((session) => [session.id, Array.from(session.channelIds)])
  );
}

function pruneUserFromChannelMap(map: Record<string, string[]>, userId: string) {
  for (const [channelId, users] of Object.entries(map)) {
    const nextUsers = (users || []).filter((candidate) => candidate !== userId);
    if (nextUsers.length) map[channelId] = nextUsers;
    else delete map[channelId];
  }
}

function broadcastShimRealtime(env: Env, type: string, payload: Record<string, unknown>, channelId: string | null, targetUserId: string | null = null) {
  const state = getShimRealtimeState(env);
  const encoded = JSON.stringify({ event: type, channel_id: channelId, data: payload });
  for (const [socket, session] of Array.from(state.sessions.entries())) {
    if (targetUserId && session.user.user_id !== targetUserId) continue;
    if (channelId && !session.channelIds.has(channelId)) continue;
    try {
      env.__REALTIME_TEST__?.messages.push(encoded);
      socket.send(encoded);
    } catch {
      state.sessions.delete(socket);
    }
  }
  syncShimSnapshotState(env);
}

function revokeShimVoiceParticipation(env: Env, state: RepositoryState, serverId: string, userId: string) {
  if (!env.__REALTIME_TEST__) return;
  for (const [channelId, participants] of Object.entries(env.__REALTIME_TEST__.voiceParticipants)) {
    if (state.channels[channelId]?.server_id !== serverId || !participants.includes(userId)) continue;
    const next = participants.filter((candidate) => candidate !== userId);
    if (next.length) env.__REALTIME_TEST__.voiceParticipants[channelId] = next;
    else delete env.__REALTIME_TEST__.voiceParticipants[channelId];
    broadcastShimRealtime(env, 'voice.participants', { channel_id: channelId, user_ids: next }, channelId);
  }
  broadcastShimRealtime(env, 'voice.timeout', { server_id: serverId }, null, userId);
}

async function revokeRealtimeVoiceParticipation(env: Env, state: RepositoryState, serverId: string, userId: string) {
  if (!env.REALTIME_HUB) {
    revokeShimVoiceParticipation(env, state, serverId, userId);
    return;
  }
  const stub = env.REALTIME_HUB.get(env.REALTIME_HUB.idFromName('global'));
  await stub.fetch('https://realtime.internal/revoke-voice', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ server_id: serverId, user_id: userId }),
  });
}

function testRealtimeUpgrade(env: Env, auth: AuthenticatedUser) {
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();
  if (!env.__REALTIME_TEST__) env.__REALTIME_TEST__ = { events: [], sockets: 0, subscriptions: {}, typingUsers: {}, voiceParticipants: {}, messages: [] };
  const state = getShimRealtimeState(env);
  const session: ShimRealtimeSession = {
    id: `socket_${state.nextSocketId++}`,
    socket: server,
    user: auth,
    channelIds: new Set(),
    connectedAt: nowIso(),
  };
  state.sessions.set(server, session);
  syncShimSnapshotState(env);
  const record = (payload: string) => {
    env.__REALTIME_TEST__!.messages.push(payload);
    server.send(payload);
  };
  const teardown = () => {
    state.sessions.delete(server);
    delete env.__REALTIME_TEST__!.subscriptions[session.id];
    pruneUserFromChannelMap(env.__REALTIME_TEST__!.typingUsers, session.user.user_id);
    pruneUserFromChannelMap(env.__REALTIME_TEST__!.voiceParticipants, session.user.user_id);
    syncShimSnapshotState(env);
  };
  server.addEventListener('message', async (event) => {
    try {
      const body = JSON.parse(String(event.data || '{}')) as { action?: string; channel_ids?: string[]; channel_id?: string; target_user_id?: string | null; signal_type?: string | null; active?: boolean; status?: string; payload?: Record<string, unknown> };
      if (body.action === 'ping') {
        record(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (body.action === 'disconnect') {
        teardown();
        try {
          server.close(1000, 'client requested');
        } catch {}
        return;
      }
      if (body.action === 'subscribe') {
        const denied: Array<{ channel_id: string; code: string }> = [];
        for (const rawChannelId of body.channel_ids || []) {
          const channelId = String(rawChannelId);
          const access = await authorizeRealtimeChannel(env, session.user.user_id, channelId);
          if (access.allowed) session.channelIds.add(channelId);
          else denied.push({ channel_id: channelId, code: access.code });
        }
        syncShimSnapshotState(env);
        record(JSON.stringify({ type: 'subscribed', channel_ids: Array.from(session.channelIds) }));
        if (denied.length) record(JSON.stringify({ event: 'realtime.denied', data: { action: 'subscribe', denied } }));
        return;
      }
      if (body.action === 'unsubscribe') {
        for (const channelId of body.channel_ids || []) session.channelIds.delete(String(channelId));
        syncShimSnapshotState(env);
        record(JSON.stringify({ type: 'unsubscribed', channel_ids: body.channel_ids || [] }));
        return;
      }
      if (body.action === 'typing' && body.channel_id) {
        const access = await authorizeRealtimeChannel(env, session.user.user_id, body.channel_id);
        if (!access.allowed) {
          record(JSON.stringify({ event: 'realtime.denied', channel_id: body.channel_id, data: { action: 'typing', code: access.code, message: access.message } }));
          return;
        }
        const existing = new Set(env.__REALTIME_TEST__!.typingUsers[body.channel_id] || []);
        if (body.active === false) existing.delete(session.user.user_id);
        else existing.add(session.user.user_id);
        env.__REALTIME_TEST__!.typingUsers[body.channel_id] = Array.from(existing);
        broadcastShimRealtime(env, 'typing.updated', { channel_id: body.channel_id, user_ids: env.__REALTIME_TEST__!.typingUsers[body.channel_id] }, body.channel_id);
        return;
      }
      if (body.action === 'join_voice' && body.channel_id) {
        const access = await authorizeVoiceParticipation(env, session.user.user_id, body.channel_id);
        if (!access.allowed) {
          record(JSON.stringify({ event: 'realtime.denied', channel_id: body.channel_id, data: { action: 'join_voice', code: access.code, message: access.message } }));
          return;
        }
        const existing = new Set(env.__REALTIME_TEST__!.voiceParticipants[body.channel_id] || []);
        existing.add(session.user.user_id);
        env.__REALTIME_TEST__!.voiceParticipants[body.channel_id] = Array.from(existing);
        broadcastShimRealtime(env, 'voice.participants', { channel_id: body.channel_id, user_ids: env.__REALTIME_TEST__!.voiceParticipants[body.channel_id] }, body.channel_id);
        return;
      }
      if (body.action === 'leave_voice' && body.channel_id) {
        const existing = new Set(env.__REALTIME_TEST__!.voiceParticipants[body.channel_id] || []);
        existing.delete(session.user.user_id);
        env.__REALTIME_TEST__!.voiceParticipants[body.channel_id] = Array.from(existing);
        broadcastShimRealtime(env, 'voice.participants', { channel_id: body.channel_id, user_ids: env.__REALTIME_TEST__!.voiceParticipants[body.channel_id] }, body.channel_id);
        return;
      }
      if (body.action === 'voice.status' && body.channel_id) {
        const channelId = body.channel_id;
        const access = await authorizeVoiceParticipation(env, session.user.user_id, channelId);
        if (!access.allowed) {
          record(JSON.stringify({ event: 'realtime.denied', channel_id: channelId, data: { action: 'voice.status', code: access.code, message: access.message } }));
          return;
        }
        broadcastShimRealtime(env, 'voice.status', { user_id: session.user.user_id, ...(body.payload || {}), channel_id: channelId }, channelId);
        return;
      }
      if (body.action === 'call.signal' && body.channel_id) {
        const channelId = body.channel_id;
        const access = await authorizeRealtimeChannel(env, session.user.user_id, channelId);
        if (!access.allowed) {
          record(JSON.stringify({ event: 'realtime.denied', channel_id: channelId, data: { action: 'call.signal', code: access.code, message: access.message } }));
          return;
        }
        const targetUserId = String(body.target_user_id || '') || null;
        broadcastShimRealtime(env, 'call.signal', {
          channel_id: channelId,
          from_user_id: session.user.user_id,
          target_user_id: targetUserId,
          signal_type: String(body.signal_type || ''),
          payload: body.payload || null,
        }, channelId, targetUserId);
        return;
      }
      if (body.action === 'presence' || body.action === 'presence.update') {
        broadcastShimRealtime(env, 'presence.updated', { user_id: session.user.user_id, ...(body.payload || {}), status: body.status || body.payload?.status || 'online' }, null);
      }
    } catch {}
  });
  record(JSON.stringify({ type: 'connected', backend: 'shim' }));
  server.addEventListener('close', () => {
    teardown();
    env.__REALTIME_TEST__!.messages.push(JSON.stringify({ type: 'disconnected', backend: 'shim' }));
  });
  return new Response(null, { status: 101, webSocket: client });
}

export function buildApiRouter() {
  const api = new Hono<{ Bindings: Env }>();

  api.use('*', async (c, next) => {
    const path = new URL(c.req.url).pathname;
    const maintenanceExempt = [
      '/health',
      '/runtime-config',
      '/auth/login',
      '/auth/refresh',
      '/auth/verification/request',
      '/auth/verification/confirm',
      '/billing/webhook',
    ].some((suffix) => path.endsWith(suffix)) || path.includes('/admin/') || path.endsWith('/admin') || path.endsWith('/runtime/controls') || path.endsWith('/readiness');
    if (maintenanceExempt) return next();

    const repo = await loadRepository(c.env);
    const controls = resolvedRuntimeControls(repo, c.env);
    if (!controls.maintenance_mode) return next();
    const auth = await requireUser(c);
    const user = auth ? repo.state.users[auth.user_id] : null;
    if (user && isAdmin(user, c.env)) return next();
    return errorResponse('MAINTENANCE_MODE', controls.maintenance_message || 'Wyvern is temporarily undergoing maintenance.', 503, {
      maintenance_mode: true,
    });
  });

  api.get('/health', (c) => successResponse({ status: 'ok', app_name: getConfig(c.env).appName, environment: getConfig(c.env).environment, runtime: 'cloudflare-workers' }));
  api.get('/runtime-config', async (c) => {
    const repo = await loadRepository(c.env);
    const controls = resolvedRuntimeControls(repo, c.env);
    return successResponse({ app_name: getConfig(c.env).appName, backend_url: null, client_mode: 'stable', release_channel: 'stable', node_role: 'main', node_id: 'workers', indexing: false, edge_mode_enabled: false, sync_peer_api_url: null, edge_mode_available: false, bridge_schema_version: 1, sync_enabled: false, wyv_public_base_url: getConfig(c.env).wyvPublicBaseUrl, subscriptions_enabled: getConfig(c.env).subscriptionsEnabled, universal_premium_access: getConfig(c.env).universalPremiumAccess, runtime_controls: controls, feature_flags: { community_tools: controls.community_tools_enabled, shell_refresh: true, directory_recommendations: true, admin_diagnostics_button: true, edge_release_banner: false, uploads: controls.uploads_enabled, webhooks: controls.webhooks_enabled, workspaces: controls.workspaces_enabled, voice: controls.voice_enabled, ai: controls.ai_enabled }, giphy_api_key: null, giphy_rating: 'g', giphy_limit: 24, bridge_health: { configured: false, node_role: 'main', peer_url: null, sync_enabled: false, edge_mode_enabled: false, edge_mode_available: false, pending_outbox: 0, dead_letter_outbox: 0, last_outbox_delivery_at: null, last_inbound_at: null }, legal: legalMetadata(), metrics: { users: Object.keys(repo.state.users).length, servers: Object.keys(repo.state.servers).length, messages: Object.keys(repo.state.messages).length } });
  });

  api.get('/runtime/controls', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    return successResponse(resolvedRuntimeControls(admin.repo, c.env));
  });

  api.patch('/runtime/controls', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const payload = runtimeControlsSchema.parse(await c.req.json());
    const current = resolvedRuntimeControls(admin.repo, c.env);
    admin.repo.state.runtimeControls = {
      ...current,
      ...payload,
      updated_at: nowIso(),
      updated_by_user_id: admin.auth.user_id,
    };
    await admin.repo.save();
    return successResponse(admin.repo.state.runtimeControls);
  });

  api.get('/readiness', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const config = getConfig(c.env);
    const checks = {
      app_state_room: !!c.env.APP_STATE_ROOM,
      presence_room: !!c.env.PRESENCE_ROOM,
      realtime_hub: !!c.env.REALTIME_HUB,
      rate_limit_room: !!c.env.RATE_LIMIT_ROOM,
      media_bucket: !!c.env.MEDIA_BUCKET,
      backup_bucket: !!c.env.BACKUP_BUCKET,
      smtp2go: !!config.smtp2goApiKey,
      stripe: !config.subscriptionsEnabled || !!(config.stripeSecretKey && config.stripeWebhookSecret && config.stripePriceId),
      runtime_controls: !!resolvedRuntimeControls(admin.repo, c.env),
    };
    const ready = Object.values(checks).every(Boolean);
    return successResponse({ ready, checks, environment: config.environment, subscriptions_enabled: config.subscriptionsEnabled }, ready ? 200 : 503);
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

  api.get('/runtime/diagnostics', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const realtimeMode = c.env.REALTIME_HUB ? 'durable_object' : 'shim';
    const persistenceMode = c.env.APP_STATE_ROOM ? 'durable_object' : 'memory';
    const mediaMode = c.env.MEDIA_BUCKET ? 'r2' : 'app_state';

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
        backup_bucket: !!c.env.BACKUP_BUCKET,
        rate_limit_room: !!c.env.RATE_LIMIT_ROOM,
      },
      malware_scanning: {
        configured: !!(getConfig(c.env).malwareScannerUrl && getConfig(c.env).malwareScannerSecret),
        mode: getConfig(c.env).malwareScannerUrl ? 'quarantine' : 'disabled',
        pending: Object.values(repo.state.mediaObjects).filter((item) => item.scan_status === 'pending').length,
        infected: Object.values(repo.state.mediaObjects).filter((item) => item.scan_status === 'infected').length,
      },
      launch_integrations: {
        smtp2go_configured: !!getConfig(c.env).smtp2goApiKey,
        subscriptions_enabled: getConfig(c.env).subscriptionsEnabled,
        stripe_configured: getConfig(c.env).subscriptionsEnabled && !!(getConfig(c.env).stripeSecretKey && getConfig(c.env).stripeWebhookSecret && getConfig(c.env).stripePriceId),
      },
      runtime_controls: resolvedRuntimeControls(repo, c.env),
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
    const key = await writeStateBackup(c.env, c.env.ENVIRONMENT || 'development', 'manual');
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

  api.post('/runtime/migrate-namespace', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    if (!c.env.BACKUP_BUCKET) return errorResponse('HTTP_ERROR', 'BACKUP_BUCKET is not bound', 503);
    const currentRepo = await loadRepository(c.env);
    const user = currentRepo.state.users[auth.user_id];
    if (!user || !isAdmin(user, c.env)) return errorResponse('FORBIDDEN', 'Admin access required', 403);
    const payload = namespaceMigrationSchema.parse(await c.req.json().catch(() => ({})));
    if (payload.source === payload.target) return errorResponse('HTTP_ERROR', 'Source and target namespaces must differ', 400);

    const sourceState = await loadStateForNamespace(c.env, payload.source);
    const targetState = await loadStateForNamespace(c.env, payload.target);
    const sourceDigest = await stateDigest(sourceState);
    const targetDigest = await stateDigest(targetState);
    const sourceCounts = summarizeState(sourceState);
    const targetCounts = summarizeState(targetState);
    const targetNonempty = Object.values(targetCounts).some((count) => count > 0);

    if (payload.expected_source_digest && payload.expected_source_digest !== sourceDigest) {
      return errorResponse('STATE_DIGEST_MISMATCH', 'Source namespace digest does not match the expected digest', 409, {
        expected: payload.expected_source_digest,
        actual: sourceDigest,
      });
    }
    if (!payload.dry_run && targetNonempty && !payload.overwrite) {
      return errorResponse('TARGET_NAMESPACE_NOT_EMPTY', 'Target namespace is not empty; explicit overwrite confirmation is required', 409, {
        target: payload.target,
        target_digest: targetDigest,
        target_counts: targetCounts,
      });
    }
    if (payload.dry_run) {
      return successResponse({
        dry_run: true,
        source: payload.source,
        target: payload.target,
        source_digest: sourceDigest,
        target_digest: targetDigest,
        source_counts: sourceCounts,
        target_counts: targetCounts,
        target_nonempty: targetNonempty,
      });
    }

    const backupKey = await writeStateBackup(c.env, payload.source, 'pre-migration');
    const copy = JSON.parse(JSON.stringify(sourceState));
    await saveStateForNamespace(c.env, payload.target, copy);
    const verifiedState = await loadStateForNamespace(c.env, payload.target);
    const verifiedDigest = await stateDigest(verifiedState);
    if (verifiedDigest !== sourceDigest) {
      return errorResponse('STATE_DIGEST_MISMATCH', 'Target namespace verification failed after copy', 502, {
        source_digest: sourceDigest,
        target_digest: verifiedDigest,
        backup_key: backupKey,
      });
    }
    return successResponse({
      migrated: true,
      source: payload.source,
      target: payload.target,
      digest: verifiedDigest,
      counts: summarizeState(verifiedState),
      backup_key: backupKey,
      migrated_at: nowIso(),
    });
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

  api.post('/auth/register', async (c) => {
    const payload = registerSchema.parse(await c.req.json());
    const normalizedEmail = payload.email.toLowerCase().trim();
    const actorLimited = await enforceRateLimit(c, 'auth.register', normalizedEmail, 10, 60);
    if (actorLimited) return actorLimited;
    const clientLimited = await enforceRateLimit(c, 'auth.register.client', clientRateKey(c), 10, 60);
    if (clientLimited) return clientLimited;
    const repo = await loadRepository(c.env);
    if (!resolvedRuntimeControls(repo, c.env).registrations_enabled) {
      return errorResponse('REGISTRATIONS_DISABLED', 'New registrations are temporarily disabled', 503);
    }
    const legal = legalVersions();
    if (!payload.accepted_legal || payload.terms_version !== legal.terms_version || payload.privacy_version !== legal.privacy_version) return errorResponse('HTTP_ERROR', 'Current legal terms must be accepted', 400);
    if (getUserByEmail(repo.state, payload.email)) return errorResponse('HTTP_ERROR', 'Email already in use', 400);
    const userId = repo.nextId('user');
    const sameNameCount = Object.values(repo.state.users).filter((item) => item.username.toLowerCase() === payload.username.toLowerCase()).length + 1;
    const createdAt = nowIso();
    const user: UserRecord = { id: userId, username: payload.username, discriminator: String(sameNameCount).padStart(4, '0'), display_name: payload.display_name || payload.username, bio: null, directory_opt_in: false, email: payload.email.toLowerCase(), avatar: null, is_paid: false, created_at: createdAt, password_hash: await hashPassword(payload.password), accepted_terms_version: legal.terms_version, accepted_privacy_version: legal.privacy_version, legal_accepted_at: createdAt, ai_opt_in: false, nsfw_18_verified: false, email_verified_at: null };
    repo.state.users[user.id] = user;
    repo.state.emailVerifications[user.id] = {
      user_id: user.id,
      status: 'pending',
      code_hash: null,
      expires_at: null,
      failed_attempt_count: 0,
      locked_until: null,
      request_count: 0,
      last_requested_at: null,
      last_sent_at: null,
      last_request_ip_hash: null,
      verified_at: null,
      updated_at: createdAt,
    };
    const refreshToken = randomToken('refresh');
    const refreshId = repo.nextId('refresh_token');
    repo.state.refreshTokens[refreshId] = { id: refreshId, user_id: user.id, token_hash: await hashToken(refreshToken), expires_at: futureIso(getConfig(c.env).refreshTokenExpireDays), created_at: createdAt, is_revoked: false };
    await repo.save();
    return successResponse({ user: serializeMe(user, c.env, repo.state), tokens: { access_token: await issueAccessToken(c.env, toAuthUser(user), getConfig(c.env).accessTokenExpireMinutes), refresh_token: refreshToken }, email_verification_required: true });
  });

  api.post('/auth/verification/request', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const user = repo.state.users[auth.user_id];
    if (!user) return errorResponse('NOT_FOUND', 'User not found', 404);
    if (isEmailVerified(c.env, user)) return successResponse({ verified: true, already_verified: true, email: user.email });

    const perUser = await enforceRateLimit(c, 'auth.verification.request.user', user.id, getConfig(c.env).emailVerificationRequestLimit, getConfig(c.env).emailVerificationRateLimitWindowMinutes * 60);
    if (perUser) return perUser;
    const perClient = await enforceRateLimit(c, 'auth.verification.request.client', clientRateKey(c), getConfig(c.env).emailVerificationRequestLimit, getConfig(c.env).emailVerificationRateLimitWindowMinutes * 60);
    if (perClient) return perClient;
    const stateRate = await consumeEmailVerificationRateLimit(repo, c.env, user.id, clientRateKey(c));
    if (!stateRate.allowed) {
      const response = errorResponse('RATE_LIMITED', 'Too many verification email requests', 429, { retry_after: stateRate.retryAfter });
      response.headers.set('Retry-After', String(stateRate.retryAfter));
      return response;
    }

    const verification = repo.state.emailVerifications[user.id];
    if (verification?.locked_until && new Date(verification.locked_until).getTime() > Date.now()) {
      const retryAfter = Math.max(1, Math.ceil((new Date(verification.locked_until).getTime() - Date.now()) / 1000));
      const response = errorResponse('VERIFICATION_LOCKED', 'Too many invalid verification attempts', 429, { retry_after: retryAfter });
      response.headers.set('Retry-After', String(retryAfter));
      return response;
    }
    const now = Date.now();
    const resendAt = verification?.last_sent_at ? new Date(verification.last_sent_at).getTime() + getConfig(c.env).emailVerificationResendSeconds * 1000 : 0;
    if (resendAt > now) {
      const retryAfter = Math.max(1, Math.ceil((resendAt - now) / 1000));
      const response = errorResponse('VERIFICATION_RESEND_THROTTLED', 'Please wait before requesting another verification code', 429, { retry_after: retryAfter });
      response.headers.set('Retry-After', String(retryAfter));
      return response;
    }

    const code = generateVerificationCode();
    const issuedAt = nowIso();
    const expiresAt = new Date(now + getConfig(c.env).emailVerificationCodeExpireMinutes * 60_000).toISOString();
    try {
      await sendViaSmtp2go(c.env, {
        from_address: getConfig(c.env).smtp2goDefaultFrom,
        from_name: getConfig(c.env).smtp2goDefaultFromName || 'Wyvern',
        to: [user.email],
        subject: 'Your Wyvern verification code',
        text_body: `Your Wyvern verification code is ${code}. It expires in ${getConfig(c.env).emailVerificationCodeExpireMinutes} minutes. If you did not request this, you can safely ignore this email.`,
      });
    } catch (error) {
      return errorResponse('EMAIL_DELIVERY_FAILED', 'We could not send your verification code. Please try again later.', 503, {
        provider: 'smtp2go',
      });
    }
    repo.state.emailVerifications[user.id] = {
      user_id: user.id,
      status: 'pending',
      code_hash: await verificationCodeHash(user.id, code),
      expires_at: expiresAt,
      failed_attempt_count: 0,
      locked_until: null,
      request_count: (verification?.request_count || 0) + 1,
      last_requested_at: issuedAt,
      last_sent_at: issuedAt,
      last_request_ip_hash: await sha256(clientRateKey(c)),
      verified_at: null,
      updated_at: issuedAt,
    };
    await repo.save();
    return successResponse({ verified: false, email: user.email, expires_at: expiresAt, resend_after_seconds: getConfig(c.env).emailVerificationResendSeconds });
  });

  api.post('/auth/verification/confirm', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const payload = verificationConfirmSchema.parse(await c.req.json());
    const repo = await loadRepository(c.env);
    const user = repo.state.users[auth.user_id];
    if (!user) return errorResponse('NOT_FOUND', 'User not found', 404);
    if (isEmailVerified(c.env, user)) return successResponse({ verified: true, already_verified: true, user: serializeMe(user, c.env, repo.state) });
    const verification = repo.state.emailVerifications[user.id];
    const now = Date.now();
    if (verification.locked_until && new Date(verification.locked_until).getTime() > now) {
      const retryAfter = Math.max(1, Math.ceil((new Date(verification.locked_until).getTime() - now) / 1000));
      const response = errorResponse('VERIFICATION_LOCKED', 'Too many invalid verification attempts', 429, { retry_after: retryAfter });
      response.headers.set('Retry-After', String(retryAfter));
      return response;
    }
    if (!verification?.code_hash || !verification.expires_at) return errorResponse('VERIFICATION_CODE_REQUIRED', 'Request a verification code first', 400);
    if (new Date(verification.expires_at).getTime() <= now) {
      verification.status = 'expired';
      verification.code_hash = null;
      verification.updated_at = nowIso();
      await repo.save();
      return errorResponse('VERIFICATION_CODE_EXPIRED', 'This verification code has expired. Request a new code.', 400);
    }
    const matches = secureHexEqual(await verificationCodeHash(user.id, payload.code), verification.code_hash);
    if (!matches) {
      verification.failed_attempt_count += 1;
      verification.updated_at = nowIso();
      if (verification.failed_attempt_count >= getConfig(c.env).emailVerificationMaxAttempts) {
        verification.status = 'locked';
        verification.locked_until = verification.expires_at;
        verification.code_hash = null;
      }
      await repo.save();
      return errorResponse('INVALID_VERIFICATION_CODE', 'That verification code is invalid', 400, {
        attempts_remaining: Math.max(0, getConfig(c.env).emailVerificationMaxAttempts - verification.failed_attempt_count),
      });
    }
    const verifiedAt = nowIso();
    verification.status = 'verified';
    verification.code_hash = null;
    verification.expires_at = null;
    verification.failed_attempt_count = 0;
    verification.locked_until = null;
    verification.verified_at = verifiedAt;
    verification.updated_at = verifiedAt;
    user.email_verified_at = verifiedAt;
    user.email_verification_version = getConfig(c.env).emailVerificationRequiredVersion;
    await repo.save();
    return successResponse({ verified: true, verified_at: verifiedAt, user: serializeMe(user, c.env, repo.state) });
  });

  api.get('/billing/entitlement', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const user = repo.state.users[auth.user_id];
    if (!user) return errorResponse('NOT_FOUND', 'User not found', 404);
    const limits = limitsForUser(c.env, user);
    return successResponse({
      email_verified: isEmailVerified(c.env, user),
      entitlement: effectiveEntitlement(c.env, user),
      limits,
      usage: {
        storage_bytes: storageBytesForUser(repo.state, user.id),
        uploads_today: uploadsTodayForUser(repo.state, user.id),
      },
      subscriptions_enabled: getConfig(c.env).subscriptionsEnabled,
      stripe_configured: getConfig(c.env).subscriptionsEnabled && !!(getConfig(c.env).stripeSecretKey && getConfig(c.env).stripePriceId),
    });
  });

  api.post('/billing/checkout', async (c) => {
    if (!getConfig(c.env).subscriptionsEnabled) return errorResponse('SUBSCRIPTIONS_DISABLED', 'Subscriptions are not available at this time', 410);
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const payload = billingReturnSchema.parse(await c.req.json().catch(() => ({})));
    const config = getConfig(c.env);
    if (!config.stripeSecretKey || !config.stripePriceId) return errorResponse('BILLING_UNAVAILABLE', 'Stripe billing is not configured', 503);
    if (hasPremiumAccess(c.env, verified.user)) return errorResponse('ALREADY_PREMIUM', 'This account already has an active Premium entitlement', 409);
    const origin = new URL(c.req.url).origin;
    let successUrl: string;
    let cancelUrl: string;
    try {
      successUrl = safeStripeReturnUrl(c.req.url, payload.return_url, config.stripeSuccessUrl, '/app?billing=success');
      cancelUrl = safeStripeReturnUrl(c.req.url, payload.return_url, config.stripeCancelUrl, '/app?billing=cancel');
    } catch (error) {
      return errorResponse('INVALID_RETURN_URL', (error as Error).message, 400);
    }
    const success = new URL(successUrl, origin);
    if (!success.searchParams.has('session_id')) success.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
    const form = new URLSearchParams({
      mode: 'subscription',
      success_url: success.toString(),
      cancel_url: cancelUrl,
      client_reference_id: verified.user.id,
      'line_items[0][price]': config.stripePriceId,
      'line_items[0][quantity]': '1',
      'metadata[wyvern_user_id]': verified.user.id,
      'subscription_data[metadata][wyvern_user_id]': verified.user.id,
    });
    const current = verified.user.premium_entitlement;
    if (current?.stripe_customer_id) form.set('customer', current.stripe_customer_id);
    else form.set('customer_email', verified.user.email);
    try {
      const session = await stripeFormRequest(c.env, '/checkout/sessions', form);
      const url = typeof session.url === 'string' ? session.url : null;
      if (!url) throw new Error('Stripe did not return a checkout URL');
      await verified.repo.save();
      return successResponse({ url, session_id: stripeObjectId(session.id) });
    } catch (error) {
      return errorResponse('BILLING_PROVIDER_ERROR', 'Unable to create a Stripe checkout session', 502, { provider: 'stripe' });
    }
  });

  api.post('/billing/portal', async (c) => {
    if (!getConfig(c.env).subscriptionsEnabled) return errorResponse('SUBSCRIPTIONS_DISABLED', 'Subscriptions are not available at this time', 410);
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const payload = billingReturnSchema.parse(await c.req.json().catch(() => ({})));
    const config = getConfig(c.env);
    const customerId = verified.user.premium_entitlement?.stripe_customer_id || findStripeSubscriptionForUser(verified.repo.state, verified.user.id)?.stripe_customer_id;
    if (!config.stripeSecretKey) return errorResponse('BILLING_UNAVAILABLE', 'Stripe billing is not configured', 503);
    if (!customerId) return errorResponse('BILLING_PORTAL_UNAVAILABLE', 'No Stripe customer is associated with this account', 409);
    let returnUrl: string;
    try {
      returnUrl = safeStripeReturnUrl(c.req.url, payload.return_url, config.stripePortalReturnUrl, '/app?billing=portal');
    } catch (error) {
      return errorResponse('INVALID_RETURN_URL', (error as Error).message, 400);
    }
    try {
      const session = await stripeFormRequest(c.env, '/billing_portal/sessions', new URLSearchParams({ customer: customerId, return_url: returnUrl }));
      const url = typeof session.url === 'string' ? session.url : null;
      if (!url) throw new Error('Stripe did not return a billing portal URL');
      return successResponse({ url });
    } catch {
      return errorResponse('BILLING_PROVIDER_ERROR', 'Unable to create a Stripe billing portal session', 502, { provider: 'stripe' });
    }
  });

  api.post('/billing/webhook', async (c) => {
    const config = getConfig(c.env);
    if (!config.subscriptionsEnabled) return successResponse({ received: true, subscriptions_enabled: false });
    if (!config.stripeWebhookSecret) return errorResponse('BILLING_UNAVAILABLE', 'Stripe webhook verification is not configured', 503);
    const rawBody = await c.req.text();
    try {
      await verifyStripeSignature(config.stripeWebhookSecret, rawBody, c.req.header('stripe-signature') || null);
    } catch (error) {
      return errorResponse('INVALID_STRIPE_SIGNATURE', 'Stripe webhook signature could not be verified', 400);
    }
    let event: { id?: unknown; type?: unknown; created?: unknown; data?: { object?: unknown } };
    try {
      event = JSON.parse(rawBody) as typeof event;
    } catch {
      return errorResponse('INVALID_STRIPE_EVENT', 'Stripe webhook body is not valid JSON', 400);
    }
    const eventId = typeof event.id === 'string' ? event.id : null;
    const eventType = typeof event.type === 'string' ? event.type : null;
    const object = event.data?.object;
    if (!eventId || !eventType || !object || typeof object !== 'object' || Array.isArray(object)) return errorResponse('INVALID_STRIPE_EVENT', 'Stripe webhook is missing required event data', 400);
    const repo = await loadRepository(c.env);
    const known = repo.state.stripeWebhookEvents[eventId];
    if (known?.processed_at) return successResponse({ received: true, duplicate: true });
    repo.state.stripeWebhookEvents[eventId] = {
      event_id: eventId,
      event_type: eventType,
      stripe_created_at: unixSecondsToIso(event.created),
      received_at: known?.received_at || nowIso(),
      processed_at: null,
      processing_error: null,
    };
    try {
      const stripeObject = object as Record<string, unknown>;
      const eventCreatedAt = unixSecondsToIso(event.created);
      let userId = userIdFromStripeObject(stripeObject, repo.state);
      if (!userId && eventType === 'checkout.session.completed') {
        const reference = stripeObject.client_reference_id;
        if (typeof reference === 'string' && repo.state.users[reference]) userId = reference;
      }
      if (eventType.startsWith('customer.subscription.')) {
        if (!userId) throw new Error('Stripe subscription event could not be associated with a Wyvern user');
        const subscriptionId = stripeObjectId(stripeObject.id);
        const current = subscriptionId ? repo.state.stripeSubscriptions[subscriptionId] : undefined;
        if (current?.latest_event_created_at && eventCreatedAt && eventCreatedAt <= current.latest_event_created_at) {
          repo.state.stripeWebhookEvents[eventId].processed_at = nowIso();
          await repo.save();
          return successResponse({ received: true, ignored_out_of_order: true });
        }
        const subscription = upsertStripeSubscription(repo, c.env, stripeObject, userId, eventCreatedAt);
        if (!subscription) {
          repo.state.stripeWebhookEvents[eventId].processed_at = nowIso();
          await repo.save();
          return successResponse({ received: true, ignored_unrecognized_price: true });
        }
        subscription.latest_event_id = eventId;
        subscription.latest_event_created_at = eventCreatedAt || subscription.latest_event_created_at || nowIso();
        const user = repo.state.users[userId];
        if (user) applyStripeEntitlement(user, subscription);
      } else if (eventType === 'checkout.session.completed' && userId) {
        const user = repo.state.users[userId];
        if (user) {
          const entitlement = user.premium_entitlement || applyStripeEntitlement(user, null);
          entitlement.stripe_customer_id = stripeObjectId(stripeObject.customer) || entitlement.stripe_customer_id;
          entitlement.stripe_subscription_id = stripeObjectId(stripeObject.subscription) || entitlement.stripe_subscription_id;
          entitlement.stripe_price_id = config.stripePriceId;
          entitlement.source = 'stripe';
          entitlement.updated_at = nowIso();
          user.premium_entitlement = entitlement;
        }
      } else if (eventType === 'invoice.payment_failed') {
        const subscriptionId = stripeObjectId(stripeObject.subscription);
        const subscription = subscriptionId ? repo.state.stripeSubscriptions[subscriptionId] : undefined;
        const user = subscription ? repo.state.users[subscription.user_id] : null;
        if (subscription && user) {
          if (subscription.latest_event_created_at && eventCreatedAt && eventCreatedAt <= subscription.latest_event_created_at) {
            repo.state.stripeWebhookEvents[eventId].processed_at = nowIso();
            await repo.save();
            return successResponse({ received: true, ignored_out_of_order: true });
          }
          subscription.status = 'past_due';
          subscription.latest_event_id = eventId;
          subscription.latest_event_created_at = eventCreatedAt || subscription.latest_event_created_at || nowIso();
          subscription.updated_at = nowIso();
          applyStripeEntitlement(user, subscription);
        }
      }
      repo.state.stripeWebhookEvents[eventId].processed_at = nowIso();
      await repo.save();
      return successResponse({ received: true });
    } catch (error) {
      repo.state.stripeWebhookEvents[eventId].processing_error = error instanceof Error ? error.message.slice(0, 500) : 'Unknown webhook processing error';
      await repo.save();
      return errorResponse('STRIPE_EVENT_PROCESSING_FAILED', 'Stripe webhook could not be processed', 500);
    }
  });

  api.post('/auth/login', async (c) => {
    const payload = loginSchema.parse(await c.req.json());
    const normalizedEmail = payload.email.toLowerCase().trim();
    const actorLimited = await enforceRateLimit(c, 'auth.login', normalizedEmail, 10, 60);
    if (actorLimited) return actorLimited;
    const clientLimited = await enforceRateLimit(c, 'auth.login.client', clientRateKey(c), 10, 60);
    if (clientLimited) return clientLimited;
    const repo = await loadRepository(c.env);
    const user = getUserByEmail(repo.state, normalizedEmail);
    if (!user || !(await verifyPassword(payload.password, user.password_hash))) return errorResponse('HTTP_ERROR', 'Invalid credentials', 401);
    const moderation = getModerationRecord(repo.state, user.id);
    if (isBlockedModerationStatus(moderation.status)) {
      revokeUserRefreshTokens(repo.state, user.id);
      await repo.save();
      return errorResponse('FORBIDDEN', moderationMessage(moderation.status), 403, { moderation_status: moderation.status });
    }
    const emailReverificationRequired = requiresEmailReverificationOnLogin(c.env, user);
    if (emailReverificationRequired) resetEmailVerificationForReauthentication(repo, user);
    const refreshToken = randomToken('refresh');
    const refreshId = repo.nextId('refresh_token');
    repo.state.refreshTokens[refreshId] = { id: refreshId, user_id: user.id, token_hash: await hashToken(refreshToken), expires_at: futureIso(getConfig(c.env).refreshTokenExpireDays), created_at: nowIso(), is_revoked: false };
    await repo.save();
    return successResponse({ user: serializeMe(user, c.env, repo.state), tokens: { access_token: await issueAccessToken(c.env, toAuthUser(user), getConfig(c.env).accessTokenExpireMinutes), refresh_token: refreshToken }, email_verification_required: emailReverificationRequired || !isEmailVerified(c.env, user) });
  });

  api.post('/auth/refresh', async (c) => {
    const payload = refreshSchema.parse(await c.req.json());
    const refreshHash = await hashToken(payload.refresh_token);
    const actorLimited = await enforceRateLimit(c, 'auth.refresh', refreshHash, 10, 60);
    if (actorLimited) return actorLimited;
    const clientLimited = await enforceRateLimit(c, 'auth.refresh.client', clientRateKey(c), 10, 60);
    if (clientLimited) return clientLimited;
    const repo = await loadRepository(c.env);
    const token = getRefreshTokenByHash(repo.state, refreshHash);
    if (!token || token.is_revoked || isExpired(token.expires_at)) return errorResponse('HTTP_ERROR', 'Invalid refresh token', 401);
    const user = repo.state.users[token.user_id];
    if (!user) return errorResponse('HTTP_ERROR', 'Invalid refresh token', 401);
    const moderation = getModerationRecord(repo.state, user.id);
    if (isBlockedModerationStatus(moderation.status)) {
      token.is_revoked = true;
      revokeUserRefreshTokens(repo.state, user.id);
      await repo.save();
      return errorResponse('FORBIDDEN', moderationMessage(moderation.status), 403, { moderation_status: moderation.status });
    }
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
    const moderation = getModerationRecord(repo.state, user.id);
    if (isBlockedModerationStatus(moderation.status)) {
      revokeUserRefreshTokens(repo.state, user.id);
      await repo.save();
      return errorResponse('FORBIDDEN', moderationMessage(moderation.status), 403, { moderation_status: moderation.status });
    }
    const refreshToken = randomToken('refresh');
    const refreshId = repo.nextId('refresh_token');
    repo.state.refreshTokens[refreshId] = { id: refreshId, user_id: user.id, token_hash: await hashToken(refreshToken), expires_at: futureIso(getConfig(c.env).refreshTokenExpireDays), created_at: nowIso(), is_revoked: false };
    await repo.save();
    return successResponse({ user: serializeMe(user, c.env, repo.state), tokens: { access_token: await issueAccessToken(c.env, toAuthUser(user), getConfig(c.env).accessTokenExpireMinutes), refresh_token: refreshToken }, grant: payload.grant });
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
    if (requiresEmailReverificationOnLogin(c.env, user)) {
      resetEmailVerificationForReauthentication(repo, user);
      await repo.save();
    }
    return successResponse(serializeMe(user, c.env, repo.state));
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
    if (body.profile_cosmetics !== undefined) {
      if (!isEmailVerified(c.env, user)) return errorResponse('EMAIL_VERIFICATION_REQUIRED', 'Verify your email before accessing Premium customization', 403, { verification_required: true });
      if (!hasPremiumAccess(c.env, user)) return errorResponse('PREMIUM_REQUIRED', 'Profile customization is not available for this account', 403);
      if (!body.profile_cosmetics || typeof body.profile_cosmetics !== 'object' || Array.isArray(body.profile_cosmetics)) {
        return errorResponse('HTTP_ERROR', 'Profile cosmetics must be an object', 400);
      }
      const cosmetics = body.profile_cosmetics as Record<string, unknown>;
      const accent = cosmetics.accent_color;
      const banner = cosmetics.banner_media_id;
      const personalization = cosmetics.personalization;
      if (accent !== undefined && accent !== null && (typeof accent !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(accent))) {
        return errorResponse('HTTP_ERROR', 'Accent color must be a six-digit hex color', 400);
      }
      if (banner !== undefined && banner !== null && (typeof banner !== 'string' || banner.length > 255)) return errorResponse('HTTP_ERROR', 'Banner media identifier is invalid', 400);
      if (personalization !== undefined && (!personalization || typeof personalization !== 'object' || Array.isArray(personalization))) return errorResponse('HTTP_ERROR', 'Personalization must be an object', 400);
      user.profile_cosmetics = {
        accent_color: accent === undefined ? user.profile_cosmetics?.accent_color || null : accent as string | null,
        banner_media_id: banner === undefined ? user.profile_cosmetics?.banner_media_id || null : banner as string | null,
        show_premium_badge: cosmetics.show_premium_badge === undefined ? user.profile_cosmetics?.show_premium_badge ?? true : cosmetics.show_premium_badge === true,
        supporter_badge: true,
        personalization: personalization === undefined ? user.profile_cosmetics?.personalization || {} : personalization as Record<string, string | number | boolean | null>,
        updated_at: nowIso(),
      };
    }
    queueRealtimeEvent(repo, 'user.updated', serializePublicUser(user, repo.state) as unknown as Record<string, unknown>, null, auth.user_id);
    await repo.save();
    await emitRealtime(c.env, 'user.updated', serializePublicUser(user, repo.state) as unknown as Record<string, unknown>, null);
    return successResponse(serializeMe(user, c.env, repo.state));
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
    return successResponse(serializePublicUser(user, repo.state));
  });

  api.get('/users/directory', async (c) => {
    const repo = await loadRepository(c.env);
    return successResponse(Object.values(repo.state.users).filter((item) => item.directory_opt_in).map((user) => serializePublicUser(user, repo.state)));
  });

  api.get('/users/:userId', async (c) => {
    const repo = await loadRepository(c.env);
    const user = repo.state.users[c.req.param('userId')];
    if (!user) return errorResponse('NOT_FOUND', 'User not found', 404);
    return successResponse(serializePublicUser(user, repo.state));
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

  // Account API tokens are deliberately separate from the future AI product.
  // They are retained only for signed, approved service integrations; no model
  // or MCP capability is exposed by this Worker.
  api.get('/api-tokens', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    return Response.json({ tokens: Object.values(repo.state.apiTokens).filter((item) => item.user_id === auth.user_id).map(serializeApiToken) });
  });

  api.post('/api-tokens', async (c) => {
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const body = apiTokenCreateSchema.parse(await c.req.json());
    const rawToken = randomToken('wyvern_api');
    const id = verified.repo.nextId('api_token');
    const token: ApiTokenRecord = { id, user_id: verified.auth.user_id, name: body.name, token_hash: await hashToken(rawToken), created_at: nowIso(), last_used_at: null, revoked_at: null };
    verified.repo.state.apiTokens[id] = token;
    recordUsage(verified.repo, verified.user.id, 'api_token', 1, { resource_id: token.id });
    await verified.repo.save();
    return successResponse({ token: { ...serializeApiToken(token), token: rawToken } });
  });

  api.delete('/api-tokens/:tokenId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const token = repo.state.apiTokens[c.req.param('tokenId')];
    if (!token || token.user_id !== auth.user_id) return errorResponse('NOT_FOUND', 'API token not found', 404);
    token.revoked_at = nowIso();
    await repo.save();
    return successResponse({ revoked: true });
  });

  api.post('/api-tokens/:tokenId/rotate', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const token = repo.state.apiTokens[c.req.param('tokenId')];
    if (!token || token.user_id !== auth.user_id) return errorResponse('NOT_FOUND', 'API token not found', 404);
    const rawToken = randomToken('wyvern_api');
    token.token_hash = await hashToken(rawToken);
    token.last_used_at = nowIso();
    await repo.save();
    return successResponse({ token: { ...serializeApiToken(token), token: rawToken } });
  });

  api.post('/api-tokens/revoke-all', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    for (const token of Object.values(repo.state.apiTokens)) if (token.user_id === auth.user_id) token.revoked_at = nowIso();
    await repo.save();
    return successResponse({ revoked: true });
  });

  api.post('/api-tokens/rotate-all', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const rotated = [] as Array<{ id: string; token: string }>;
    for (const token of Object.values(repo.state.apiTokens)) {
      if (token.user_id === auth.user_id && !token.revoked_at) {
        const raw = randomToken('wyvern_api');
        token.token_hash = await hashToken(raw);
        token.last_used_at = nowIso();
        rotated.push({ id: token.id, token: raw });
      }
    }
    await repo.save();
    return successResponse({ rotated });
  });

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
    if (activeServerBan(repo.state, serverId, auth.user_id)) return errorResponse('FORBIDDEN', 'You are banned from this server', 403);
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
    if (!canManageServerSettings(repo.state, serverId, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
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
    if (activeServerBan(repo.state, server.id, auth.user_id)) return errorResponse('FORBIDDEN', 'You are banned from this server', 403);
    const membership = { server_id: server.id, user_id: auth.user_id, role: 'member' as const, joined_at: nowIso() };
    repo.state.serverMembers[memberKey(server.id, auth.user_id)] = membership;
    await repo.save();
    return successResponse({ server: serializeServer(repo.state, server, auth.user_id), membership });
  });

  api.post('/servers/:serverId/leave', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const serverId = c.req.param('serverId');
    const server = repo.state.servers[serverId];
    if (!server) return errorResponse('NOT_FOUND', 'Server not found', 404);
    if (server.owner_id === auth.user_id) return errorResponse('HTTP_ERROR', 'Transfer ownership or delete the server before leaving it', 409);
    delete repo.state.serverMembers[memberKey(serverId, auth.user_id)];
    await repo.save();
    return successResponse({ left: true });
  });

  api.get('/servers/:serverId/members', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const serverId = c.req.param('serverId');
    if (!canManageServerSettings(repo.state, serverId, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    return successResponse(
      listServerMembers(repo.state, serverId).map((item) => {
        const user = repo.state.users[item.user_id];
        const serialized = user ? serializePublicUser(user, repo.state) : null;
        return {
          ...item,
          user: serialized,
          display_name: serialized?.display_name || null,
          username: serialized?.username || null,
          discriminator: serialized?.discriminator || null,
          avatar: serialized?.avatar || null,
        };
      }),
    );
  });

  api.patch('/servers/:serverId/members/:userId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const serverId = c.req.param('serverId');
    if (!canManageServerSettings(repo.state, serverId, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    const membership = repo.state.serverMembers[memberKey(serverId, c.req.param('userId'))];
    if (!membership) return errorResponse('NOT_FOUND', 'Membership not found', 404);
    if (!canActOnServerMember(repo.state, serverId, auth.user_id, membership.user_id)) return errorResponse('FORBIDDEN', 'You cannot change this member\'s role', 403);
    const nextRole = c.req.query('role') || 'member';
    if (!['admin', 'moderator', 'member'].includes(nextRole)) return errorResponse('HTTP_ERROR', 'Role must be admin, moderator, or member', 400);
    const actor = activeMember(repo.state, serverId, auth.user_id)!;
    if (memberRoleRank(nextRole as MemberRole) >= memberRoleRank(actor.role)) return errorResponse('FORBIDDEN', 'You cannot grant a role equal to or above your own', 403);
    membership.role = nextRole as MemberRole;
    await repo.save();
    const user = repo.state.users[membership.user_id];
    const serialized = user ? serializePublicUser(user, repo.state) : null;
    return successResponse({
      ...membership,
      user: serialized,
      display_name: serialized?.display_name || null,
      username: serialized?.username || null,
      discriminator: serialized?.discriminator || null,
      avatar: serialized?.avatar || null,
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
    if (!canManageServerSettings(repo.state, serverId, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
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
    const limited = await enforceRateLimit(c, 'messages', auth.user_id, 5, 1);
    if (limited) return limited;
    const repo = await loadRepository(c.env);
    const channel = repo.state.channels[c.req.param('channelId')];
    if (!channel) return errorResponse('NOT_FOUND', 'Channel not found', 404);
    if (!canAccessChannel(repo.state, channel.id, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    if (channel.server_id && activeServerTimeout(repo.state, channel.server_id, auth.user_id)) return errorResponse('SERVER_TIMEOUT_ACTIVE', 'You are temporarily timed out in this server', 403);
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
    if (!isRuntimeFeatureEnabled(repo, c.env, 'community_tools_enabled')) return featureDisabledResponse('Community tools');
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
    const messageChannel = repo.state.channels[message.channel_id];
    if (messageChannel?.server_id && activeServerTimeout(repo.state, messageChannel.server_id, auth.user_id)) return errorResponse('SERVER_TIMEOUT_ACTIVE', 'You are temporarily timed out in this server', 403);
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

  api.post('/reports', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const limited = await enforceRateLimit(c, 'reports', auth.user_id, 5, 60);
    if (limited) return limited;
    const payload = reportCreateSchema.parse(await c.req.json());
    const repo = await loadRepository(c.env);
    let reportedUserId: string;
    let scope: ReportRecord['scope'];
    let serverId: string | null;
    let reportedMemberRole: MemberRole | null = null;
    let snapshot: ReportRecord['message_snapshot'] = null;
    if (payload.target_type === 'message') {
      const message = repo.state.messages[payload.target_id];
      if (!message) return errorResponse('NOT_FOUND', 'Message not found', 404);
      if (!canAccessChannel(repo.state, message.channel_id, auth.user_id)) return errorResponse('FORBIDDEN', 'You cannot report a message you cannot access', 403);
      if (message.author_id === auth.user_id) return errorResponse('HTTP_ERROR', 'You cannot report your own message', 400);
      const channel = repo.state.channels[message.channel_id];
      const server = channel?.server_id ? repo.state.servers[channel.server_id] : null;
      const author = repo.state.users[message.author_id];
      reportedUserId = message.author_id;
      serverId = channel?.server_id || null;
      scope = serverId ? 'server' : 'platform';
      reportedMemberRole = serverId ? recordedTargetRole(repo.state, serverId, reportedUserId) : null;
      snapshot = {
        message_id: message.id,
        channel_id: message.channel_id,
        server_id: serverId,
        author_id: message.author_id,
        author_display_name: author?.display_name || null,
        author_username: author?.username || null,
        channel_name: channel?.name || null,
        server_name: server?.name || null,
        content: message.content,
        attachments: [...message.attachments],
        created_at: message.created_at,
        edited_at: message.edited_at,
        is_nsfw: message.is_nsfw,
        webhook_name: message.webhook_name,
      };
    } else {
      const target = repo.state.users[payload.target_id];
      if (!target) return errorResponse('NOT_FOUND', 'User not found', 404);
      if (target.id === auth.user_id) return errorResponse('HTTP_ERROR', 'You cannot report your own profile', 400);
      reportedUserId = target.id;
      serverId = null;
      scope = 'platform';
    }
    const dedupeKey = await sha256(`${auth.user_id}:${payload.target_type}:${payload.target_id}`);
    const duplicate = Object.values(repo.state.reports).find((item) => item.dedupe_key === dedupeKey);
    if (duplicate) return errorResponse('DUPLICATE_REPORT', 'You have already reported this target', 409, { report_id: duplicate.id });
    const now = nowIso();
    const report: ReportRecord = {
      id: repo.nextId('report'),
      reporter_user_id: auth.user_id,
      target_type: payload.target_type,
      target_id: payload.target_id,
      reported_user_id: reportedUserId,
      scope,
      server_id: serverId,
      reported_member_role: reportedMemberRole,
      reason: payload.reason,
      details: payload.details?.trim() || null,
      message_snapshot: snapshot,
      dedupe_key: dedupeKey,
      status: 'open',
      assigned_to_user_id: null,
      resolution_reason: null,
      resolved_at: null,
      resolved_by_user_id: null,
      created_at: now,
      updated_at: now,
    };
    repo.state.reports[report.id] = report;
    addReportAudit(repo, report.id, auth.user_id, 'created', { scope, server_id: serverId, target_type: report.target_type, target_id: report.target_id });
    await repo.save();
    return successResponse({ report_id: report.id, created_at: report.created_at }, 201);
  });

  api.get('/reports/:reportId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const report = repo.state.reports[c.req.param('reportId')];
    if (!report) return errorResponse('NOT_FOUND', 'Report not found', 404);
    if (!reportCanBeReviewedBy(repo.state, report, auth.user_id, c.env)) return errorResponse('FORBIDDEN', 'Moderator access required', 403);
    return successResponse(serializeReport(repo.state, report, true));
  });

  api.patch('/reports/:reportId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const report = repo.state.reports[c.req.param('reportId')];
    if (!report) return errorResponse('NOT_FOUND', 'Report not found', 404);
    if (!reportCanBeReviewedBy(repo.state, report, auth.user_id, c.env)) return errorResponse('FORBIDDEN', 'Moderator access required', 403);
    const payload = reportUpdateSchema.parse(await c.req.json());
    if (payload.assigned_to_user_id !== undefined && payload.assigned_to_user_id !== null) {
      const assignee = repo.state.users[payload.assigned_to_user_id];
      if (!assignee) return errorResponse('NOT_FOUND', 'Assignee not found', 404);
      if (report.scope === 'server' && report.server_id && !reportCanBeReviewedBy(repo.state, report, assignee.id, c.env)) return errorResponse('FORBIDDEN', 'Assignee cannot review this report under server hierarchy', 403);
      if (report.scope === 'platform' && !isAdmin(assignee, c.env)) return errorResponse('FORBIDDEN', 'Assignee must be a platform admin', 403);
    }
    const nextStatus = payload.status || report.status;
    const nextResolution = payload.resolution_reason === undefined ? report.resolution_reason : payload.resolution_reason?.trim() || null;
    if (['actioned', 'dismissed'].includes(nextStatus) && !nextResolution) return errorResponse('HTTP_ERROR', 'A resolution reason is required when closing a report', 400);
    if (payload.status !== undefined) report.status = payload.status as ReportStatus;
    if (payload.assigned_to_user_id !== undefined) report.assigned_to_user_id = payload.assigned_to_user_id;
    if (payload.resolution_reason !== undefined) report.resolution_reason = nextResolution;
    if (['actioned', 'dismissed'].includes(report.status)) {
      report.resolved_at = nowIso();
      report.resolved_by_user_id = auth.user_id;
    } else {
      report.resolved_at = null;
      report.resolved_by_user_id = null;
    }
    report.updated_at = nowIso();
    addReportAudit(repo, report.id, auth.user_id, 'updated', { status: report.status, assigned_to_user_id: report.assigned_to_user_id, resolved: !!report.resolved_at });
    await repo.save();
    return successResponse(serializeReport(repo.state, report, true));
  });

  api.post('/reports/:reportId/notes', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const report = repo.state.reports[c.req.param('reportId')];
    if (!report) return errorResponse('NOT_FOUND', 'Report not found', 404);
    if (!reportCanBeReviewedBy(repo.state, report, auth.user_id, c.env)) return errorResponse('FORBIDDEN', 'Moderator access required', 403);
    const payload = reportNoteSchema.parse(await c.req.json());
    const note = { id: repo.nextId('report_note'), report_id: report.id, author_user_id: auth.user_id, body: payload.body, created_at: nowIso() };
    repo.state.reportNotes[note.id] = note;
    report.updated_at = nowIso();
    addReportAudit(repo, report.id, auth.user_id, 'note_added', { note_id: note.id });
    await repo.save();
    return successResponse(note, 201);
  });

  api.get('/servers/:serverId/moderation/reports', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const serverId = c.req.param('serverId');
    if (!canModerateServer(repo.state, serverId, auth.user_id)) return errorResponse('FORBIDDEN', 'Moderator access required', 403);
    const status = c.req.query('status');
    const items = Object.values(repo.state.reports)
      .filter((item) => item.scope === 'server' && item.server_id === serverId && (!status || item.status === status) && reportCanBeReviewedBy(repo.state, item, auth.user_id, c.env))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .map((item) => serializeReport(repo.state, item, true));
    return successResponse({ items });
  });

  api.get('/admin/reports', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const status = c.req.query('status');
    const items = Object.values(admin.repo.state.reports)
      .filter((item) => item.scope === 'platform' && (!status || item.status === status))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .map((item) => serializeReport(admin.repo.state, item, true));
    return successResponse({ items });
  });

  api.get('/servers/:serverId/moderation/members', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const serverId = c.req.param('serverId');
    if (!canModerateServer(repo.state, serverId, auth.user_id)) return errorResponse('FORBIDDEN', 'Moderator access required', 403);
    const items = listServerMembers(repo.state, serverId).map((membership) => {
      const user = repo.state.users[membership.user_id];
      return {
        ...membership,
        user: user ? serializePublicUser(user, repo.state) : null,
        warnings: Object.values(repo.state.serverWarnings).filter((item) => item.server_id === serverId && item.user_id === membership.user_id),
        timeout: activeServerTimeout(repo.state, serverId, membership.user_id) || null,
      };
    });
    return successResponse({ items });
  });

  api.get('/servers/:serverId/moderation/actions', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const serverId = c.req.param('serverId');
    if (!canModerateServer(repo.state, serverId, auth.user_id)) return errorResponse('FORBIDDEN', 'Moderator access required', 403);
    const items = Object.values(repo.state.serverModerationActions)
      .filter((item) => item.server_id === serverId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map((item) => serializeServerModerationAction(repo.state, item));
    return successResponse({ items });
  });

  api.post('/servers/:serverId/moderation/warn', async (c) => {
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const { auth, repo } = verified;
    const serverId = c.req.param('serverId');
    const payload = serverModerationTargetSchema.parse(await c.req.json());
    if (!canActOnServerMember(repo.state, serverId, auth.user_id, payload.user_id)) return errorResponse('FORBIDDEN', 'You cannot moderate this member', 403);
    const warningId = repo.nextId('server_warning');
    const action = addServerModerationAction(repo, {
      server_id: serverId,
      actor_user_id: auth.user_id,
      target_user_id: payload.user_id,
      action: 'warn',
      reason: payload.reason,
      message_id: null,
      warning_id: warningId,
      timeout_id: null,
      ban_id: null,
      affected_object_ids: [payload.user_id, warningId],
      action_metadata: null,
    });
    const warning: ServerWarning = { id: warningId, server_id: serverId, user_id: payload.user_id, actor_user_id: auth.user_id, action_id: action.id, reason: payload.reason, created_at: action.created_at };
    repo.state.serverWarnings[warning.id] = warning;
    await repo.save();
    return successResponse({ warning, action: serializeServerModerationAction(repo.state, action) }, 201);
  });

  api.post('/servers/:serverId/moderation/timeout', async (c) => {
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const { auth, repo } = verified;
    const serverId = c.req.param('serverId');
    const payload = serverTimeoutSchema.parse(await c.req.json());
    const expiresAt = new Date(payload.expires_at);
    const now = Date.now();
    if (expiresAt.getTime() <= now || expiresAt.getTime() > now + 28 * 86400_000) return errorResponse('HTTP_ERROR', 'Timeout must end between now and 28 days from now', 400);
    if (!canActOnServerMember(repo.state, serverId, auth.user_id, payload.user_id)) return errorResponse('FORBIDDEN', 'You cannot moderate this member', 403);
    const timeoutId = repo.nextId('server_timeout');
    const action = addServerModerationAction(repo, {
      server_id: serverId,
      actor_user_id: auth.user_id,
      target_user_id: payload.user_id,
      action: 'timeout',
      reason: payload.reason,
      message_id: null,
      warning_id: null,
      timeout_id: timeoutId,
      ban_id: null,
      affected_object_ids: [payload.user_id, timeoutId],
      action_metadata: { expires_at: expiresAt.toISOString() },
    });
    const timeout: ServerTimeout = { id: timeoutId, server_id: serverId, user_id: payload.user_id, actor_user_id: auth.user_id, action_id: action.id, reason: payload.reason, started_at: action.created_at, expires_at: expiresAt.toISOString(), revoked_at: null, revoked_by_user_id: null };
    repo.state.serverTimeouts[timeout.id] = timeout;
    await repo.save();
    await revokeRealtimeVoiceParticipation(c.env, repo.state, serverId, payload.user_id);
    return successResponse({ timeout, action: serializeServerModerationAction(repo.state, action) }, 201);
  });

  api.post('/servers/:serverId/moderation/untimeout', async (c) => {
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const { auth, repo } = verified;
    const serverId = c.req.param('serverId');
    const payload = serverModerationTargetSchema.parse(await c.req.json());
    const timeout = activeServerTimeout(repo.state, serverId, payload.user_id);
    if (!timeout) return errorResponse('NOT_FOUND', 'No active timeout found', 404);
    if (!canActOnServerMember(repo.state, serverId, auth.user_id, payload.user_id)) return errorResponse('FORBIDDEN', 'You cannot moderate this member', 403);
    const action = addServerModerationAction(repo, {
      server_id: serverId,
      actor_user_id: auth.user_id,
      target_user_id: payload.user_id,
      action: 'untimeout',
      reason: payload.reason,
      message_id: null,
      warning_id: null,
      timeout_id: timeout.id,
      ban_id: null,
      affected_object_ids: [payload.user_id, timeout.id],
      action_metadata: null,
    });
    timeout.revoked_at = action.created_at;
    timeout.revoked_by_user_id = auth.user_id;
    await repo.save();
    return successResponse({ timeout, action: serializeServerModerationAction(repo.state, action) });
  });

  api.post('/servers/:serverId/moderation/kick', async (c) => {
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const { auth, repo } = verified;
    const serverId = c.req.param('serverId');
    const payload = serverModerationTargetSchema.parse(await c.req.json());
    if (!canActOnServerMember(repo.state, serverId, auth.user_id, payload.user_id)) return errorResponse('FORBIDDEN', 'You cannot moderate this member', 403);
    const action = addServerModerationAction(repo, {
      server_id: serverId,
      actor_user_id: auth.user_id,
      target_user_id: payload.user_id,
      action: 'kick',
      reason: payload.reason,
      message_id: null,
      warning_id: null,
      timeout_id: null,
      ban_id: null,
      affected_object_ids: [payload.user_id],
      action_metadata: null,
    });
    delete repo.state.serverMembers[memberKey(serverId, payload.user_id)];
    await repo.save();
    await emitRealtime(c.env, 'server.member.removed', { server_id: serverId, user_id: payload.user_id, action: 'kick' }, null);
    return successResponse({ kicked: true, action: serializeServerModerationAction(repo.state, action) });
  });

  api.post('/servers/:serverId/moderation/ban', async (c) => {
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const { auth, repo } = verified;
    const serverId = c.req.param('serverId');
    const payload = serverModerationTargetSchema.parse(await c.req.json());
    if (!canActOnServerMember(repo.state, serverId, auth.user_id, payload.user_id)) return errorResponse('FORBIDDEN', 'You cannot moderate this member', 403);
    const existing = activeServerBan(repo.state, serverId, payload.user_id);
    if (existing) return errorResponse('HTTP_ERROR', 'This member is already banned', 409);
    const banId = repo.nextId('server_ban');
    const action = addServerModerationAction(repo, {
      server_id: serverId,
      actor_user_id: auth.user_id,
      target_user_id: payload.user_id,
      action: 'ban',
      reason: payload.reason,
      message_id: null,
      warning_id: null,
      timeout_id: null,
      ban_id: banId,
      affected_object_ids: [payload.user_id, banId],
      action_metadata: null,
    });
    const ban: ServerBan = { id: banId, server_id: serverId, user_id: payload.user_id, actor_user_id: auth.user_id, action_id: action.id, reason: payload.reason, created_at: action.created_at, unbanned_at: null, unbanned_by_user_id: null, unban_reason: null };
    repo.state.serverBans[ban.id] = ban;
    delete repo.state.serverMembers[memberKey(serverId, payload.user_id)];
    await repo.save();
    await emitRealtime(c.env, 'server.member.removed', { server_id: serverId, user_id: payload.user_id, action: 'ban' }, null);
    return successResponse({ ban, action: serializeServerModerationAction(repo.state, action) }, 201);
  });

  api.post('/servers/:serverId/moderation/unban', async (c) => {
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const { auth, repo } = verified;
    const serverId = c.req.param('serverId');
    const payload = serverModerationTargetSchema.parse(await c.req.json());
    if (!canModerateServer(repo.state, serverId, auth.user_id) || auth.user_id === payload.user_id) return errorResponse('FORBIDDEN', 'You cannot moderate this member', 403);
    const ban = activeServerBan(repo.state, serverId, payload.user_id);
    if (!ban) return errorResponse('NOT_FOUND', 'No active ban found', 404);
    const banAction = repo.state.serverModerationActions[ban.action_id];
    const bannedRole = banAction?.action_metadata?.target_role;
    const targetRole = bannedRole === 'owner' || bannedRole === 'admin' || bannedRole === 'moderator' || bannedRole === 'member' ? bannedRole : null;
    if (!canActOnFormerServerMember(repo.state, serverId, auth.user_id, payload.user_id, targetRole)) return errorResponse('FORBIDDEN', 'You cannot moderate this member', 403);
    const action = addServerModerationAction(repo, {
      server_id: serverId,
      actor_user_id: auth.user_id,
      target_user_id: payload.user_id,
      action: 'unban',
      reason: payload.reason,
      message_id: null,
      warning_id: null,
      timeout_id: null,
      ban_id: ban.id,
      affected_object_ids: [payload.user_id, ban.id],
      action_metadata: null,
    });
    ban.unbanned_at = action.created_at;
    ban.unbanned_by_user_id = auth.user_id;
    ban.unban_reason = payload.reason;
    await repo.save();
    return successResponse({ ban, action: serializeServerModerationAction(repo.state, action) });
  });

  api.delete('/servers/:serverId/moderation/messages/:messageId', async (c) => {
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const { auth, repo } = verified;
    const serverId = c.req.param('serverId');
    const message = repo.state.messages[c.req.param('messageId')];
    if (!message) return errorResponse('NOT_FOUND', 'Message not found', 404);
    const channel = repo.state.channels[message.channel_id];
    if (!channel || channel.server_id !== serverId) return errorResponse('NOT_FOUND', 'Message does not belong to this server', 404);
    if (!canModerateServer(repo.state, serverId, auth.user_id)) return errorResponse('FORBIDDEN', 'Moderator access required', 403);
    if (message.author_id === auth.user_id || !canActOnFormerServerMember(repo.state, serverId, auth.user_id, message.author_id)) return errorResponse('FORBIDDEN', 'You cannot moderate this message author', 403);
    const payload = serverModerationMessageSchema.parse(await c.req.json());
    const action = addServerModerationAction(repo, {
      server_id: serverId,
      actor_user_id: auth.user_id,
      target_user_id: message.author_id,
      action: 'delete_message',
      reason: payload.reason,
      message_id: message.id,
      warning_id: null,
      timeout_id: null,
      ban_id: null,
      affected_object_ids: [message.id, message.author_id],
      action_metadata: { channel_id: message.channel_id },
    });
    delete repo.state.messages[message.id];
    queueRealtimeEvent(repo, 'message.deleted', { id: message.id, channel_id: message.channel_id, moderation_action_id: action.id }, message.channel_id, auth.user_id);
    await repo.save();
    await emitRealtime(c.env, 'message.deleted', { id: message.id, channel_id: message.channel_id, moderation_action_id: action.id }, message.channel_id);
    return successResponse({ deleted: true, action: serializeServerModerationAction(repo.state, action) });
  });

  api.get('/messages/pins/channels/:channelId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    if (!isRuntimeFeatureEnabled(repo, c.env, 'community_tools_enabled')) return featureDisabledResponse('Community tools');
    const channelId = c.req.param('channelId');
    if (!canAccessChannel(repo.state, channelId, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    return successResponse(listChannelMessages(repo.state, channelId).filter((item) => item.is_pinned).map((message) => serializeMessage(repo.state, message, auth.user_id)));
  });
  api.put('/messages/:messageId/pin', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    if (!isRuntimeFeatureEnabled(repo, c.env, 'community_tools_enabled')) return featureDisabledResponse('Community tools');
    const message = repo.state.messages[c.req.param('messageId')];
    if (!message) return errorResponse('NOT_FOUND', 'Message not found', 404);
    if (!canPinMessage(repo.state, message, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    message.is_pinned = true;
    await repo.save();
    return successResponse(serializeMessage(repo.state, message, auth.user_id));
  });
  api.delete('/messages/:messageId/pin', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    if (!isRuntimeFeatureEnabled(repo, c.env, 'community_tools_enabled')) return featureDisabledResponse('Community tools');
    const message = repo.state.messages[c.req.param('messageId')];
    if (!message) return errorResponse('NOT_FOUND', 'Message not found', 404);
    if (!canPinMessage(repo.state, message, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    message.is_pinned = false;
    await repo.save();
    return successResponse(serializeMessage(repo.state, message, auth.user_id));
  });
  api.get('/messages/bookmarks', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    if (!isRuntimeFeatureEnabled(repo, c.env, 'community_tools_enabled')) return featureDisabledResponse('Community tools');
    const items = Object.values(repo.state.messageBookmarks)
      .filter((item) => item.user_id === auth.user_id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((bookmark) => {
        const message = repo.state.messages[bookmark.message_id];
        return message && canAccessChannel(repo.state, message.channel_id, auth.user_id) ? {
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
    if (!isRuntimeFeatureEnabled(repo, c.env, 'community_tools_enabled')) return featureDisabledResponse('Community tools');
    const message = repo.state.messages[c.req.param('messageId')];
    if (!message) return errorResponse('NOT_FOUND', 'Message not found', 404);
    if (!canAccessChannel(repo.state, message.channel_id, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
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
    if (!isRuntimeFeatureEnabled(repo, c.env, 'community_tools_enabled')) return featureDisabledResponse('Community tools');
    const message = repo.state.messages[c.req.param('messageId')];
    if (!message) return errorResponse('NOT_FOUND', 'Message not found', 404);
    if (!canAccessChannel(repo.state, message.channel_id, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    for (const [key, bookmark] of Object.entries(repo.state.messageBookmarks)) {
      if (bookmark.user_id === auth.user_id && bookmark.message_id === message.id) delete repo.state.messageBookmarks[key];
    }
    await repo.save();
    return successResponse({ bookmarked: false, message: serializeMessage(repo.state, message, auth.user_id) });
  });
  api.put('/messages/:messageId/reactions', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const message = repo.state.messages[c.req.param('messageId')];
    if (!message) return errorResponse('NOT_FOUND', 'Message not found', 404);
    const channel = repo.state.channels[message.channel_id];
    if (!canAccessChannel(repo.state, message.channel_id, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    if (channel?.server_id && activeServerTimeout(repo.state, channel.server_id, auth.user_id)) return errorResponse('SERVER_TIMEOUT_ACTIVE', 'You are temporarily timed out in this server', 403);
    const payload = reactionSchema.parse(await c.req.json());
    repo.state.reactions[reactionKey(message.id, payload.emoji, auth.user_id)] = { message_id: message.id, emoji: payload.emoji, user_id: auth.user_id };
    queueRealtimeEvent(repo, 'reaction.added', { message_id: message.id, emoji: payload.emoji, user_id: auth.user_id, channel_id: message.channel_id }, message.channel_id, auth.user_id);
    await repo.save();
    await emitRealtime(c.env, 'reaction.added', { message_id: message.id, emoji: payload.emoji, user_id: auth.user_id, channel_id: message.channel_id }, message.channel_id);
    return successResponse(serializeMessage(repo.state, message));
  });
  api.delete('/messages/:messageId/reactions', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const message = repo.state.messages[c.req.param('messageId')];
    if (!message) return errorResponse('NOT_FOUND', 'Message not found', 404);
    const channel = repo.state.channels[message.channel_id];
    if (!canAccessChannel(repo.state, message.channel_id, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    if (channel?.server_id && activeServerTimeout(repo.state, channel.server_id, auth.user_id)) return errorResponse('SERVER_TIMEOUT_ACTIVE', 'You are temporarily timed out in this server', 403);
    const emoji = c.req.query('emoji') || '';
    delete repo.state.reactions[reactionKey(message.id, emoji, auth.user_id)];
    queueRealtimeEvent(repo, 'reaction.removed', { message_id: message.id, emoji, user_id: auth.user_id, channel_id: message.channel_id }, message.channel_id, auth.user_id);
    await repo.save();
    await emitRealtime(c.env, 'reaction.removed', { message_id: message.id, emoji, user_id: auth.user_id, channel_id: message.channel_id }, message.channel_id);
    return successResponse(serializeMessage(repo.state, message));
  });

  api.post('/uploads', async (c) => {
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const { auth, repo, user } = verified;
    if (!isRuntimeFeatureEnabled(repo, c.env, 'uploads_enabled')) return featureDisabledResponse('Uploads');
    if (activeTimeoutForUser(repo.state, auth.user_id)) return errorResponse('SERVER_TIMEOUT_ACTIVE', 'You are temporarily unable to upload while timed out in a server', 403);
    const limits = limitsForUser(c.env, user);
    const limited = await enforceRateLimit(c, 'uploads', auth.user_id, Math.min(limits.uploads_per_day, 10), 60);
    if (limited) return limited;
    if (uploadsTodayForUser(repo.state, auth.user_id) >= limits.uploads_per_day) {
      return errorResponse('USAGE_LIMIT_EXCEEDED', 'You have reached your daily upload limit', 429, { limit: limits.uploads_per_day, period: 'day' });
    }
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file') as File | string | null | undefined;
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') return errorResponse('HTTP_ERROR', 'Missing upload file', 400);
    if (!isAllowedUpload(file.type, file.name)) return errorResponse('HTTP_ERROR', 'Unsupported file type', 400);

    const bodyBytes = new Uint8Array(await file.arrayBuffer());
    if (bodyBytes.byteLength > limits.max_file_bytes) return errorResponse('USAGE_LIMIT_EXCEEDED', 'This file exceeds your upload size limit', 413, { limit: limits.max_file_bytes, tier: hasPremiumAccess(c.env, user) ? 'premium' : 'free' });
    const currentStorageBytes = storageBytesForUser(repo.state, auth.user_id);
    if (currentStorageBytes + bodyBytes.byteLength > limits.total_storage_bytes) return errorResponse('USAGE_LIMIT_EXCEEDED', 'This upload exceeds your storage limit', 413, { limit: limits.total_storage_bytes, used: currentStorageBytes, tier: hasPremiumAccess(c.env, user) ? 'premium' : 'free' });

    if (!c.env.MEDIA_BUCKET && getConfig(c.env).environment === 'production') {
      return errorResponse('STORAGE_UNAVAILABLE', 'Uploads are temporarily unavailable because object storage is not configured', 503);
    }

    const safeName = sanitizeUploadFilename(file.name);
    const uploadId = `${crypto.randomUUID()}-${safeName}`;
    // R2 is the production source of truth. Keep a small in-memory fallback
    // only for local/test bindings so large tier uploads never inflate the
    // Durable Object state snapshot.
    const bodyBase64 = c.env.MEDIA_BUCKET ? '' : encodeMediaBytes(bodyBytes);
    const scannerConfigured = !!(getConfig(c.env).malwareScannerUrl && getConfig(c.env).malwareScannerSecret);
    const downloadToken = scannerConfigured ? randomToken('scan') : null;
    const finalPath = `/media/${auth.user_id}/${uploadId}`;
    const media: MediaObjectRecord = {
      id: uploadId,
      owner_user_id: auth.user_id,
      path: finalPath,
      storage_key: scannerConfigured ? `quarantine/${auth.user_id}/${uploadId}` : finalPath.replace(/^\//, ''),
      filename: file.name || safeName,
      content_type: file.type || 'application/octet-stream',
      size: bodyBytes.byteLength,
      body_base64: bodyBase64,
      uploaded_at: nowIso(),
      scan_status: scannerConfigured ? 'pending' : 'skipped',
      scan_error: null,
      scanned_at: scannerConfigured ? null : nowIso(),
      scan_download_token_hash: downloadToken ? await hashToken(downloadToken) : null,
      scan_download_consumed_at: null,
    };
    repo.state.mediaObjects[uploadId] = media;
    recordUsage(repo, auth.user_id, 'storage_bytes', bodyBytes.byteLength, { resource_id: uploadId, usage_metadata: { filename: media.filename } });
    recordUsage(repo, auth.user_id, 'upload', 1, { resource_id: uploadId });
    await saveMediaObject(c.env, media, bodyBytes);
    if (c.env.MEDIA_BUCKET) media.body_base64 = '';
    await repo.save();
    if (scannerConfigured && downloadToken) {
      c.executionCtx.waitUntil(requestMalwareScan(c.env, new URL(c.req.url).origin, media, downloadToken));
    }
    return successResponse(serializeUpload(media), scannerConfigured ? 202 : 200);
  });

  api.get('/uploads/:uploadId', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    const media = repo.state.mediaObjects[c.req.param('uploadId')];
    if (!media) return errorResponse('NOT_FOUND', 'Upload not found', 404);
    const user = repo.state.users[auth.user_id];
    if (media.owner_user_id !== auth.user_id && (!user || !isAdmin(user, c.env))) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    return successResponse(serializeUpload(media));
  });

  api.get('/internal/uploads/:uploadId/scan-download', async (c) => {
    const token = c.req.query('token') || '';
    const repo = await loadRepository(c.env);
    const media = repo.state.mediaObjects[c.req.param('uploadId')];
    if (!media || media.scan_status !== 'pending' || !media.scan_download_token_hash) return errorResponse('NOT_FOUND', 'Pending upload not found', 404);
    if (media.scan_download_consumed_at || await hashToken(token) !== media.scan_download_token_hash) return errorResponse('UNAUTHORIZED', 'Invalid or consumed scan token', 401);
    media.scan_download_consumed_at = nowIso();
    await repo.save();
    const bytes = await loadMediaBytes(c.env, media);
    return new Response(bytes, {
      headers: {
        'content-type': media.content_type,
        'content-length': String(media.size),
        'cache-control': 'private, no-store',
        'content-disposition': `attachment; filename="${sanitizeUploadFilename(media.filename)}"`,
      },
    });
  });

  api.post('/internal/uploads/scan-result', async (c) => {
    const secret = getConfig(c.env).malwareScannerSecret;
    if (!secret) return errorResponse('HTTP_ERROR', 'Malware scanner is not configured', 503);
    const rawBody = await c.req.arrayBuffer();
    try {
      await verifyBridgeSignature(
        secret,
        rawBody,
        c.req.header('X-Wyvern-Scan-Timestamp') || null,
        c.req.header('X-Wyvern-Scan-Signature') || null,
      );
    } catch (error) {
      return errorResponse('UNAUTHORIZED', (error as Error).message, 401);
    }
    const payload = scanResultSchema.parse(JSON.parse(new TextDecoder().decode(rawBody)));
    const repo = await loadRepository(c.env);
    const media = repo.state.mediaObjects[payload.upload_id];
    if (!media) return errorResponse('NOT_FOUND', 'Upload not found', 404);
    if (media.scan_status !== 'pending' && media.scan_status !== 'error') {
      return successResponse({ upload_id: media.id, scan_status: media.scan_status, unchanged: true });
    }
    if (payload.verdict === 'clean') {
      await publishQuarantinedMedia(c.env, media);
      media.scan_status = 'clean';
      media.scan_error = null;
    } else if (payload.verdict === 'infected') {
      await deleteMediaBytes(c.env, media);
      media.scan_status = 'infected';
      media.scan_error = payload.error || 'Malware scanner rejected the upload';
    } else {
      media.scan_status = 'error';
      media.scan_error = payload.error || 'Malware scanner failed';
    }
    media.scanned_at = nowIso();
    media.scan_download_token_hash = null;
    await repo.save();
    return successResponse(serializeUpload(media));
  });

  api.get('/servers/:serverId/webhooks', async (c) => {
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const { auth, repo } = verified;
    const serverId = c.req.param('serverId');
    if (!canManageServerSettings(repo.state, serverId, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    if (activeServerTimeout(repo.state, serverId, auth.user_id)) return errorResponse('SERVER_TIMEOUT_ACTIVE', 'You are temporarily unable to manage webhooks while timed out in this server', 403);
    return successResponse({ items: Object.values(repo.state.webhooks).filter((item) => item.server_id === serverId).map((item) => serializeWebhook(item)) });
  });

  api.post('/servers/:serverId/webhooks', async (c) => {
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const { auth, repo } = verified;
    if (!isRuntimeFeatureEnabled(repo, c.env, 'webhooks_enabled')) return featureDisabledResponse('Webhooks');
    const serverId = c.req.param('serverId');
    if (!canManageServerSettings(repo.state, serverId, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    if (activeServerTimeout(repo.state, serverId, auth.user_id)) return errorResponse('SERVER_TIMEOUT_ACTIVE', 'You are temporarily unable to manage webhooks while timed out in this server', 403);
    const server = repo.state.servers[serverId];
    if (!server) return errorResponse('NOT_FOUND', 'Server not found', 404);
    const owner = repo.state.users[server.owner_id];
    const tierLimits = owner ? limitsForUser(c.env, owner) : getConfig(c.env).freeTierLimits;
    const currentCount = Object.values(repo.state.webhooks).filter((item) => item.server_id === serverId).length;
    if (currentCount >= tierLimits.webhooks_per_server) return errorResponse('USAGE_LIMIT_EXCEEDED', 'This server has reached its webhook limit', 429, { limit: tierLimits.webhooks_per_server, tier: owner && hasPremiumAccess(c.env, owner) ? 'premium' : 'free' });
    const payload = webhookCreateSchema.parse(await c.req.json());
    const channel = repo.state.channels[payload.channel_id];
    if (!channel || channel.server_id !== serverId) return errorResponse('HTTP_ERROR', 'Webhook channel must belong to this server', 400);
    const token = randomToken('wh');
    const webhook: WebhookRecord = { id: repo.nextId('webhook'), server_id: serverId, channel_id: payload.channel_id, name: payload.name, description: payload.description ?? null, active: true, created_by: auth.user_id, created_at: nowIso(), updated_at: nowIso(), last_used_at: null, token_hash: await hashToken(token) };
    repo.state.webhooks[webhook.id] = webhook;
    recordUsage(repo, server.owner_id, 'webhook', 1, { server_id: serverId, resource_id: webhook.id });
    await repo.save();
    return successResponse({ webhook: serializeWebhook(webhook), token, webhook_url: `/api/v1/webhooks/${webhook.id}/${token}` });
  });

  api.delete('/webhooks/:webhookId', async (c) => {
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const { auth, repo } = verified;
    if (!isRuntimeFeatureEnabled(repo, c.env, 'webhooks_enabled')) return featureDisabledResponse('Webhooks');
    const webhook = repo.state.webhooks[c.req.param('webhookId')];
    if (!webhook) return errorResponse('NOT_FOUND', 'Webhook not found', 404);
    if (!canManageServerSettings(repo.state, webhook.server_id, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    if (activeServerTimeout(repo.state, webhook.server_id, auth.user_id)) return errorResponse('SERVER_TIMEOUT_ACTIVE', 'You are temporarily unable to manage webhooks while timed out in this server', 403);
    delete repo.state.webhooks[webhook.id];
    await repo.save();
    return successResponse({ deleted: true });
  });

  api.post('/webhooks/:webhookId/rotate', async (c) => {
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const { auth, repo } = verified;
    if (!isRuntimeFeatureEnabled(repo, c.env, 'webhooks_enabled')) return featureDisabledResponse('Webhooks');
    const webhook = repo.state.webhooks[c.req.param('webhookId')];
    if (!webhook) return errorResponse('NOT_FOUND', 'Webhook not found', 404);
    if (!canManageServerSettings(repo.state, webhook.server_id, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    if (activeServerTimeout(repo.state, webhook.server_id, auth.user_id)) return errorResponse('SERVER_TIMEOUT_ACTIVE', 'You are temporarily unable to manage webhooks while timed out in this server', 403);
    const token = randomToken('wh');
    webhook.token_hash = await hashToken(token);
    webhook.updated_at = nowIso();
    await repo.save();
    return successResponse({ webhook: serializeWebhook(webhook), token, webhook_url: `/api/v1/webhooks/${webhook.id}/${token}` });
  });

  api.post('/webhooks/:webhookId/:token', async (c) => {
    const repo = await loadRepository(c.env);
    if (!isRuntimeFeatureEnabled(repo, c.env, 'webhooks_enabled')) return featureDisabledResponse('Webhooks');
    const webhook = repo.state.webhooks[c.req.param('webhookId')];
    if (!webhook || !webhook.active || await hashToken(c.req.param('token')) !== webhook.token_hash) return errorResponse('UNAUTHORIZED', 'Invalid webhook token', 401);
    if (webhook.created_by && activeServerTimeout(repo.state, webhook.server_id, webhook.created_by)) return errorResponse('FORBIDDEN', 'Webhook owner is temporarily timed out in this server', 403);
    const limited = await enforceRateLimit(c, 'webhooks', webhook.id, 30, 60);
    if (limited) return limited;
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
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const { auth, repo } = verified;
    const webhook = repo.state.webhooks[c.req.param('webhookId')];
    if (!webhook || webhook.server_id !== c.req.param('serverId')) return errorResponse('NOT_FOUND', 'Webhook not found', 404);
    if (!canManageServerSettings(repo.state, webhook.server_id, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    if (activeServerTimeout(repo.state, webhook.server_id, auth.user_id)) return errorResponse('SERVER_TIMEOUT_ACTIVE', 'You are temporarily unable to manage webhooks while timed out in this server', 403);
    return successResponse({ items: Object.values(repo.state.webhookDeliveries).filter((item) => item.webhook_id === c.req.param('webhookId')) });
  });

  api.get('/channels/:channelId/workspace', async (c) => {
    const auth = await requireUser(c);
    if (!auth) return errorResponse('UNAUTHORIZED', 'Missing bearer token', 401);
    const repo = await loadRepository(c.env);
    if (!isRuntimeFeatureEnabled(repo, c.env, 'community_tools_enabled') || !isRuntimeFeatureEnabled(repo, c.env, 'workspaces_enabled')) return featureDisabledResponse('Workspaces');
    const channel = repo.state.channels[c.req.param('channelId')];
    if (!channel) return errorResponse('NOT_FOUND', 'Channel not found', 404);
    if (!canAccessChannel(repo.state, channel.id, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
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
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const { auth, repo } = verified;
    const user = repo.state.users[auth.user_id] || null;
    if (!isRuntimeFeatureEnabled(repo, c.env, 'community_tools_enabled') || !isRuntimeFeatureEnabled(repo, c.env, 'workspaces_enabled')) return featureDisabledResponse('Workspaces');
    const channel = repo.state.channels[c.req.param('channelId')];
    if (!channel) return errorResponse('NOT_FOUND', 'Channel not found', 404);
    if (!canAccessChannel(repo.state, channel.id, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
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
    await ensureWorkspaceGitSnapshot(repo, document, user, `Update ${document.title}`);
    if (payload.log_activity && channel.server_id) {
      const activity: CommunityActivityRecord = { id: repo.nextId('activity'), server_id: channel.server_id, actor_user_id: auth.user_id, action: 'workspace.updated', target_type: 'workspace', target_id: document.id, activity_metadata: { channel_id: channel.id }, created_at: now };
      repo.state.communityActivities[activity.id] = activity;
    }
    const workspacePayload = serializeWorkspace(repo, document);
    queueRealtimeEvent(repo, 'workspace.updated', workspacePayload as unknown as Record<string, unknown>, channel.id, auth.user_id);
    await repo.save();
    return successResponse(workspacePayload);
  });

  api.get('/channels/:channelId/workspace/git', async (c) => {
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const { auth, repo, user } = verified;
    if (!isRuntimeFeatureEnabled(repo, c.env, 'community_tools_enabled') || !isRuntimeFeatureEnabled(repo, c.env, 'workspaces_enabled')) return featureDisabledResponse('Workspaces');
    const channel = repo.state.channels[c.req.param('channelId')];
    if (!channel || channel.type === 'voice') return errorResponse('NOT_FOUND', 'Workspace not found', 404);
    if (!canAccessChannel(repo.state, channel.id, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    const visibility = (c.req.query('visibility') || 'public').trim();
    const document = Object.values(repo.state.workspaceDocuments).find((item) => item.channel_id === channel.id && item.visibility === visibility && (visibility !== 'private' ? item.owner_user_id === null : item.owner_user_id === auth.user_id));
    if (!document) return errorResponse('NOT_FOUND', 'Save this workspace before enabling Git access', 404);
    const snapshot = await ensureWorkspaceGitSnapshot(repo, document, user, `Update ${document.title}`);
    await repo.save();
    return successResponse(serializeWorkspaceGitRepository(snapshot.repository, repo, new URL(c.req.url).origin));
  });

  api.post('/channels/:channelId/workspace/git/credentials', async (c) => {
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const { auth, repo, user } = verified;
    if (!isRuntimeFeatureEnabled(repo, c.env, 'community_tools_enabled') || !isRuntimeFeatureEnabled(repo, c.env, 'workspaces_enabled')) return featureDisabledResponse('Workspaces');
    const channel = repo.state.channels[c.req.param('channelId')];
    if (!channel || channel.type === 'voice') return errorResponse('NOT_FOUND', 'Workspace not found', 404);
    if (!canAccessChannel(repo.state, channel.id, auth.user_id)) return errorResponse('FORBIDDEN', 'Forbidden', 403);
    const visibility = (c.req.query('visibility') || 'public').trim();
    const document = Object.values(repo.state.workspaceDocuments).find((item) => item.channel_id === channel.id && item.visibility === visibility && (visibility !== 'private' ? item.owner_user_id === null : item.owner_user_id === auth.user_id));
    if (!document) return errorResponse('NOT_FOUND', 'Save this workspace before creating a Git credential', 404);
    const body = workspaceGitCredentialSchema.parse(await c.req.json());
    const snapshot = await ensureWorkspaceGitSnapshot(repo, document, user, `Update ${document.title}`);
    const rawToken = randomToken('wyv_git');
    const createdAt = nowIso();
    const credential: WorkspaceGitCredentialRecord = {
      id: repo.nextId('workspace_git_credential'),
      repository_id: snapshot.repository.id,
      user_id: auth.user_id,
      name: body.name,
      scope: body.scope,
      token_hash: await hashToken(rawToken),
      created_at: createdAt,
      expires_at: new Date(Date.now() + body.expires_in_days * 86400_000).toISOString(),
      revoked_at: null,
      last_used_at: null,
    };
    repo.state.workspaceGitCredentials[credential.id] = credential;
    await repo.save();
    return successResponse({ credential: serializeWorkspaceGitCredential(credential), token: rawToken, clone_url: `${new URL(c.req.url).origin}/git/workspaces/${snapshot.repository.slug}.git`, username: 'git', transport: credential.scope === 'write' ? 'smart_http_push_best_effort' : 'dumb_http_read_only' }, 201);
  });

  api.delete('/channels/:channelId/workspace/git/credentials/:credentialId', async (c) => {
    const verified = await requireVerifiedUser(c);
    if (verified instanceof Response) return verified;
    const { auth, repo } = verified;
    const credential = repo.state.workspaceGitCredentials[c.req.param('credentialId')];
    if (!credential || credential.user_id !== auth.user_id) return errorResponse('NOT_FOUND', 'Git credential not found', 404);
    const repository = repo.state.workspaceGitRepositories[credential.repository_id];
    const document = repository ? repo.state.workspaceDocuments[repository.document_id] : null;
    if (!document || document.channel_id !== c.req.param('channelId')) return errorResponse('NOT_FOUND', 'Git credential not found', 404);
    credential.revoked_at = nowIso();
    await repo.save();
    return successResponse({ revoked: true });
  });

  api.get('/admin/overview', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const { repo } = admin;

    const users = Object.values(repo.state.users).map((item) => buildAdminUserSummary(repo.state, item));
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
        message_count: Object.keys(repo.state.messages).length,
        moderated_user_count: Object.values(repo.state.userModerationRecords).filter((item) => item.status !== 'active' || item.redacted_avatar || item.redacted_bio || item.redacted_display_name).length,
        inbox_count: Object.keys(repo.state.mailInboxItems).length,
      }
    });
  });

  api.get('/admin/users', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const query = adminUserQuerySchema.parse({
      q: c.req.query('q') || undefined,
      status: c.req.query('status') || undefined,
      directory: c.req.query('directory') || undefined,
      avatar: c.req.query('avatar') || undefined,
      created_from: c.req.query('created_from') || undefined,
      created_to: c.req.query('created_to') || undefined,
    });
    const items = Object.values(admin.repo.state.users)
      .filter((user) => adminUserMatchesFilters(user, getModerationRecord(admin.repo.state, user.id), query))
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map((user) => buildAdminUserSummary(admin.repo.state, user));
    return successResponse({
      items,
      total: items.length,
      filters: query,
    });
  });

  api.get('/admin/users/:userId', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const user = admin.repo.state.users[c.req.param('userId')];
    if (!user) return errorResponse('NOT_FOUND', 'User not found', 404);
    return successResponse(buildUserDetail(admin.repo.state, user));
  });

  api.get('/admin/moderation-queue', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const flaggedUsers = Object.values(admin.repo.state.users)
      .filter((user) => {
        const moderation = getModerationRecord(admin.repo.state, user.id);
        return moderation.status !== 'active' || moderation.redacted_avatar || moderation.redacted_bio || moderation.redacted_display_name;
      })
      .sort((left, right) => {
        const leftRecord = getModerationRecord(admin.repo.state, left.id);
        const rightRecord = getModerationRecord(admin.repo.state, right.id);
        return (rightRecord.updated_at || '').localeCompare(leftRecord.updated_at || '');
      })
      .map((user) => buildAdminUserSummary(admin.repo.state, user));
    const audits = Object.values(admin.repo.state.moderationAudits).sort((left, right) => right.created_at.localeCompare(left.created_at)).slice(0, 100);
    return successResponse({ items: flaggedUsers, audits });
  });

  api.post('/admin/users/:userId/actions/suspend', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const payload = adminModerationActionSchema.parse(await c.req.json());
    const target = admin.repo.state.users[c.req.param('userId')];
    if (!target) return errorResponse('NOT_FOUND', 'User not found', 404);
    const record = ensureModerationRecord(admin.repo, target.id);
    applyUserModerationState(record, 'suspended', admin.auth.user_id, payload.reason?.trim() || null);
    revokeUserRefreshTokens(admin.repo.state, target.id);
    addModerationAudit(admin.repo, target.id, admin.auth.user_id, 'suspend', payload.reason?.trim() || null);
    await admin.repo.save();
    return successResponse({ user: buildAdminUserSummary(admin.repo.state, target) });
  });

  api.post('/admin/users/:userId/actions/unsuspend', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const payload = adminModerationActionSchema.parse(await c.req.json());
    const target = admin.repo.state.users[c.req.param('userId')];
    if (!target) return errorResponse('NOT_FOUND', 'User not found', 404);
    const record = ensureModerationRecord(admin.repo, target.id);
    applyUserModerationState(record, 'active', admin.auth.user_id, payload.reason?.trim() || null);
    addModerationAudit(admin.repo, target.id, admin.auth.user_id, 'unsuspend', payload.reason?.trim() || null);
    await admin.repo.save();
    return successResponse({ user: buildAdminUserSummary(admin.repo.state, target) });
  });

  api.post('/admin/users/:userId/actions/ban', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const payload = adminModerationActionSchema.parse(await c.req.json());
    const target = admin.repo.state.users[c.req.param('userId')];
    if (!target) return errorResponse('NOT_FOUND', 'User not found', 404);
    const record = ensureModerationRecord(admin.repo, target.id);
    applyUserModerationState(record, 'banned', admin.auth.user_id, payload.reason?.trim() || null);
    revokeUserRefreshTokens(admin.repo.state, target.id);
    addModerationAudit(admin.repo, target.id, admin.auth.user_id, 'ban', payload.reason?.trim() || null);
    await admin.repo.save();
    return successResponse({ user: buildAdminUserSummary(admin.repo.state, target) });
  });

  api.post('/admin/users/:userId/actions/unban', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const payload = adminModerationActionSchema.parse(await c.req.json());
    const target = admin.repo.state.users[c.req.param('userId')];
    if (!target) return errorResponse('NOT_FOUND', 'User not found', 404);
    const record = ensureModerationRecord(admin.repo, target.id);
    applyUserModerationState(record, 'active', admin.auth.user_id, payload.reason?.trim() || null);
    addModerationAudit(admin.repo, target.id, admin.auth.user_id, 'unban', payload.reason?.trim() || null);
    await admin.repo.save();
    return successResponse({ user: buildAdminUserSummary(admin.repo.state, target) });
  });

  api.post('/admin/users/:userId/actions/soft-delete', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const payload = adminModerationActionSchema.parse(await c.req.json());
    const target = admin.repo.state.users[c.req.param('userId')];
    if (!target) return errorResponse('NOT_FOUND', 'User not found', 404);
    const record = ensureModerationRecord(admin.repo, target.id);
    record.redacted_avatar = true;
    record.redacted_bio = true;
    record.redacted_display_name = true;
    target.bio = null;
    target.display_name = null;
    await revokeProfileAvatar(admin.repo, c.env, target);
    applyUserModerationState(record, 'soft_deleted', admin.auth.user_id, payload.reason?.trim() || null);
    revokeUserRefreshTokens(admin.repo.state, target.id);
    addModerationAudit(admin.repo, target.id, admin.auth.user_id, 'soft_delete', payload.reason?.trim() || null, { anonymized_messages: true });
    await admin.repo.save();
    return successResponse({ user: buildAdminUserSummary(admin.repo.state, target) });
  });

  api.post('/admin/users/:userId/actions/restore', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const payload = adminModerationActionSchema.parse(await c.req.json());
    const target = admin.repo.state.users[c.req.param('userId')];
    if (!target) return errorResponse('NOT_FOUND', 'User not found', 404);
    const record = ensureModerationRecord(admin.repo, target.id);
    applyUserModerationState(record, 'active', admin.auth.user_id, payload.reason?.trim() || null);
    addModerationAudit(admin.repo, target.id, admin.auth.user_id, 'restore', payload.reason?.trim() || null);
    await admin.repo.save();
    return successResponse({ user: buildAdminUserSummary(admin.repo.state, target) });
  });

  api.post('/admin/users/:userId/actions/remove-profile-fields', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const payload = adminProfileRemovalSchema.parse(await c.req.json());
    const target = admin.repo.state.users[c.req.param('userId')];
    if (!target) return errorResponse('NOT_FOUND', 'User not found', 404);
    const record = ensureModerationRecord(admin.repo, target.id);
    const removed: string[] = [];
    for (const field of payload.fields) {
      if (field === 'display_name') {
        target.display_name = null;
        record.redacted_display_name = true;
        removed.push(field);
      } else if (field === 'bio') {
        target.bio = null;
        record.redacted_bio = true;
        removed.push(field);
      } else if (field === 'avatar') {
        await revokeProfileAvatar(admin.repo, c.env, target);
        record.redacted_avatar = true;
        removed.push(field);
      }
    }
    record.updated_at = nowIso();
    record.updated_by_user_id = admin.auth.user_id;
    record.reason = payload.reason?.trim() || null;
    addModerationAudit(admin.repo, target.id, admin.auth.user_id, 'profile_redaction', payload.reason?.trim() || null, { fields: removed });
    await admin.repo.save();
    return successResponse({ user: buildAdminUserSummary(admin.repo.state, target), removed_fields: removed });
  });

  api.get('/admin/mail/inbox', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const status = c.req.query('status') || '';
    const q = (c.req.query('q') || '').trim().toLowerCase();
    let items = sortInboxItems(Object.values(admin.repo.state.mailInboxItems));
    if (status) items = items.filter((item) => item.status === status);
    if (q) {
      items = items.filter((item) => [item.from_address, item.from_name || '', item.to_address, item.subject || '', item.text_body || ''].join(' ').toLowerCase().includes(q));
    }
    return successResponse({ items: items.map((item) => serializeMailInboxItem(admin.repo.state, item)), total: items.length });
  });

  api.get('/admin/mail/inbox/:messageId', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const item = admin.repo.state.mailInboxItems[c.req.param('messageId')];
    if (!item) return errorResponse('NOT_FOUND', 'Inbox item not found', 404);
    const thread = sortInboxItems(Object.values(admin.repo.state.mailInboxItems).filter((candidate) => candidate.thread_key && item.thread_key && candidate.thread_key === item.thread_key));
    return successResponse({
      item: serializeMailInboxItem(admin.repo.state, item),
      thread: thread.map((entry) => serializeMailInboxItem(admin.repo.state, entry)),
    });
  });

  api.post('/admin/mail/inbox/:messageId/status', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const item = admin.repo.state.mailInboxItems[c.req.param('messageId')];
    if (!item) return errorResponse('NOT_FOUND', 'Inbox item not found', 404);
    const payload = adminMailStatusSchema.parse(await c.req.json());
    item.status = payload.status;
    return admin.repo.save().then(() => successResponse({ item: serializeMailInboxItem(admin.repo.state, item) }));
  });

  api.post('/admin/mail/inbox/:messageId/tags', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const item = admin.repo.state.mailInboxItems[c.req.param('messageId')];
    if (!item) return errorResponse('NOT_FOUND', 'Inbox item not found', 404);
    const payload = adminMailTagsSchema.parse(await c.req.json());
    item.tags = [...new Set(payload.tags.map((tag) => tag.trim()).filter(Boolean))];
    return admin.repo.save().then(() => successResponse({ item: serializeMailInboxItem(admin.repo.state, item) }));
  });

  api.post('/admin/mail/inbox/:messageId/assign', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const item = admin.repo.state.mailInboxItems[c.req.param('messageId')];
    if (!item) return errorResponse('NOT_FOUND', 'Inbox item not found', 404);
    const payload = adminMailAssignSchema.parse(await c.req.json());
    if (payload.assigned_to_user_id && !admin.repo.state.users[payload.assigned_to_user_id]) return errorResponse('NOT_FOUND', 'Assignee not found', 404);
    item.assigned_to_user_id = payload.assigned_to_user_id;
    return admin.repo.save().then(() => successResponse({ item: serializeMailInboxItem(admin.repo.state, item) }));
  });

  api.post('/admin/mail/inbox/:messageId/draft', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const item = admin.repo.state.mailInboxItems[c.req.param('messageId')];
    if (!item) return errorResponse('NOT_FOUND', 'Inbox item not found', 404);
    const payload = adminMailDraftSchema.parse(await c.req.json());
    const existing = Object.values(admin.repo.state.mailDrafts).find((draft) => draft.inbox_item_id === item.id) || null;
    const now = nowIso();
    const draft = existing || {
      id: admin.repo.nextId('mail_draft'),
      inbox_item_id: item.id,
      author_user_id: admin.auth.user_id,
      from_address: null,
      from_name: null,
      subject: null,
      body: null,
      note: null,
      sent_at: null,
      sent_by_user_id: null,
      provider_message_id: null,
      provider_status: null,
      last_error: null,
      created_at: now,
      updated_at: now,
    } satisfies MailDraftRecord;
    draft.author_user_id = admin.auth.user_id;
    draft.from_address = payload.from_address ?? draft.from_address;
    draft.from_name = payload.from_name ?? draft.from_name;
    draft.subject = payload.subject ?? draft.subject;
    draft.body = payload.body ?? draft.body;
    draft.note = payload.note ?? draft.note;
    draft.last_error = null;
    draft.updated_at = now;
    admin.repo.state.mailDrafts[draft.id] = draft;
    await admin.repo.save();
    return successResponse({ draft: serializeMailDraft(draft), item: serializeMailInboxItem(admin.repo.state, item) });
  });

  api.post('/admin/mail/inbox/:messageId/send', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const item = admin.repo.state.mailInboxItems[c.req.param('messageId')];
    if (!item) return errorResponse('NOT_FOUND', 'Inbox item not found', 404);
    const payload = adminMailSendSchema.parse(await c.req.json());
    const existing = Object.values(admin.repo.state.mailDrafts).find((draft) => draft.inbox_item_id === item.id) || null;
    const now = nowIso();
    const draft = existing || {
      id: admin.repo.nextId('mail_draft'),
      inbox_item_id: item.id,
      author_user_id: admin.auth.user_id,
      from_address: null,
      from_name: null,
      subject: null,
      body: null,
      note: null,
      sent_at: null,
      sent_by_user_id: null,
      provider_message_id: null,
      provider_status: null,
      last_error: null,
      created_at: now,
      updated_at: now,
    } satisfies MailDraftRecord;
    draft.author_user_id = admin.auth.user_id;
    draft.from_address = payload.from_address ?? draft.from_address ?? getConfig(c.env).smtp2goDefaultFrom;
    draft.from_name = payload.from_name ?? draft.from_name ?? getConfig(c.env).smtp2goDefaultFromName;
    draft.subject = payload.subject ?? draft.subject ?? buildReplySubject(item, null);
    draft.body = payload.body ?? draft.body;
    draft.updated_at = now;
    admin.repo.state.mailDrafts[draft.id] = draft;
    if (!draft.from_address) return errorResponse('HTTP_ERROR', 'No sender address configured for SMTP2GO', 400);
    const textBody = String((draft.body || '').trim());
    if (!textBody) return errorResponse('HTTP_ERROR', 'Reply body is required before sending', 400);
    const subject = buildReplySubject(item, draft.subject);
    try {
      const result = await sendViaSmtp2go(c.env, {
        from_address: draft.from_address,
        from_name: draft.from_name,
        to: [item.from_address],
        subject,
        text_body: textBody,
        in_reply_to: item.source_message_id,
        references: item.source_message_id,
      });
      draft.subject = subject;
      draft.sent_at = nowIso();
      draft.sent_by_user_id = admin.auth.user_id;
      draft.provider_message_id = result.message_id;
      draft.provider_status = result.result || 'success';
      draft.last_error = null;
      draft.updated_at = nowIso();
      if (payload.close_after_send) item.status = 'closed';
      await admin.repo.save();
      return successResponse({ sent: true, draft: serializeMailDraft(draft), item: serializeMailInboxItem(admin.repo.state, item) });
    } catch (error) {
      draft.last_error = (error as Error).message;
      draft.provider_status = 'error';
      draft.updated_at = nowIso();
      await admin.repo.save();
      return errorResponse('HTTP_ERROR', (error as Error).message, 502);
    }
  });

  api.get('/admin/releases', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const { repo } = admin;
    const flags = listReleaseFlags(repo);
    const promotableCount = flags.filter((flag) => !flag.channel_locked && flag.stable_enabled !== flag.edge_enabled).length;
    return successResponse({
      release_channel: 'stable',
      flags,
      promotable_count: promotableCount,
      stable_feature_flags: Object.fromEntries(flags.map((flag) => [flag.key, !!flag.stable_enabled])),
      edge_feature_flags: Object.fromEntries(flags.map((flag) => [flag.key, !!flag.edge_enabled])),
      resolved_feature_flags: Object.fromEntries(flags.map((flag) => [flag.key, !!flag.edge_enabled])),
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
    });
  });

  api.get('/admin/releases/audit', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const items = Object.values(admin.repo.state.releaseAudits || {}).sort((left, right) => right.promoted_at.localeCompare(left.promoted_at));
    return successResponse({ items });
  });

  api.post('/admin/releases/promote', async (c) => {
    const admin = await requireAdminRepo(c);
    if (admin instanceof Response) return admin;
    const { auth, repo, user } = admin;
    const now = nowIso();
    const flags = listReleaseFlags(repo);
    const promotedFlagKeys = [] as string[];
    for (const flag of flags) {
      if (flag.channel_locked || flag.stable_enabled === flag.edge_enabled) continue;
      flag.stable_enabled = flag.edge_enabled;
      flag.updated_by_user_id = auth.user_id;
      flag.updated_at = now;
      flag.last_promoted_at = now;
      promotedFlagKeys.push(flag.key);
    }
    const audit: ReleaseAuditRecord = {
      id: repo.nextId('release_audit'),
      promoted_by_user_id: auth.user_id,
      promoted_by_label: `${user.display_name || user.username} (${user.username}#${user.discriminator})`,
      promoted_at: now,
      promoted_flag_keys: promotedFlagKeys,
    };
    repo.state.releaseAudits[audit.id] = audit;
    await repo.save();
    return successResponse({
      promoted: true,
      release_channel: 'stable',
      promoted_by_user_id: auth.user_id,
      promoted_at: now,
      promoted_count: promotedFlagKeys.length,
      promoted_flag_keys: promotedFlagKeys,
    });
  });

  api.post('/internal/mail/inbox', async (c) => {
    const secret = getConfig(c.env).mailWorkerSecret;
    if (!secret) return errorResponse('HTTP_ERROR', 'Mail worker integration is not configured', 503);
    const rawBody = await c.req.arrayBuffer();
    try {
      await verifyBridgeSignature(
        secret,
        rawBody,
        c.req.header('X-Wyvern-Mail-Timestamp') || null,
        c.req.header('X-Wyvern-Mail-Signature') || null,
      );
    } catch (error) {
      return errorResponse('UNAUTHORIZED', (error as Error).message, 401);
    }
    const payload = inboundMailSchema.parse(JSON.parse(new TextDecoder().decode(rawBody)));
    const repo = await loadRepository(c.env);
    const threadKey = payload.thread_key?.trim() || payload.source_message_id?.trim() || `${payload.from_address.toLowerCase()}::${(payload.subject || '').trim().toLowerCase()}`;
    const item: MailInboxItemRecord = {
      id: repo.nextId('mail_inbox'),
      from_address: payload.from_address.toLowerCase(),
      from_name: payload.from_name?.trim() || null,
      to_address: payload.to_address.toLowerCase(),
      subject: payload.subject?.trim() || null,
      text_body: payload.text_body ?? null,
      html_body: payload.html_body ?? null,
      received_at: payload.received_at || nowIso(),
      status: 'new',
      tags: [],
      assigned_to_user_id: null,
      source_message_id: payload.source_message_id?.trim() || null,
      thread_key: threadKey || null,
      attachments: (payload.attachments || []).map((attachment) => ({
        filename: attachment.filename,
        content_type: attachment.content_type ?? null,
        size: attachment.size ?? null,
        url: attachment.url ?? null,
      })),
      headers: payload.headers || {},
    };
    repo.state.mailInboxItems[item.id] = item;
    await repo.save();
    return successResponse({ item: serializeMailInboxItem(repo.state, item) }, 201);
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
    const moderation = getModerationRecord(repo.state, user.id);
    if (isBlockedModerationStatus(moderation.status)) return errorResponse('FORBIDDEN', moderationMessage(moderation.status), 403, { moderation_status: moderation.status });

    return successResponse({ user: serializeWyvUser(user) });
  });

  api.post('/internal/wyv/api-token-introspect', async (c) => {
    const secret = getConfig(c.env).wyvSharedSecret;
    const body = await c.req.arrayBuffer();
    if (!secret) return errorResponse('SERVICE_UNAVAILABLE', 'Wyv bridge authentication is not configured', 503);
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

    const payload = wyvTokenIntrospectSchema.parse(JSON.parse(new TextDecoder().decode(body)));
    const repo = await loadRepository(c.env);
    const tokenHash = await hashToken(payload.token);
    const token = Object.values(repo.state.apiTokens).find((item) => item.token_hash === tokenHash && !item.revoked_at);
    if (!token) return errorResponse('UNAUTHORIZED', 'Invalid API token', 401);
    
    token.last_used_at = nowIso();
    await repo.save();
    
    const user = repo.state.users[token.user_id];
    if (!user) return errorResponse('UNAUTHORIZED', 'API token user not found', 401);
    const moderation = getModerationRecord(repo.state, user.id);
    if (isBlockedModerationStatus(moderation.status)) return errorResponse('FORBIDDEN', moderationMessage(moderation.status), 403, { moderation_status: moderation.status });
    
    return successResponse({ active: true, token_id: token.id, token_name: token.name, user: serializeWyvUser(user) });
  });

  api.post('/internal/sync/batch', async (c) => {
    const secret = getConfig(c.env).wyvSharedSecret;
    const body = await c.req.arrayBuffer();
    if (!secret) return errorResponse('SERVICE_UNAVAILABLE', 'Wyv bridge authentication is not configured', 503);
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

    const payload = JSON.parse(new TextDecoder().decode(body));
    return successResponse({ ok: true, mode: 'workers', received: payload });
  });
  
  api.post('/internal/sync/bootstrap', async (c) => {
    const secret = getConfig(c.env).wyvSharedSecret;
    const body = await c.req.arrayBuffer();
    if (!secret) return errorResponse('SERVICE_UNAVAILABLE', 'Wyv bridge authentication is not configured', 503);
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

    const repo = await loadRepository(c.env);
    return successResponse({ ok: true, users: Object.keys(repo.state.users).length, servers: Object.keys(repo.state.servers).length, channels: Object.keys(repo.state.channels).length });
  });
  
  api.post('/internal/sync/realtime', async (c) => {
    const secret = getConfig(c.env).wyvSharedSecret;
    const body = await c.req.arrayBuffer();
    if (!secret) return errorResponse('SERVICE_UNAVAILABLE', 'Wyv bridge authentication is not configured', 503);
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

    const payload = JSON.parse(new TextDecoder().decode(body));
    return successResponse({ ok: true, accepted: payload });
  });

  api.all('*', (c) => errorResponse('NOT_FOUND', `Route not found: ${new URL(c.req.url).pathname}`, 404));
  return api;
}

async function requireUser(c: AppContext): Promise<AuthenticatedUser | null> {
  const token = readBearerToken(c.req.header('authorization') || null);
  if (!token) return null;
  try {
    const auth = await verifyAccessToken(c.env, token);
    const repo = await loadRepository(c.env);
    const user = repo.state.users[auth.user_id];
    if (!user) return null;
    const moderation = getModerationRecord(repo.state, user.id);
    if (isBlockedModerationStatus(moderation.status)) {
      revokeUserRefreshTokens(repo.state, user.id);
      await repo.save();
      return null;
    }
    return auth;
  } catch {
    return null;
  }
}

function toAuthUser(user: UserRecord): AuthenticatedUser { return { user_id: user.id, username: user.username, discriminator: user.discriminator, display_name: user.display_name || undefined, email: user.email, avatar: user.avatar || undefined }; }
function serializeUser(user: UserRecord, state?: RepositoryState) {
  const moderation = state ? getModerationRecord(state, user.id) : defaultModerationRecord(user.id);
  const full = moderation.status === 'soft_deleted'
    ? makeTombstoneUser(user)
    : {
        id: user.id,
        username: user.username,
        discriminator: user.discriminator,
        display_name: moderation.redacted_display_name ? null : user.display_name,
        bio: moderation.redacted_bio ? null : user.bio,
        directory_opt_in: user.directory_opt_in,
        email: user.email,
        avatar: moderation.redacted_avatar ? null : user.avatar,
        is_paid: user.is_paid,
        created_at: user.created_at,
        moderation_status: moderation.status,
        redactions: {
          display_name: moderation.redacted_display_name,
          bio: moderation.redacted_bio,
          avatar: moderation.redacted_avatar,
        },
        deleted: false,
      };
  return {
    id: full.id,
    username: full.username,
    discriminator: full.discriminator,
    display_name: full.display_name,
    bio: full.bio,
    directory_opt_in: full.directory_opt_in,
    email: full.email,
    avatar: full.avatar,
    is_paid: full.is_paid,
    created_at: full.created_at,
    moderation_status: 'moderation_status' in full ? full.moderation_status : 'soft_deleted',
    redactions: 'redactions' in full ? full.redactions : { display_name: true, bio: true, avatar: true },
    deleted: !!full.deleted,
  };
}
function serializePublicUser(user: UserRecord, state?: RepositoryState) {
  const full = serializeUser(user, state);
  const premium = !full.deleted && isPremiumUser(user);
  const cosmetics = user.profile_cosmetics;
  return {
    id: full.id,
    username: full.username,
    discriminator: full.discriminator,
    display_name: full.display_name,
    bio: full.bio,
    directory_opt_in: full.directory_opt_in,
    avatar: full.avatar,
    is_paid: premium,
    premium_badge: false,
    profile_cosmetics: cosmetics ? {
      accent_color: cosmetics.accent_color,
      banner_media_id: cosmetics.banner_media_id,
      show_premium_badge: cosmetics.show_premium_badge,
      supporter_badge: cosmetics.supporter_badge,
      personalization: cosmetics.personalization,
    } : null,
    created_at: full.created_at,
    moderation_status: full.moderation_status,
    redactions: full.redactions,
    deleted: full.deleted,
  };
}
function serializeMe(user: UserRecord, env: Env, state?: RepositoryState) { return { ...serializeUser(user, state), is_paid: hasPremiumAccess(env, user), is_admin: isAdmin(user, env), accepted_terms_version: user.accepted_terms_version, accepted_privacy_version: user.accepted_privacy_version, legal_accepted_at: user.legal_accepted_at, legal_reaccept_required: requiresLegalReacceptance(user), ai_opt_in: user.ai_opt_in, nsfw_18_verified: user.nsfw_18_verified, email_verified: isEmailVerified(env, user), email_verified_at: user.email_verified_at || null, profile_cosmetics: user.profile_cosmetics || null, premium_entitlement: effectiveEntitlement(env, user) }; }
function serializeServer(state: RepositoryState, server: ServerRecord, currentUserId?: string) { const owner = state.users[server.owner_id]; const membership = currentUserId ? state.serverMembers[memberKey(server.id, currentUserId)] : null; const ownerPublic = owner ? serializePublicUser(owner, state) : null; return { ...server, owner: ownerPublic, owner_display_name: ownerPublic?.display_name || ownerPublic?.username || null, member_count: listServerMembers(state, server.id).length, current_user_membership: membership ? { ...membership } : null }; }
function canManageServer(state: RepositoryState, serverId: string, userId: string): boolean { return canManageServerSettings(state, serverId, userId); }
function canAccessChannel(state: RepositoryState, channelId: string, userId: string): boolean { const channel = state.channels[channelId]; if (!channel) return false; if (channel.type === 'dm') return !!state.dmParticipants[dmParticipantKey(channelId, userId)] && !state.dmHiddenStates[dmHiddenKey(channelId, userId)]; return !!channel.server_id && !!activeMember(state, channel.server_id, userId); }
function canPinMessage(state: RepositoryState, message: MessageRecord, userId: string): boolean { const channel = state.channels[message.channel_id]; if (!channel || !canAccessChannel(state, channel.id, userId)) return false; if (channel.server_id && activeServerTimeout(state, channel.server_id, userId)) return false; if (message.author_id === userId) return true; if (channel.type === 'dm') return true; return !!channel.server_id && canModerateServer(state, channel.server_id, userId); }
function serializeDmChannel(state: RepositoryState, channel: ChannelRecord, currentUserId?: string) { const participants = listDmParticipants(state, channel.id).map((participant) => state.users[participant.user_id]).filter(Boolean).map((user) => ({ id: user.id, username: user.username, discriminator: user.discriminator, display_name: serializePublicUser(user, state).display_name, avatar: serializePublicUser(user, state).avatar })); const recipient = currentUserId ? participants.find((user) => user.id !== currentUserId) || null : participants[0] || null; return { ...channel, participants, recipient, display_name: recipient?.display_name || recipient?.username || channel.name || 'Direct Message' }; }
function serializeMessage(state: RepositoryState, message: MessageRecord | undefined, currentUserId?: string) { if (!message) return null; const author = state.users[message.author_id]; const grouped = new Map<string, string[]>(); for (const reaction of listMessageReactions(state, message.id)) { const users = grouped.get(reaction.emoji) || []; users.push(reaction.user_id); grouped.set(reaction.emoji, users); } const bookmarkedByMe = !!currentUserId && Object.values(state.messageBookmarks).some((item) => item.user_id === currentUserId && item.message_id === message.id); return { ...message, author: author ? serializePublicUser(author, state) : null, bookmarked_by_me: bookmarkedByMe, reply_to: message.reply_to_id ? previewReply(state, state.messages[message.reply_to_id]) : null, reactions: Array.from(grouped.entries()).map(([emoji, users]) => ({ emoji, count: users.length, users })) }; }
function previewReply(state: RepositoryState, message: MessageRecord | undefined) { if (!message) return null; const author = state.users[message.author_id]; return { id: message.id, author_id: message.author_id, author: author ? serializePublicUser(author, state) : null, content: message.content, attachments: message.attachments, created_at: message.created_at, edited_at: message.edited_at, is_nsfw: message.is_nsfw }; }
function legalMetadata() { return { terms_version: '2026-05-22', privacy_version: '2026-05-22', effective_date: '2026-05-22', effective_date_label: 'May 22, 2026', terms_url: '/legal/terms', privacy_url: '/legal/privacy', legal_contact_email: LEGAL_CONTACT_EMAIL, support_contact_email: SUPPORT_CONTACT_EMAIL, operator_name: OPERATOR_NAME }; }
function serializeApiToken(token: ApiTokenRecord) { return { id: token.id, user_id: token.user_id, name: token.name, created_at: token.created_at, last_used_at: token.last_used_at, revoked_at: token.revoked_at }; }
function serializeWebhook(webhook: WebhookRecord) { return { id: webhook.id, server_id: webhook.server_id, channel_id: webhook.channel_id, name: webhook.name, description: webhook.description, active: webhook.active, created_by: webhook.created_by, created_at: webhook.created_at, updated_at: webhook.updated_at, last_used_at: webhook.last_used_at }; }
function serializeUpload(media: MediaObjectRecord) {
  return {
    id: media.id,
    url: media.scan_status === 'clean' || media.scan_status === 'skipped' ? media.path : null,
    status_url: `/api/v1/uploads/${encodeURIComponent(media.id)}`,
    filename: media.filename,
    content_type: media.content_type,
    size: media.size,
    scan_status: media.scan_status,
    scan_error: media.scan_error,
    scanned_at: media.scanned_at,
  };
}
function defaultWorkspaceTitle(channel: ChannelRecord) { return `${channel.name} workspace`; }
function buildWorkspacePlaceholder(channel: ChannelRecord, currentUserId: string, visibility: string) { return { id: null, channel_id: channel.id, title: defaultWorkspaceTitle(channel), mode: 'markdown', language: 'plaintext', visibility, content: '', owner_user_id: visibility === 'private' ? currentUserId : null, updated_by_user_id: currentUserId, created_at: nowIso(), updated_at: nowIso(), revisions: [] }; }
function serializeWorkspace(repo: Awaited<ReturnType<typeof loadRepository>>, document: WorkspaceDocumentRecord) { return { ...document, revisions: Object.values(repo.state.workspaceRevisions).filter((item) => item.document_id === document.id).sort((a, b) => a.created_at.localeCompare(b.created_at)) }; }
function serializeWorkspaceGitCredential(credential: WorkspaceGitCredentialRecord) { return { id: credential.id, name: credential.name, scope: credential.scope, created_at: credential.created_at, expires_at: credential.expires_at, revoked_at: credential.revoked_at, last_used_at: credential.last_used_at }; }
function serializeWorkspaceGitRepository(repository: WorkspaceGitRepositoryRecord, repo: RepositoryHandle, origin: string) { return { id: repository.id, slug: repository.slug, default_branch: repository.default_branch, head_commit_sha: repository.head_commit_sha, clone_url: `${origin}/git/workspaces/${repository.slug}.git`, transport: 'smart_http_push_best_effort', push_limits: { max_pack_bytes: 1 * 1024 * 1024, max_repository_bytes: 1 * 1024 * 1024, max_object_bytes: 512 * 1024, workspace_readme_bytes: 200_000, files: ['README.md'], multi_file: false, branches: [repository.default_branch], force_push: false }, commits: workspaceGitCommits(repo, repository.id).map((commit) => ({ sha: commit.sha, parent_sha: commit.parent_sha, message: commit.message, author_user_id: commit.author_user_id, created_at: commit.created_at, file_path: commit.file_path })) }; }

async function requestMalwareScan(env: Env, origin: string, media: MediaObjectRecord, downloadToken: string): Promise<void> {
  const config = getConfig(env);
  if (!config.malwareScannerUrl || !config.malwareScannerSecret) return;
  const payload = JSON.stringify({
    upload_id: media.id,
    filename: media.filename,
    content_type: media.content_type,
    size: media.size,
    download_url: `${origin}/api/v1/internal/uploads/${encodeURIComponent(media.id)}/scan-download?token=${encodeURIComponent(downloadToken)}`,
    callback_url: `${origin}/api/v1/internal/uploads/scan-result`,
  });
  const bytes = new TextEncoder().encode(payload);
  const signed = await signBridgePayload(
    config.malwareScannerSecret,
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  try {
    const response = await fetch(config.malwareScannerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Wyvern-Scan-Timestamp': signed.timestamp,
        'X-Wyvern-Scan-Signature': signed.signature,
      },
      body: payload,
    });
    if (!response.ok) throw new Error(`scanner returned ${response.status}`);
  } catch (error) {
    const repo = await loadRepository(env);
    const current = repo.state.mediaObjects[media.id];
    if (current?.scan_status === 'pending') {
      current.scan_status = 'error';
      current.scan_error = (error as Error).message;
      current.scanned_at = nowIso();
      await repo.save();
    }
  }
}
function serializeAdminUser(user: UserRecord, state?: RepositoryState) { const moderation = state ? getModerationRecord(state, user.id) : defaultModerationRecord(user.id); return { id: user.id, username: user.username, discriminator: user.discriminator, display_name: user.display_name, bio: user.bio, directory_opt_in: user.directory_opt_in, avatar: user.avatar, is_paid: user.is_paid, created_at: user.created_at, moderation: serializeModerationRecord(moderation) }; }
function isAdmin(user: UserRecord, env: Env) { return getConfig(env).adminAllowlist.includes(`${user.username}#${user.discriminator}`); }
function serializeWyvUser(user: UserRecord) { return { user_id: user.id, sync_id: null, username: user.username, discriminator: user.discriminator, display_name: user.display_name, email: user.email, avatar: user.avatar, bio: user.bio, directory_opt_in: user.directory_opt_in, ai_opt_in: user.ai_opt_in, nsfw_18_verified: user.nsfw_18_verified }; }
function listReleaseFlags(repo: Awaited<ReturnType<typeof loadRepository>>): ReleaseFlagRecord[] {
  if (!repo.state.releaseFlags.community_tools) {
    repo.state.releaseFlags.community_tools = {
      key: 'community_tools',
      description: 'Enable search, pins, bookmarks, webhooks, and collaborative workspaces.',
      stable_enabled: false,
      edge_enabled: true,
      channel_locked: false,
      updated_by_user_id: null,
      updated_at: null,
      last_promoted_at: null,
    };
  }
  return Object.values(repo.state.releaseFlags).sort((left, right) => left.key.localeCompare(right.key));
}

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
