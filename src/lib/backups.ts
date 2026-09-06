import type { AppState } from './domain';
import type { Env } from './types';
import { loadStateForNamespace } from './state';
import { nowIso, sha256 } from './security';

export type StateSummary = {
  users: number;
  servers: number;
  channels: number;
  dms: number;
  messages: number;
  media_objects: number;
};

export function summarizeState(state: AppState): StateSummary {
  return {
    users: Object.keys(state.users || {}).length,
    servers: Object.keys(state.servers || {}).length,
    channels: Object.keys(state.channels || {}).length,
    dms: Object.values(state.channels || {}).filter((channel) => channel.type === 'dm').length,
    messages: Object.keys(state.messages || {}).length,
    media_objects: Object.keys(state.mediaObjects || {}).length,
  };
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function stateDigest(state: AppState): Promise<string> {
  return sha256(stableStringify(state));
}

export async function writeStateBackup(
  env: Env,
  namespace: string,
  kind: 'manual' | 'daily' | 'monthly' | 'pre-migration',
  date = new Date(),
): Promise<string> {
  if (!env.BACKUP_BUCKET) throw new Error('BACKUP_BUCKET is not bound');
  const state = await loadStateForNamespace(env, namespace);
  const exportedAt = date.toISOString();
  const stamp = exportedAt.replace(/[:.]/g, '-');
  const key = kind === 'manual' || kind === 'pre-migration'
    ? `state/${namespace}/${kind}/${stamp}.json`
    : `state/${namespace}/${kind}/${exportedAt.slice(0, 10)}.json`;
  const digest = await stateDigest(state);
  await env.BACKUP_BUCKET.put(key, JSON.stringify({
    exported_at: exportedAt,
    environment: namespace,
    kind,
    digest,
    counts: summarizeState(state),
    state,
  }), { httpMetadata: { contentType: 'application/json' } });
  return key;
}

export async function runScheduledBackup(env: Env, date = new Date()): Promise<{
  keys: string[];
  deleted: number;
}> {
  if (!env.BACKUP_BUCKET) throw new Error('BACKUP_BUCKET is not bound');
  const namespace = env.ENVIRONMENT || 'production';
  const keys = [await writeStateBackup(env, namespace, 'daily', date)];
  if (date.getUTCDate() === 1) keys.push(await writeStateBackup(env, namespace, 'monthly', date));

  let deleted = 0;
  deleted += await cleanupPrefix(env.BACKUP_BUCKET, `state/${namespace}/daily/`, date.getTime() - 30 * 86400_000);
  const monthlyCutoff = new Date(date);
  monthlyCutoff.setUTCFullYear(monthlyCutoff.getUTCFullYear() - 1);
  deleted += await cleanupPrefix(env.BACKUP_BUCKET, `state/${namespace}/monthly/`, monthlyCutoff.getTime());
  console.log(JSON.stringify({ event: 'scheduled_state_backup', at: nowIso(), namespace, keys, deleted }));
  return { keys, deleted };
}

async function cleanupPrefix(bucket: R2Bucket, prefix: string, cutoff: number): Promise<number> {
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const page = await bucket.list({ prefix, cursor });
    const expired = page.objects.filter((object) => object.uploaded.getTime() < cutoff).map((object) => object.key);
    if (expired.length) {
      await bucket.delete(expired);
      deleted += expired.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}
