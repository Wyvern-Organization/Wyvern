import type { Env } from './types';

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
  adminAllowlist: string[];
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
    adminAllowlist: parseList(env.ADMIN_ALLOWLIST || ''),
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
