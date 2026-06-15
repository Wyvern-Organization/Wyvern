import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { AuthenticatedUser, Env } from './types';

const encoder = new TextEncoder();

type UserPayload = JWTPayload & AuthenticatedUser;

export async function issueAccessToken(env: Env, user: AuthenticatedUser, expiresInMinutes: number): Promise<string> {
  const secret = getSecret(env);
  const payload: UserPayload = {
    ...user,
    sub: user.user_id,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${expiresInMinutes}m`)
    .sign(secret);
}

export async function issueWyvHandoffGrant(env: Env, user: AuthenticatedUser, expiresInMinutes: number): Promise<string> {
  const secret = new TextEncoder().encode(env.WYV_SHARED_SECRET || env.JWT_SECRET_KEY || 'dev-only-wyvern-workers-secret-key-change-me');
  const payload: UserPayload & { type: string; user: AuthenticatedUser } = {
    ...user,
    sub: user.user_id,
    type: 'wyv-handoff',
    user,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${expiresInMinutes}m`)
    .sign(secret);
}

export async function verifyAccessToken(env: Env, token: string): Promise<AuthenticatedUser> {
  const secret = getSecret(env);
  const { payload } = await jwtVerify(token, secret);
  return {
    user_id: String(payload.user_id || payload.sub || ''),
    username: payload.username ? String(payload.username) : undefined,
    discriminator: payload.discriminator ? String(payload.discriminator) : undefined,
    display_name: payload.display_name ? String(payload.display_name) : undefined,
    email: payload.email ? String(payload.email) : undefined,
    avatar: payload.avatar ? String(payload.avatar) : undefined,
  };
}

export function readBearerToken(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function getSecret(env: Env): Uint8Array {
  return encoder.encode(env.JWT_SECRET_KEY || 'dev-only-wyvern-workers-secret-key-change-me');
}
