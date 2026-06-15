import type { MediaObjectRecord } from './domain';
import type { Env } from './types';

export function encodeMediaBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function saveMediaObject(env: Env, media: MediaObjectRecord): Promise<void> {
  if (env.MEDIA_BUCKET) {
    await env.MEDIA_BUCKET.put(media.path.replace(/^\//, ''), decodeMediaBytes(media.body_base64), {
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
    const object = await env.MEDIA_BUCKET.get(media.path.replace(/^\//, ''));
    if (object) return new Uint8Array(await object.arrayBuffer());
  }
  return decodeMediaBytes(media.body_base64);
}

function decodeMediaBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
