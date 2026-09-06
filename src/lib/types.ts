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
  MAIL_WORKER_SECRET?: string;
  SMTP2GO_API_KEY?: string;
  SMTP2GO_BASE_URL?: string;
  SMTP2GO_DEFAULT_FROM?: string;
  SMTP2GO_DEFAULT_FROM_NAME?: string;
  EMAIL_VERIFICATION_CODE_EXPIRE_MINUTES?: string;
  EMAIL_VERIFICATION_MAX_ATTEMPTS?: string;
  EMAIL_VERIFICATION_RESEND_SECONDS?: string;
  EMAIL_VERIFICATION_REQUEST_LIMIT?: string;
  EMAIL_VERIFICATION_RATE_LIMIT_WINDOW_MINUTES?: string;
  EMAIL_VERIFICATION_REQUIRED_VERSION?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_SUCCESS_URL?: string;
  STRIPE_CANCEL_URL?: string;
  STRIPE_PORTAL_RETURN_URL?: string;
  SUBSCRIPTIONS_ENABLED?: string;
  UNIVERSAL_PREMIUM_ACCESS?: string;
  FREE_MAX_UPLOAD_BYTES?: string;
  FREE_STORAGE_BYTES?: string;
  PREMIUM_MAX_UPLOAD_BYTES?: string;
  PREMIUM_STORAGE_BYTES?: string;
  // Legacy aliases remain accepted to avoid breaking an already-provisioned environment.
  FREE_MAX_FILE_BYTES?: string;
  FREE_TOTAL_STORAGE_BYTES?: string;
  FREE_UPLOADS_PER_DAY?: string;
  FREE_WEBHOOKS_PER_SERVER?: string;
  PREMIUM_MAX_FILE_BYTES?: string;
  PREMIUM_TOTAL_STORAGE_BYTES?: string;
  PREMIUM_UPLOADS_PER_DAY?: string;
  PREMIUM_WEBHOOKS_PER_SERVER?: string;
  MAINTENANCE_MODE?: string;
  MAINTENANCE_MESSAGE?: string;
  REGISTRATION_ENABLED?: string;
  FEATURE_UPLOADS_ENABLED?: string;
  FEATURE_WEBHOOKS_ENABLED?: string;
  FEATURE_COMMUNITY_TOOLS_ENABLED?: string;
  FEATURE_VOICE_ENABLED?: string;
  FEATURE_AI_ENABLED?: string;
  ADMIN_ALLOWLIST?: string;
  MALWARE_SCANNER_URL?: string;
  MALWARE_SCANNER_SECRET?: string;
  ASSETS?: Fetcher;
  MEDIA_BUCKET?: R2Bucket;
  BACKUP_BUCKET?: R2Bucket;
  PRESENCE_ROOM: DurableObjectNamespace;
  REALTIME_HUB?: DurableObjectNamespace;
  E2E_REALTIME_CLOSE_MS?: string;
  APP_STATE_ROOM?: DurableObjectNamespace;
  RATE_LIMIT_ROOM?: DurableObjectNamespace;
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
