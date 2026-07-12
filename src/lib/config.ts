import type { RuntimeControls, TierLimits } from './domain';
import type { Env } from './types';

const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;

export interface AppConfig {
  appName: string;
  environment: string;
  apiPrefix: string;
  corsOrigins: string[];
  accessTokenExpireMinutes: number;
  refreshTokenExpireDays: number;
  mediaPublicBaseUrl: string;
  mirrorTargetUrl: string | null;
  wyvPublicBaseUrl: string | null;
  wyvSharedSecret: string | null;
  mailWorkerSecret: string | null;
  smtp2goApiKey: string | null;
  smtp2goBaseUrl: string;
  smtp2goDefaultFrom: string;
  smtp2goDefaultFromName: string | null;
  emailVerificationCodeExpireMinutes: number;
  emailVerificationMaxAttempts: number;
  emailVerificationResendSeconds: number;
  emailVerificationRequestLimit: number;
  emailVerificationRateLimitWindowMinutes: number;
  emailVerificationRequiredVersion: number;
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  stripePriceId: string | null;
  stripeSuccessUrl: string | null;
  stripeCancelUrl: string | null;
  stripePortalReturnUrl: string | null;
  subscriptionsEnabled: boolean;
  universalPremiumAccess: boolean;
  freeTierLimits: TierLimits;
  premiumTierLimits: TierLimits;
  runtimeControlDefaults: RuntimeControls;
  adminAllowlist: string[];
  malwareScannerUrl: string | null;
  malwareScannerSecret: string | null;
}

export function getConfig(env: Env): AppConfig {
  return {
    appName: env.APP_NAME || 'Wyvern Workers',
    environment: env.ENVIRONMENT || 'development',
    apiPrefix: normalizePrefix(env.API_V1_PREFIX || '/api/v1'),
    corsOrigins: parseList(env.CORS_ORIGINS || '*'),
    accessTokenExpireMinutes: parseNumber(env.ACCESS_TOKEN_EXPIRE_MINUTES, 15),
    refreshTokenExpireDays: parseNumber(env.REFRESH_TOKEN_EXPIRE_DAYS, 30),
    mediaPublicBaseUrl: env.MEDIA_PUBLIC_BASE_URL || '/media',
    mirrorTargetUrl: normalizeOptionalUrl(env.MIRROR_TARGET_URL),
    wyvPublicBaseUrl: normalizeOptionalUrl(env.WYV_PUBLIC_BASE_URL),
    wyvSharedSecret: env.WYV_SHARED_SECRET?.trim() || null,
    mailWorkerSecret: env.MAIL_WORKER_SECRET?.trim() || null,
    smtp2goApiKey: env.SMTP2GO_API_KEY?.trim() || null,
    smtp2goBaseUrl: normalizeOptionalUrl(env.SMTP2GO_BASE_URL) || 'https://api.smtp2go.com/v3',
    smtp2goDefaultFrom: normalizeEmail(env.SMTP2GO_DEFAULT_FROM) || 'noreply@wyvernhub.net',
    smtp2goDefaultFromName: env.SMTP2GO_DEFAULT_FROM_NAME?.trim() || null,
    emailVerificationCodeExpireMinutes: parseNumber(env.EMAIL_VERIFICATION_CODE_EXPIRE_MINUTES, 15),
    emailVerificationMaxAttempts: parseNumber(env.EMAIL_VERIFICATION_MAX_ATTEMPTS, 5),
    emailVerificationResendSeconds: parseNumber(env.EMAIL_VERIFICATION_RESEND_SECONDS, 60),
    emailVerificationRequestLimit: parseNumber(env.EMAIL_VERIFICATION_REQUEST_LIMIT, 5),
    emailVerificationRateLimitWindowMinutes: parseNumber(env.EMAIL_VERIFICATION_RATE_LIMIT_WINDOW_MINUTES, 60),
    emailVerificationRequiredVersion: parseNonNegativeNumber(env.EMAIL_VERIFICATION_REQUIRED_VERSION, 0),
    stripeSecretKey: env.STRIPE_SECRET_KEY?.trim() || null,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || null,
    stripePriceId: env.STRIPE_PRICE_ID?.trim() || null,
    stripeSuccessUrl: normalizeOptionalUrl(env.STRIPE_SUCCESS_URL),
    stripeCancelUrl: normalizeOptionalUrl(env.STRIPE_CANCEL_URL),
    stripePortalReturnUrl: normalizeOptionalUrl(env.STRIPE_PORTAL_RETURN_URL),
    subscriptionsEnabled: parseBoolean(env.SUBSCRIPTIONS_ENABLED, false),
    universalPremiumAccess: parseBoolean(env.UNIVERSAL_PREMIUM_ACCESS, true),
    freeTierLimits: getFreeTierLimits(env),
    premiumTierLimits: getPremiumTierLimits(env),
    runtimeControlDefaults: getRuntimeControlDefaults(env),
    adminAllowlist: parseList(env.ADMIN_ALLOWLIST || ''),
    malwareScannerUrl: normalizeOptionalUrl(env.MALWARE_SCANNER_URL),
    malwareScannerSecret: env.MALWARE_SCANNER_SECRET?.trim() || null,
  };
}

function parseList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizePrefix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return `/${trimmed}`;
  return trimmed.replace(/\/$/, '') || '/api/v1';
}

function normalizeOptionalUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/$/, '');
}

function normalizeEmail(value: string | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || null;
}

function getFreeTierLimits(env: Env): TierLimits {
  return {
    max_file_bytes: parseFirstNumber(env.FREE_MAX_UPLOAD_BYTES, env.FREE_MAX_FILE_BYTES, 25 * MEBIBYTE),
    total_storage_bytes: parseFirstNumber(env.FREE_STORAGE_BYTES, env.FREE_TOTAL_STORAGE_BYTES, 250 * MEBIBYTE),
    uploads_per_day: parseNumber(env.FREE_UPLOADS_PER_DAY, 20),
    webhooks_per_server: parseNumber(env.FREE_WEBHOOKS_PER_SERVER, 5),
  };
}

function getPremiumTierLimits(env: Env): TierLimits {
  return {
    max_file_bytes: parseFirstNumber(env.PREMIUM_MAX_UPLOAD_BYTES, env.PREMIUM_MAX_FILE_BYTES, 250 * MEBIBYTE),
    total_storage_bytes: parseFirstNumber(env.PREMIUM_STORAGE_BYTES, env.PREMIUM_TOTAL_STORAGE_BYTES, 10 * GIBIBYTE),
    uploads_per_day: parseNumber(env.PREMIUM_UPLOADS_PER_DAY, 100),
    webhooks_per_server: parseNumber(env.PREMIUM_WEBHOOKS_PER_SERVER, 25),
  };
}

function getRuntimeControlDefaults(env: Env): RuntimeControls {
  return {
    maintenance_mode: parseBoolean(env.MAINTENANCE_MODE, false),
    maintenance_message: env.MAINTENANCE_MESSAGE?.trim() || null,
    registrations_enabled: parseBoolean(env.REGISTRATION_ENABLED, true),
    uploads_enabled: parseBoolean(env.FEATURE_UPLOADS_ENABLED, true),
    webhooks_enabled: parseBoolean(env.FEATURE_WEBHOOKS_ENABLED, true),
    // Workspaces are part of the existing community-tools rollout at startup;
    // persisted controls can later disable either capability independently.
    workspaces_enabled: parseBoolean(env.FEATURE_COMMUNITY_TOOLS_ENABLED, true),
    community_tools_enabled: parseBoolean(env.FEATURE_COMMUNITY_TOOLS_ENABLED, true),
    voice_enabled: parseBoolean(env.FEATURE_VOICE_ENABLED, true),
    ai_enabled: parseBoolean(env.FEATURE_AI_ENABLED, false),
    updated_at: null,
    updated_by_user_id: null,
  };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseFirstNumber(primary: string | undefined, alias: string | undefined, fallback: number): number {
  return primary?.trim() ? parseNumber(primary, fallback) : parseNumber(alias, fallback);
}
