import type { MediaObjectRecord } from './domain';
import type { Env } from './types';

export function encodeMediaBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function saveMediaObject(env: Env, media: MediaObjectRecord, bytes?: Uint8Array): Promise<void> {
  if (env.MEDIA_BUCKET) {
    const body = bytes || decodeMediaBytes(media.body_base64);
    await env.MEDIA_BUCKET.put(media.storage_key || media.path.replace(/^\//, ''), body, {
      httpMetadata: {
        contentType: media.content_type,
        cacheControl: 'public, max-age=31536000, immutable',
      },
      customMetadata: {
        ownerUserId: media.owner_user_id,
        filename: media.filename,
      },
    });
  }
}

export async function loadMediaBytes(env: Env, media: MediaObjectRecord): Promise<Uint8Array> {
  if (env.MEDIA_BUCKET) {
    const object = await env.MEDIA_BUCKET.get(media.storage_key || media.path.replace(/^\//, ''));
    if (object) return new Uint8Array(await object.arrayBuffer());
  }
  return decodeMediaBytes(media.body_base64);
}

export async function publishQuarantinedMedia(env: Env, media: MediaObjectRecord): Promise<void> {
  const finalKey = media.path.replace(/^\//, '');
  if (env.MEDIA_BUCKET) {
    const source = await env.MEDIA_BUCKET.get(media.storage_key);
    if (!source) throw new Error('Quarantined media object is missing');
    await env.MEDIA_BUCKET.put(finalKey, source.body, {
      httpMetadata: {
        contentType: media.content_type,
        cacheControl: 'public, max-age=31536000, immutable',
      },
      customMetadata: {
        ownerUserId: media.owner_user_id,
        filename: media.filename,
        scanStatus: 'clean',
      },
    });
    if (media.storage_key !== finalKey) await env.MEDIA_BUCKET.delete(media.storage_key);
  }
  media.storage_key = finalKey;
}

export async function deleteMediaBytes(env: Env, media: MediaObjectRecord): Promise<void> {
  if (env.MEDIA_BUCKET) await env.MEDIA_BUCKET.delete(media.storage_key || media.path.replace(/^\//, ''));
  media.body_base64 = '';
}

function decodeMediaBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
