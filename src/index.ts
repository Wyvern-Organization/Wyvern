import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { buildApiRouter } from './routes/api';
import { buildGitRouter } from './routes/git';
import { getConfig } from './lib/config';
import { errorResponse, successResponse } from './lib/responses';
import type { Env } from './lib/types';
import { PresenceRoom } from './lib/presence-room';
import { RealtimeHub } from './lib/realtime-hub';
import { AppStateRoom } from './lib/app-state-room';
import { AppStateConflictError, loadRepository } from './lib/state';
import { loadMediaBytes } from './lib/media';
import { RateLimitRoom } from './lib/rate-limit-room';
import { runScheduledBackup } from './lib/backups';

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  const config = getConfig(c.env);
  const allowAll = config.corsOrigins.includes('*');
  const middleware = cors({
    origin: allowAll ? '*' : config.corsOrigins,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['authorization', 'content-type'],
    credentials: !allowAll,
  });
  return middleware(c, next);
});

app.use('*', async (c, next) => {
  const requestId = c.req.header('cf-ray') || crypto.randomUUID();
  const startedAt = Date.now();
  await next();
  c.res.headers.set('X-Request-ID', requestId);
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.res.headers.set('Permissions-Policy', 'geolocation=(), payment=(), usb=()');
  c.res.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; media-src 'self' https:; connect-src 'self' https: ws: wss:;"
  );
  // Keep logs useful for Workers observability without logging bodies, query
  // strings, credentials, or other user-provided secrets.
  console.log(JSON.stringify({
    event: 'http_request',
    request_id: requestId,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status: c.res.status,
    duration_ms: Date.now() - startedAt,
  }));
});

app.get('/healthz', (c) => healthResponse(c));
app.get('/health', (c) => healthResponse(c));
// UI A is the supported public shell. The other variants stay reachable only
// through non-production internal test routes while launch validation is in flight.
app.get('/', (c) => fetchAssetOrApp(c, '/new_ui_a.html'));
app.get('/invite/:code', (c) => fetchAssetOrApp(c, '/new_ui_a.html'));
app.get('/app', (c) => fetchAssetOrApp(c, '/new_ui_a.html'));
app.get('/legal/:slug', (c) => serveLegalSlug(c));
app.get('/legal/terms', (c) => fetchAssetOrApp(c, '/legal/terms/index.html'));
app.get('/legal/privacy', (c) => fetchAssetOrApp(c, '/legal/privacy/index.html'));
app.get('/__internal/test/ui/original', (c) => fetchInternalTestAsset(c, '/index.html'));
app.get('/__internal/test/ui/a', (c) => fetchInternalTestAsset(c, '/new_ui_a.html'));
app.get('/__internal/test/ui/b', (c) => fetchInternalTestAsset(c, '/new_ui_b.html'));
app.get('/admin', (c) => fetchAssetOrApp(c, '/admin.html'));
app.get('/admin/', (c) => fetchAssetOrApp(c, '/admin.html'));
app.get('/changelog.md', (c) => fetchAssetOrApp(c, '/changelog.md'));
app.get('/wyvern_logo.png', (c) => fetchAssetOrApp(c, '/static/wyvern-logo.png'));
app.get('/wyvern_logo_transparent.png', (c) => fetchAssetOrApp(c, '/static/wyvern-logo.png'));
app.get('/media/:userId/:uploadId', async (c) => serveMediaObject(c));
app.get('/auth/callback', (c) => fetchAssetOrApp(c, '/auth-callback.html'));
app.route('/api/v1', buildApiRouter());
app.route('/edge/api/v1', buildApiRouter());
app.route('/git', buildGitRouter());

app.notFound(async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname;
  if (path.startsWith('/api/') || path === '/mcp' || path.startsWith('/mcp/') || path.includes('/mcp') || path === '/edge' || path.startsWith('/edge/')) {
    return errorResponse('NOT_FOUND', 'API route not found', 404);
  }
  if (['/index.html', '/new_ui_b.html', '/edge_ui_chooser.html'].includes(path)) {
    return errorResponse('NOT_FOUND', 'Page not found', 404);
  }
  if (c.env.ASSETS) {
    const asset = await c.env.ASSETS.fetch(c.req.raw);
    if (asset.status !== 404) return asset;
  }
  return fetchAssetOrApp(c, '/new_ui_a.html');
});

app.onError((err, c) => {
  console.error(JSON.stringify({
    event: 'unhandled_error',
    request_id: c.req.header('cf-ray') || null,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    message: err instanceof Error ? err.message : String(err),
  }));
  if (err instanceof AppStateConflictError) {
    return errorResponse('STATE_CONFLICT', 'Data changed while your request was in progress. Please retry.', 409);
  }
  return errorResponse('INTERNAL_ERROR', 'Unexpected server error', 500);
});

function fetchAssetOrApp(c: Context<{ Bindings: Env }>, path: string) {
  if (!c.env.ASSETS) {
    return errorResponse('NOT_FOUND', 'Static assets binding is not configured', 404);
  }
  return c.env.ASSETS.fetch(new Request(new URL(path, c.req.url), { headers: { 'cache-control': 'no-store' } }));
}

function fetchInternalTestAsset(c: Context<{ Bindings: Env }>, path: string) {
  if (getConfig(c.env).environment === 'production') return errorResponse('NOT_FOUND', 'Page not found', 404);
  return fetchAssetOrApp(c, path);
}

function healthResponse(_c: Context<{ Bindings: Env }>) {
  return new Response(JSON.stringify({ success: true, data: { status: 'ok' }, error: null }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });
}

async function serveMediaObject(c: Context<{ Bindings: Env }>) {
  const uploadId = String(c.req.param('uploadId') || '');
  const userId = String(c.req.param('userId') || '');
  const objectKey = `media/${userId}/${uploadId}`;
  const repo = await loadRepository(c.env);
  const item = repo.state.mediaObjects[uploadId]
    || Object.values(repo.state.mediaObjects).find((candidate) => candidate.path === `/media/${userId}/${uploadId}`);
  if (item) {
    if (item.owner_user_id !== userId) return errorResponse('NOT_FOUND', 'Media object not found', 404);
    if (item.scan_status === 'pending' || item.scan_status === 'error') {
      return errorResponse('UPLOAD_PENDING', 'Upload is not available until malware scanning completes', 423, { scan_status: item.scan_status });
    }
    if (item.scan_status === 'infected') return errorResponse('NOT_FOUND', 'Media object not found', 404);
  }
  if (c.env.MEDIA_BUCKET) {
    const object = await c.env.MEDIA_BUCKET.get(objectKey);
    if (object) {
      const headers = new Headers({
        'cache-control': 'public, max-age=31536000, immutable',
        'etag': object.httpEtag,
      });
      object.writeHttpMetadata(headers);
      return new Response(object.body, { status: 200, headers });
    }
  }

  if (!item || item.owner_user_id !== userId) {
    return errorResponse('NOT_FOUND', 'Media object not found', 404);
  }
  const bytes = await loadMediaBytes(c.env, item);
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': item.content_type,
      'cache-control': 'private, max-age=60',
      'content-length': String(item.size),
    },
  });
}

function serveLegalSlug(c: Context<{ Bindings: Env }>) {
  const slug = String(c.req.param('slug') || '').toLowerCase();
  if (slug === 'terms') return fetchAssetOrApp(c, '/legal/terms/index.html');
  if (slug === 'privacy') return fetchAssetOrApp(c, '/legal/privacy/index.html');
  return errorResponse('NOT_FOUND', 'Legal document not found', 404);
}

const worker = {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled: async (_controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runScheduledBackup(env));
  },
};

export default worker;
export { PresenceRoom, RealtimeHub, AppStateRoom, RateLimitRoom };
