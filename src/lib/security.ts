import { jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import type { Env } from './types';

const encoder = new TextEncoder();

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
    return bcrypt.compare(password, hash);
  }
  return (await sha256(`wyvern-password:${password}`)) === hash;
}

export async function hashToken(token: string): Promise<string> {
  return sha256(`wyvern-token:${token}`);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function futureIso(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString();
}

export function randomToken(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function legalVersions() {
  return {
    terms_version: '2026-05-22',
    privacy_version: '2026-05-22',
  };
}

export function requiresLegalReacceptance(user: { accepted_terms_version: string | null; accepted_privacy_version: string | null }): boolean {
  const current = legalVersions();
  return user.accepted_terms_version !== current.terms_version || user.accepted_privacy_version !== current.privacy_version;
}

export function isExpired(iso: string): boolean {
  return new Date(iso).getTime() <= Date.now();
}

export async function verifyBridgeSignature(secret: string, body: ArrayBuffer, timestamp: string | null, signature: string | null): Promise<void> {
  if (!timestamp || !signature) {
    throw new Error('Missing bridge authentication headers');
  }

  const sentAt = parseInt(timestamp);
  if (isNaN(sentAt)) {
    throw new Error('Invalid bridge timestamp');
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - sentAt) > 300) {
    throw new Error('Expired bridge signature');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const data = new Uint8Array(timestamp.length + 1 + body.byteLength);
  data.set(encoder.encode(timestamp));
  data.set(encoder.encode('.'), timestamp.length);
  data.set(new Uint8Array(body), timestamp.length + 1);

  const sigBuffer = await crypto.subtle.sign('HMAC', key, data);
  const expected = Array.from(new Uint8Array(sigBuffer)).map((item) => item.toString(16).padStart(2, '0')).join('');

  if (expected !== signature) {
    throw new Error('Invalid bridge signature');
  }
}

export async function decodeWyvHandoffGrant(secret: string, grant: string): Promise<any> {
  const key = encoder.encode(secret);
  const { payload } = await jwtVerify(grant, key);
  if (payload.type !== 'wyv-handoff') {
    throw new Error('Invalid Wyv handoff token type');
  }
  return payload;
}
