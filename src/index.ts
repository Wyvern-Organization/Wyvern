import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { buildApiRouter } from './routes/api';
import { getConfig } from './lib/config';
import { errorResponse, successResponse } from './lib/responses';
import type { Env } from './lib/types';
import { PresenceRoom } from './lib/presence-room';
import { RealtimeHub } from './lib/realtime-hub';
import { AppStateRoom } from './lib/app-state-room';
import { loadRepository } from './lib/state';
import { loadMediaBytes } from './lib/media';

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
  await next();
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.res.headers.set('Permissions-Policy', 'geolocation=(), payment=(), usb=()');
  c.res.headers.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; media-src 'self' https:; connect-src 'self' https: wss:;");
});

app.get('/healthz', (c) => healthResponse(c));
app.get('/health', (c) => healthResponse(c));
app.get('/.well-known/oauth-protected-resource/mcp', (c) => mcpProtectedResource(c));
app.get('/mcp/.well-known/oauth-authorization-server', (c) => mcpOAuthMetadata(c));
app.get('/mcp/.well-known/openid-configuration', (c) => mcpOAuthMetadata(c));
app.get('/.well-known/oauth-authorization-server/mcp', (c) => mcpOAuthMetadata(c));
app.get('/.well-known/openid-configuration/mcp', (c) => mcpOAuthMetadata(c));
app.get('/mcp/authorize', (c) => mcpAuthorize(c));
app.post('/mcp/authorize', (c) => mcpAuthorize(c));
app.post('/mcp/token', (c) => mcpToken(c));
app.post('/mcp/register', (c) => mcpRegister(c));
app.get('/mcp/oauth/authorize', (c) => mcpAuthorizeScreen(c));
app.post('/mcp/oauth/authorize', (c) => mcpAuthorizeScreen(c));
app.get('/mcp', (c) => mcpTransport(c));
app.post('/mcp', (c) => mcpTransport(c));
app.delete('/mcp', (c) => mcpTransport(c));
app.options('/mcp', (c) => mcpTransport(c));
app.get('/mcp/', (c) => mcpTransport(c));
app.post('/mcp/', (c) => mcpTransport(c));
app.delete('/mcp/', (c) => mcpTransport(c));
app.options('/mcp/', (c) => mcpTransport(c));
app.get('/mcp-doc/:ticket', (c) => mcpDocument(c));
app.get('/', (c) => fetchAssetOrApp(c, '/app.html'));
app.get('/invite/:code', (c) => fetchAssetOrApp(c, '/app.html'));
app.get('/app', (c) => fetchAssetOrApp(c, '/app.html'));
app.get('/legal/:slug', (c) => serveLegalSlug(c));
app.get('/legal/terms', (c) => fetchAssetOrApp(c, '/legal/terms/index.html'));
app.get('/legal/privacy', (c) => fetchAssetOrApp(c, '/legal/privacy/index.html'));
app.get('/edge', (c) => fetchAssetOrApp(c, '/edge_ui_chooser.html'));
app.get('/edge/', (c) => fetchAssetOrApp(c, '/edge_ui_chooser.html'));
app.get('/edge/ui', (c) => fetchAssetOrApp(c, '/edge_ui_chooser.html'));
app.get('/edge/ui/', (c) => fetchAssetOrApp(c, '/edge_ui_chooser.html'));
app.get('/edge/ui/original', (c) => fetchAssetOrApp(c, '/index.html'));
app.get('/edge/ui/original/', (c) => fetchAssetOrApp(c, '/index.html'));
app.get('/edge/ui/a', (c) => fetchAssetOrApp(c, '/new_ui_a.html'));
app.get('/edge/ui/a/', (c) => fetchAssetOrApp(c, '/new_ui_a.html'));
app.get('/edge/ui/b', (c) => fetchAssetOrApp(c, '/new_ui_b.html'));
app.get('/edge/ui/b/', (c) => fetchAssetOrApp(c, '/new_ui_b.html'));
app.get('/admin', (c) => fetchAssetOrApp(c, '/admin.html'));
app.get('/admin/', (c) => fetchAssetOrApp(c, '/admin.html'));
app.get('/changelog.md', (c) => fetchAssetOrApp(c, '/changelog.md'));
app.get('/wyvern_logo.png', (c) => fetchAssetOrApp(c, '/static/wyvern-logo.png'));
app.get('/wyvern_logo_transparent.png', (c) => fetchAssetOrApp(c, '/static/wyvern-logo.png'));
app.get('/media/:userId/:uploadId', async (c) => serveMediaObject(c));
app.get('/auth/callback', (c) => fetchAssetOrApp(c, '/auth-callback.html'));
app.route('/api/v1', buildApiRouter());
app.route('/edge/api/v1', buildApiRouter());

app.notFound((c) => {
  const url = new URL(c.req.url);
  if (url.pathname.startsWith('/api/')) {
    return errorResponse('NOT_FOUND', 'API route not found', 404);
  }
  return fetchAssetOrApp(c, '/app.html');
});

app.onError((err) => {
  console.error(err);
  return errorResponse('INTERNAL_ERROR', 'Unexpected server error', 500);
});

function fetchAssetOrApp(c: Context<{ Bindings: Env }>, path: string) {
  if (!c.env.ASSETS) {
    return errorResponse('NOT_FOUND', 'Static assets binding is not configured', 404);
  }
  return c.env.ASSETS.fetch(new Request(new URL(path, c.req.url), { headers: { 'cache-control': 'no-store' } }));
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

function mcpProtectedResource(c: Context<{ Bindings: Env }>) {
  const origin = new URL(c.req.url).origin;
  return Response.json({
    resource: `${origin}/mcp`,
    authorization_servers: [`${origin}/mcp/.well-known/oauth-authorization-server`],
    bearer_methods_supported: ['header'],
  });
}

function mcpOAuthMetadata(c: Context<{ Bindings: Env }>) {
  const origin = new URL(c.req.url).origin;
  return Response.json({
    issuer: origin,
    authorization_endpoint: `${origin}/mcp/authorize`,
    token_endpoint: `${origin}/mcp/token`,
    registration_endpoint: `${origin}/mcp/register`,
    scopes_supported: ['openid', 'profile', 'mcp:connect'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    code_challenge_methods_supported: ['S256'],
  });
}

function mcpAuthorize(c: Context<{ Bindings: Env }>) {
  const origin = new URL(c.req.url).origin;
  return Response.json({
    success: true,
    data: {
      authorize_url: `${origin}/mcp/oauth/authorize`,
      method: c.req.method,
      message: 'OAuth authorize compatibility endpoint for Wyvern MCP.',
    },
    error: null,
  });
}

function mcpToken(_c: Context<{ Bindings: Env }>) {
  return Response.json({
    access_token: 'wyvern_mcp_demo_token',
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'openid profile mcp:connect',
  });
}

function mcpRegister(c: Context<{ Bindings: Env }>) {
  const origin = new URL(c.req.url).origin;
  return Response.json({
    client_id: 'wyvern-mcp-client',
    client_name: 'Wyvern MCP Client',
    redirect_uris: [`${origin}/auth/callback`],
    grant_types: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_method: 'none',
  }, { status: 201 });
}

function mcpAuthorizeScreen(c: Context<{ Bindings: Env }>) {
  return new Response('<!doctype html><html><body><h1>Authorize Wyvern MCP</h1><p>OAuth compatibility screen.</p></body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function mcpTransport(c: Context<{ Bindings: Env }>) {
  return Response.json({
    success: true,
    data: {
      transport: 'mcp-http',
      method: c.req.method,
      app: 'Wyvern',
    },
    error: null,
  });
}

function mcpDocument(c: Context<{ Bindings: Env }>) {
  const ticket = c.req.param('ticket');
  return new Response(`<!doctype html><html><body><h1>Wyvern MCP Document</h1><p>Ticket: ${ticket}</p></body></html>`, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function serveMediaObject(c: Context<{ Bindings: Env }>) {
  const uploadId = String(c.req.param('uploadId') || '');
  const userId = String(c.req.param('userId') || '');
  const objectKey = `media/${userId}/${uploadId}`;
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

  const repo = await loadRepository(c.env);
  const item = repo.state.mediaObjects[uploadId]
    || Object.values(repo.state.mediaObjects).find((candidate) => candidate.path === `/media/${userId}/${uploadId}`);
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

export default app;
export { PresenceRoom, RealtimeHub, AppStateRoom };
