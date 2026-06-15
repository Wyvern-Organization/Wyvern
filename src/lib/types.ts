import type { AppState } from './domain';

export interface Env {
  APP_NAME: string;
  ENVIRONMENT: string;
  API_V1_PREFIX: string;
  JWT_SECRET_KEY?: string;
  ACCESS_TOKEN_EXPIRE_MINUTES?: string;
  REFRESH_TOKEN_EXPIRE_DAYS?: string;
  CORS_ORIGINS?: string;
  MEDIA_PUBLIC_BASE_URL?: string;
  MIRROR_TARGET_URL?: string;
  WYV_PUBLIC_BASE_URL?: string;
  WYV_SHARED_SECRET?: string;
  ADMIN_ALLOWLIST?: string;
  ASSETS?: Fetcher;
  MEDIA_BUCKET?: R2Bucket;
  BACKUP_BUCKET?: R2Bucket;
  PRESENCE_ROOM: DurableObjectNamespace;
  REALTIME_HUB?: DurableObjectNamespace;
  APP_STATE_ROOM?: DurableObjectNamespace;
  __APP_STATE__?: AppState;
  __PRESENCE__?: Record<string, string>;
  __REALTIME_TEST__?: {
    events: Array<{ type: string; payload: Record<string, unknown>; channel_id: string | null }>;
    sockets: number;
    subscriptions: Record<string, string[]>;
    typingUsers: Record<string, string[]>;
    voiceParticipants: Record<string, string[]>;
    messages: string[];
  };
}

export interface ApiErrorShape {
  code: string;
  message: string;
  details: unknown;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: ApiErrorShape | null;
}

export interface AuthenticatedUser {
  user_id: string;
  username?: string;
  discriminator?: string;
  display_name?: string;
  email?: string;
  avatar?: string;
}
