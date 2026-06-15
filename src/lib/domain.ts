export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline';
export type ChannelType = 'text' | 'voice' | 'dm';
export type MemberRole = 'owner' | 'admin' | 'moderator' | 'member';

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
}

export interface RefreshTokenRecord {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  is_revoked: boolean;
}

export interface ApiTokenRecord {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  plaintext_token: string;
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
  filename: string;
  content_type: string;
  size: number;
  body_base64: string;
  uploaded_at: string;
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
  token_plaintext: string;
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
  refreshTokens: Record<string, RefreshTokenRecord>;
  apiTokens: Record<string, ApiTokenRecord>;
  servers: Record<string, ServerRecord>;
  serverMembers: Record<string, ServerMemberRecord>;
  serverInvites: Record<string, ServerInviteRecord>;
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
  communityActivities: Record<string, CommunityActivityRecord>;
  realtimeEvents: Record<string, RealtimeEventRecord>;
  uiVariantVotes: Record<string, UiVariantVoteRecord>;
  counters: Record<string, number>;
}
