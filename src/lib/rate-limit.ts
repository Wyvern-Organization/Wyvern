import type { Env } from './types';

type LimitResult = {
  success: boolean;
  count: number;
  limit: number;
  reset_at: number;
  retry_after: number;
};

type MemoryWindow = {
  count: number;
  resetAt: number;
};

const memoryLimits = new WeakMap<Env, Map<string, MemoryWindow>>();

export async function checkRateLimit(
  env: Env,
  keyPrefix: string,
  actorId: string,
  limit: number,
  windowSeconds: number,
): Promise<LimitResult> {
  const actor = actorId.trim() || 'anonymous';
  const key = `${keyPrefix}:${actor}:${windowSeconds}`;

  if (env.RATE_LIMIT_ROOM) {
    const stub = env.RATE_LIMIT_ROOM.get(env.RATE_LIMIT_ROOM.idFromName('global'));
    const response = await stub.fetch('https://rate-limit.internal/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, limit, window_seconds: windowSeconds }),
    });
    if (!response.ok) throw new Error(`rate limiter failed with ${response.status}`);
    return response.json<LimitResult>();
  }

  let limits = memoryLimits.get(env);
  if (!limits) {
    limits = new Map();
    memoryLimits.set(env, limits);
  }
  const now = Date.now();
  let current = limits.get(key);
  if (!current || current.resetAt <= now) current = { count: 0, resetAt: now + windowSeconds * 1000 };
  current.count += 1;
  limits.set(key, current);
  return {
    success: current.count <= limit,
    count: current.count,
    limit,
    reset_at: current.resetAt,
    retry_after: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

export function resetRateLimits(env: Env): void {
  memoryLimits.delete(env);
}
