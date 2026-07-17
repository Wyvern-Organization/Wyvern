export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline';
export type ChannelType = 'text' | 'voice' | 'dm';
export type MemberRole = 'owner' | 'admin' | 'moderator' | 'member';
export type UserModerationStatus = 'active' | 'suspended' | 'banned' | 'soft_deleted';
export type MailInboxStatus = 'new' | 'open' | 'pending' | 'closed' | 'spam';
export type EmailVerificationStatus = 'pending' | 'verified' | 'expired' | 'locked';
export type StripeSubscriptionStatus = 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused';
export type PremiumEntitlementStatus = 'inactive' | 'active' | 'past_due' | 'canceled' | 'expired';
export type PremiumEntitlementSource = 'stripe' | 'manual' | 'legacy' | 'none';
export type UsageLedgerKind = 'storage_bytes' | 'upload' | 'webhook' | 'api_token' | 'ai_request' | 'ai_token';
export type ReportTargetType = 'message' | 'profile';
export type ReportScope = 'server' | 'platform';
export type ReportStatus = 'open' | 'in_review' | 'actioned' | 'dismissed';
export type ReportReason = 'spam' | 'harassment' | 'hate_or_abuse' | 'sexual_content' | 'violence_or_threat' | 'self_harm' | 'illegal_content' | 'impersonation' | 'privacy' | 'other';
export type ServerModerationActionType = 'delete_message' | 'warn' | 'timeout' | 'untimeout' | 'kick' | 'ban' | 'unban';

export interface UserRecord {
  id: string;
  username: string;
  discriminator: string;
  display_name: string | null;
  bio: string | null;
  directory_opt_in: boolean;
  email: string;
  avatar: string | null;
  is_paid: boolean;
  created_at: string;
  password_hash: string;
  accepted_terms_version: string | null;
  accepted_privacy_version: string | null;
  legal_accepted_at: string | null;
  ai_opt_in: boolean;
  nsfw_18_verified: boolean;
  /**
   * New fields are optional at the type boundary so snapshots created before
   * the pre-launch state migration remain readable. state.ts fills them in.
   */
  email_verified_at?: string | null;
  email_verification_version?: number;
  profile_cosmetics?: ProfileCosmetics;
  premium_entitlement?: PremiumEntitlementRecord;
}

export interface ProfileCosmetics {
  accent_color: string | null;
  banner_media_id: string | null;
  show_premium_badge: boolean;
  supporter_badge: boolean;
  personalization: Record<string, string | number | boolean | null>;
  updated_at: string | null;
}

export interface EmailVerificationRecord {
  user_id: string;
  status: EmailVerificationStatus;
  code_hash: string | null;
  expires_at: string | null;
  failed_attempt_count: number;
  locked_until: string | null;
  request_count: number;
  last_requested_at: string | null;
  last_sent_at: string | null;
  last_request_ip_hash: string | null;
  verified_at: string | null;
  updated_at: string;
}

export interface EmailVerificationRateLimitRecord {
  key: string;
  scope: 'user' | 'ip';
  subject_hash: string;
  window_started_at: string;
  request_count: number;
  blocked_until: string | null;
  updated_at: string;
}

export interface TierLimits {
  max_file_bytes: number;
  total_storage_bytes: number;
  uploads_per_day: number;
  webhooks_per_server: number;
}

export interface PremiumEntitlementRecord {
  user_id: string;
  tier: 'free' | 'premium';
  status: PremiumEntitlementStatus;
  source: PremiumEntitlementSource;
  is_active: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  current_period_end_at: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  ai_premium_eligible: boolean;
  early_access_flags: string[];
  granted_at: string | null;
  updated_at: string;
}

export interface StripeSubscriptionRecord {
  id: string;
  user_id: string;
  stripe_customer_id: string;
  stripe_price_id: string;
  status: StripeSubscriptionStatus;
  current_period_start_at: string | null;
  current_period_end_at: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  ended_at: string | null;
  trial_ends_at: string | null;
  latest_event_id: string | null;
  latest_event_created_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StripeWebhookEventRecord {
  event_id: string;
  event_type: string;
  stripe_created_at: string | null;
  received_at: string;
  processed_at: string | null;
  processing_error: string | null;
}

export interface UsageLedgerEntry {
  id: string;
  user_id: string;
  kind: UsageLedgerKind;
  quantity: number;
  server_id: string | null;
  resource_id: string | null;
  period_start_at: string | null;
  period_end_at: string | null;
  usage_metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface RefreshTokenRecord {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  is_revoked: boolean;
}

export interface PasswordResetRecord {
  user_id: string;
  code_hash: string;
  expires_at: string;
  failed_attempt_count: number;
  locked_until: string | null;
  requested_at: string;
  updated_at: string;
}

export interface ApiTokenRecord {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface ServerRecord {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  directory_opt_in: boolean;
  owner_id: string;
  created_at: string;
}

export interface ServerMemberRecord {
  server_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
}

export interface ServerInviteRecord {
  code: string;
  server_id: string;
  created_by: string;
  created_at: string;
}

export interface ChannelRecord {
  id: string;
  server_id: string | null;
  name: string;
  type: ChannelType;
  position: number;
  category: string | null;
  created_by: string;
  created_at: string;
}

export interface DMParticipantRecord {
  channel_id: string;
  user_id: string;
  joined_at: string;
}

export interface DMHiddenStateRecord {
  channel_id: string;
  user_id: string;
  hidden_at: string;
}

export interface MessageRecord {
  id: string;
  channel_id: string;
  author_id: string;
  reply_to_id: string | null;
  content: string;
  attachments: string[];
  created_at: string;
  edited_at: string | null;
  is_pinned: boolean;
  is_nsfw: boolean;
  webhook_name: string | null;
  webhook_avatar: string | null;
}

export interface ReactionRecord {
  message_id: string;
  emoji: string;
  user_id: string;
}

export interface MessageBookmarkRecord {
  id: string;
  user_id: string;
  message_id: string;
  created_at: string;
}

export interface MediaObjectRecord {
  id: string;
  owner_user_id: string;
  path: string;
  storage_key: string;
  filename: string;
  content_type: string;
  size: number;
  body_base64: string;
  uploaded_at: string;
  scan_status: 'pending' | 'clean' | 'infected' | 'error' | 'skipped';
  scan_error: string | null;
  scanned_at: string | null;
  scan_download_token_hash: string | null;
  scan_download_consumed_at: string | null;
}

export interface ChannelReadStateRecord {
  channel_id: string;
  user_id: string;
  last_read_message_id: string | null;
  last_read_at: string;
  updated_at: string;
}

export interface WebhookRecord {
  id: string;
  server_id: string;
  channel_id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  token_hash: string;
}

export interface WebhookDeliveryRecord {
  id: string;
  webhook_id: string;
  request_id: string;
  status: string;
  attempts: number;
  response_message: string | null;
  created_at: string;
}

export interface WorkspaceRevisionRecord {
  id: string;
  document_id: string;
  editor_user_id: string | null;
  content: string;
  created_at: string;
}

export interface WorkspaceDocumentRecord {
  id: string;
  channel_id: string;
  title: string;
  mode: string;
  language: string;
  visibility: string;
  content: string;
  owner_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The native workspace editor remains the primary interface. These records
 * mirror its saved snapshots into a small, Git-shaped history that can be
 * read through the Git dumb-HTTP transport.
 */
export interface WorkspaceGitRepositoryRecord {
  id: string;
  document_id: string;
  slug: string;
  default_branch: string;
  head_commit_sha: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceGitCommitRecord {
  sha: string;
  repository_id: string;
  parent_sha: string | null;
  branch: string;
  tree_sha: string;
  blob_sha: string;
  file_path: string;
  content: string;
  message: string;
  author_user_id: string | null;
  author_name: string;
  created_at: string;
}

export interface WorkspaceGitCredentialRecord {
  id: string;
  repository_id: string;
  user_id: string;
  name: string;
  scope: 'read' | 'write';
  token_hash: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

export interface WorkspaceGitObjectRecord {
  id: string;
  repository_id: string;
  sha: string;
  type: 'commit' | 'tree' | 'blob' | 'tag';
  content_base64: string;
  size: number;
  created_at: string;
}

export interface CommunityActivityRecord {
  id: string;
  server_id: string | null;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  activity_metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ReleaseFlagRecord {
  key: string;
  description: string;
  stable_enabled: boolean;
  edge_enabled: boolean;
  channel_locked: boolean;
  updated_by_user_id: string | null;
  updated_at: string | null;
  last_promoted_at: string | null;
}

export interface ReleaseAuditRecord {
  id: string;
  promoted_by_user_id: string | null;
  promoted_by_label: string | null;
  promoted_at: string;
  promoted_flag_keys: string[];
}

export interface UserModerationRecord {
  user_id: string;
  status: UserModerationStatus;
  reason: string | null;
  updated_at: string;
  updated_by_user_id: string | null;
  suspended_at: string | null;
  banned_at: string | null;
  soft_deleted_at: string | null;
  restored_at: string | null;
  redacted_display_name: boolean;
  redacted_bio: boolean;
  redacted_avatar: boolean;
}

export interface ModerationAuditRecord {
  id: string;
  user_id: string;
  actor_user_id: string | null;
  action: string;
  reason: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface ReportMessageSnapshot {
  message_id: string;
  channel_id: string;
  server_id: string | null;
  author_id: string;
  author_display_name: string | null;
  author_username: string | null;
  channel_name: string | null;
  server_name: string | null;
  content: string;
  attachments: string[];
  created_at: string;
  edited_at: string | null;
  is_nsfw: boolean;
  webhook_name: string | null;
}

export interface ReportRecord {
  id: string;
  reporter_user_id: string;
  target_type: ReportTargetType;
  target_id: string;
  reported_user_id: string;
  scope: ReportScope;
  server_id: string | null;
  /** Server role at report creation so hierarchy survives later membership changes. */
  reported_member_role?: MemberRole | null;
  reason: ReportReason;
  details: string | null;
  message_snapshot: ReportMessageSnapshot | null;
  dedupe_key: string;
  status: ReportStatus;
  assigned_to_user_id: string | null;
  resolution_reason: string | null;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportNote {
  id: string;
  report_id: string;
  author_user_id: string;
  body: string;
  created_at: string;
}

export interface ReportAudit {
  id: string;
  report_id: string;
  actor_user_id: string | null;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface ServerModerationAction {
  id: string;
  server_id: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  action: ServerModerationActionType;
  reason: string;
  message_id: string | null;
  warning_id: string | null;
  timeout_id: string | null;
  ban_id: string | null;
  affected_object_ids: string[];
  action_metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ServerWarning {
  id: string;
  server_id: string;
  user_id: string;
  actor_user_id: string | null;
  action_id: string;
  reason: string;
  created_at: string;
}

export interface ServerBan {
  id: string;
  server_id: string;
  user_id: string;
  actor_user_id: string | null;
  action_id: string;
  reason: string;
  created_at: string;
  unbanned_at: string | null;
  unbanned_by_user_id: string | null;
  unban_reason: string | null;
}

export interface ServerTimeout {
  id: string;
  server_id: string;
  user_id: string;
  actor_user_id: string | null;
  action_id: string;
  reason: string;
  started_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
}

export interface RuntimeControls {
  maintenance_mode: boolean;
  maintenance_message: string | null;
  registrations_enabled: boolean;
  uploads_enabled: boolean;
  webhooks_enabled: boolean;
  workspaces_enabled: boolean;
  community_tools_enabled: boolean;
  voice_enabled: boolean;
  ai_enabled: boolean;
  updated_at: string | null;
  updated_by_user_id: string | null;
}

export const DEFAULT_RUNTIME_CONTROLS: Readonly<RuntimeControls> = {
  maintenance_mode: false,
  maintenance_message: null,
  registrations_enabled: true,
  uploads_enabled: true,
  webhooks_enabled: true,
  workspaces_enabled: true,
  community_tools_enabled: true,
  voice_enabled: true,
  ai_enabled: false,
  updated_at: null,
  updated_by_user_id: null,
};

export const MEMBER_ROLE_RANK: Readonly<Record<MemberRole, number>> = {
  owner: 4,
  admin: 3,
  moderator: 2,
  member: 1,
};

export function memberRoleRank(role: MemberRole): number {
  return MEMBER_ROLE_RANK[role];
}

export interface MailAttachmentRecord {
  filename: string;
  content_type: string | null;
  size: number | null;
  url: string | null;
}

export interface MailInboxItemRecord {
  id: string;
  from_address: string;
  from_name: string | null;
  to_address: string;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  received_at: string;
  status: MailInboxStatus;
  tags: string[];
  assigned_to_user_id: string | null;
  source_message_id: string | null;
  thread_key: string | null;
  attachments: MailAttachmentRecord[];
  headers: Record<string, string>;
}

export interface MailDraftRecord {
  id: string;
  inbox_item_id: string;
  author_user_id: string | null;
  from_address: string | null;
  from_name: string | null;
  subject: string | null;
  body: string | null;
  note: string | null;
  sent_at: string | null;
  sent_by_user_id: string | null;
  provider_message_id: string | null;
  provider_status: string | null;
  last_error: string | null;
  updated_at: string;
  created_at: string;
}

export interface RealtimeEventRecord {
  id: string;
  event: string;
  channel_id: string | null;
  user_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface UiVariantVoteRecord {
  user_id: string;
  variant_key: 'original' | 'ui_a' | 'ui_b';
  updated_at: string;
}

export interface AppState {
  users: Record<string, UserRecord>;
  emailVerifications: Record<string, EmailVerificationRecord>;
  emailVerificationRateLimits: Record<string, EmailVerificationRateLimitRecord>;
  passwordResets: Record<string, PasswordResetRecord>;
  refreshTokens: Record<string, RefreshTokenRecord>;
  apiTokens: Record<string, ApiTokenRecord>;
  stripeSubscriptions: Record<string, StripeSubscriptionRecord>;
  stripeWebhookEvents: Record<string, StripeWebhookEventRecord>;
  usageLedgerEntries: Record<string, UsageLedgerEntry>;
  servers: Record<string, ServerRecord>;
  serverMembers: Record<string, ServerMemberRecord>;
  serverInvites: Record<string, ServerInviteRecord>;
  reports: Record<string, ReportRecord>;
  reportNotes: Record<string, ReportNote>;
  reportAudits: Record<string, ReportAudit>;
  serverModerationActions: Record<string, ServerModerationAction>;
  serverWarnings: Record<string, ServerWarning>;
  serverBans: Record<string, ServerBan>;
  serverTimeouts: Record<string, ServerTimeout>;
  channels: Record<string, ChannelRecord>;
  dmParticipants: Record<string, DMParticipantRecord>;
  dmHiddenStates: Record<string, DMHiddenStateRecord>;
  messages: Record<string, MessageRecord>;
  reactions: Record<string, ReactionRecord>;
  messageBookmarks: Record<string, MessageBookmarkRecord>;
  mediaObjects: Record<string, MediaObjectRecord>;
  channelReadStates: Record<string, ChannelReadStateRecord>;
  webhooks: Record<string, WebhookRecord>;
  webhookDeliveries: Record<string, WebhookDeliveryRecord>;
  workspaceDocuments: Record<string, WorkspaceDocumentRecord>;
  workspaceRevisions: Record<string, WorkspaceRevisionRecord>;
  workspaceGitRepositories: Record<string, WorkspaceGitRepositoryRecord>;
  workspaceGitCommits: Record<string, WorkspaceGitCommitRecord>;
  workspaceGitCredentials: Record<string, WorkspaceGitCredentialRecord>;
  workspaceGitObjects: Record<string, WorkspaceGitObjectRecord>;
  communityActivities: Record<string, CommunityActivityRecord>;
  releaseFlags: Record<string, ReleaseFlagRecord>;
  releaseAudits: Record<string, ReleaseAuditRecord>;
  userModerationRecords: Record<string, UserModerationRecord>;
  moderationAudits: Record<string, ModerationAuditRecord>;
  mailInboxItems: Record<string, MailInboxItemRecord>;
  mailDrafts: Record<string, MailDraftRecord>;
  realtimeEvents: Record<string, RealtimeEventRecord>;
  uiVariantVotes: Record<string, UiVariantVoteRecord>;
  runtimeControls: RuntimeControls;
  counters: Record<string, number>;
}
