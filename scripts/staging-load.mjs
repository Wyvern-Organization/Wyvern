#!/usr/bin/env node

// Dependency-free, opt-in staging load harness. It never sends traffic without
// an explicit target and pre-verified test accounts.
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=', 2);
  return [key, value];
}));
const baseUrl = String(process.env.STAGING_BASE_URL || '').replace(/\/$/, '');
const concurrency = Number(args.get('concurrency') || process.env.LOAD_CONCURRENCY || 5);
const durationSeconds = Number(args.get('duration') || process.env.LOAD_DURATION_SECONDS || 600);
const intervalMs = Number(args.get('interval-ms') || process.env.LOAD_INTERVAL_MS || 1500);
const users = JSON.parse(process.env.LOAD_USERS_JSON || '[]');
const adminToken = process.env.LOAD_ADMIN_TOKEN || '';
const enableUpload = process.env.LOAD_INCLUDE_UPLOADS === 'true';
const enableCheckout = process.env.LOAD_INCLUDE_STRIPE_CHECKOUT === 'true';
const enableWebSocket = process.env.LOAD_INCLUDE_WEBSOCKETS !== 'false';

if (!baseUrl) {
  console.error('Set STAGING_BASE_URL. No traffic was sent.');
  process.exit(2);
}
if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isFinite(durationSeconds) || durationSeconds < 1) {
  console.error('concurrency must be a positive integer and duration must be positive seconds.');
  process.exit(2);
}
if (!Array.isArray(users) || !users.length) {
  console.error('Set LOAD_USERS_JSON to a JSON array of pre-verified staging accounts. No traffic was sent.');
  process.exit(2);
}
if (users.length < concurrency) {
  console.error(`Provide at least ${concurrency} distinct pre-verified staging accounts so account-level safety limits do not invalidate the test.`);
  process.exit(2);
}

const metrics = { started_at: new Date().toISOString(), concurrency, duration_seconds: durationSeconds, requests: 0, failures: 0, statuses: {}, latencies_ms: [], scenarios: {} };

function record(name, status, elapsed) {
  metrics.requests += 1;
  metrics.statuses[status] = (metrics.statuses[status] || 0) + 1;
  metrics.latencies_ms.push(elapsed);
  metrics.scenarios[name] ||= { requests: 0, failures: 0 };
  metrics.scenarios[name].requests += 1;
  if (status >= 400 || status === 0) {
    metrics.failures += 1;
    metrics.scenarios[name].failures += 1;
  }
}

async function request(name, path, options = {}) {
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}/api/v1${path}`, options);
    record(name, response.status, Math.round(performance.now() - started));
    const body = await response.json().catch(() => null);
    return { response, payload: body?.data ?? body };
  } catch (error) {
    record(name, 0, Math.round(performance.now() - started));
    return { response: null, payload: null, error };
  }
}

const authHeaders = (token, extra = {}) => ({ authorization: `Bearer ${token}`, ...extra });

async function login(account) {
  const { response, payload } = await request('sign_in', '/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password }),
  });
  return response?.ok ? (payload?.tokens?.access_token || payload?.access_token || null) : null;
}

async function reconnectWebSocket(token) {
  if (!enableWebSocket || typeof WebSocket === 'undefined') return;
  await new Promise((resolve) => {
    const socketUrl = baseUrl.replace(/^http/, 'ws') + `/api/v1/ws?token=${encodeURIComponent(token)}`;
    let socket;
    const timer = setTimeout(() => { try { socket?.close(); } catch {} resolve(); }, 1500);
    try {
      socket = new WebSocket(socketUrl);
      socket.addEventListener('open', () => { try { socket.send(JSON.stringify({ action: 'ping' })); socket.close(); } catch {} });
      socket.addEventListener('close', () => { clearTimeout(timer); resolve(); });
      socket.addEventListener('error', () => { clearTimeout(timer); resolve(); });
    } catch { clearTimeout(timer); resolve(); }
  });
}

async function userCycle(workerId, token, reportToken, shouldReport, shouldUpload, shouldCheckout) {
  const headers = authHeaders(token, { 'content-type': 'application/json' });
  await request('me', '/users/me', { headers: authHeaders(token) });
  const server = await request('server_create', '/servers', { method: 'POST', headers, body: JSON.stringify({ name: `Load ${workerId}-${Date.now()}` }) });
  if (server.payload?.id) {
    const channel = await request('channel_create', `/channels/server/${encodeURIComponent(server.payload.id)}`, { method: 'POST', headers, body: JSON.stringify({ name: 'load', type: 'text' }) });
    if (channel.payload?.id) {
      await request('message', `/messages/channels/${encodeURIComponent(channel.payload.id)}`, { method: 'POST', headers, body: JSON.stringify({ content: `load probe ${Date.now()}` }) });
      if (reportToken && shouldReport) {
        await request('server_join_for_report', `/servers/${encodeURIComponent(server.payload.id)}/join`, {
          method: 'POST',
          headers: authHeaders(reportToken),
        });
        const reportedMessage = await request('reported_message', `/messages/channels/${encodeURIComponent(channel.payload.id)}`, {
          method: 'POST',
          headers: authHeaders(reportToken, { 'content-type': 'application/json' }),
          body: JSON.stringify({ content: `reportable load probe ${Date.now()}` }),
        });
        if (reportedMessage.payload?.id) {
          const report = await request('message_report', '/reports', {
            method: 'POST',
            headers,
            body: JSON.stringify({ target_type: 'message', target_id: reportedMessage.payload.id, reason: 'other', details: 'Staging load-test report.' }),
          });
          if (report.payload?.id) {
            await request('report_triage', `/reports/${encodeURIComponent(report.payload.id)}`, {
              method: 'PATCH',
              headers,
              body: JSON.stringify({ status: 'in_review' }),
            });
          }
        }
      }
    }
  }
  if (enableUpload && shouldUpload) {
    const form = new FormData();
    form.set('file', new Blob(['staging load probe'], { type: 'text/plain' }), `probe-${workerId}.txt`);
    await request('upload', '/uploads', { method: 'POST', headers: authHeaders(token), body: form });
  }
  if (enableCheckout && shouldCheckout) await request('stripe_checkout', '/billing/checkout', { method: 'POST', headers, body: JSON.stringify({ return_url: `${baseUrl}/app?load=checkout` }) });
  await reconnectWebSocket(token);
}

async function adminCycle() {
  if (!adminToken) return;
  await request('admin_reports', '/admin/reports', { headers: authHeaders(adminToken) });
  await request('admin_controls', '/runtime/controls', { headers: authHeaders(adminToken) });
}

const deadline = Date.now() + durationSeconds * 1000;
const tokens = (await Promise.all(users.map(login))).filter(Boolean);
if (!tokens.length) {
  console.error('No configured staging account could sign in. No load scenario was started.');
  process.exit(1);
}
if (tokens.length < concurrency) {
  console.error(`Only ${tokens.length} staging accounts could sign in; ${concurrency} distinct accounts are required. No load scenario was started.`);
  process.exit(1);
}
await Promise.all(Array.from({ length: concurrency }, async (_, index) => {
  const token = tokens[index];
  const reportToken = tokens.length > 1 ? (tokens[(index + 1) % tokens.length] || null) : null;
  let lastReportAt = 0;
  let lastUploadAt = 0;
  let checkoutStarted = false;
  while (Date.now() < deadline) {
    const now = Date.now();
    const shouldReport = now - lastReportAt >= 15_000;
    const shouldUpload = now - lastUploadAt >= 60_000;
    const shouldCheckout = !checkoutStarted;
    await userCycle(index, token, reportToken, shouldReport, shouldUpload, shouldCheckout);
    if (shouldReport) lastReportAt = now;
    if (shouldUpload) lastUploadAt = now;
    if (shouldCheckout) checkoutStarted = true;
    if (index === 0) await adminCycle();
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}));

metrics.finished_at = new Date().toISOString();
metrics.error_rate = metrics.requests ? metrics.failures / metrics.requests : 1;
const latencies = [...metrics.latencies_ms].sort((a, b) => a - b);
metrics.latency_ms = { p50: latencies[Math.floor(latencies.length * 0.5)] || 0, p95: latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] || 0, max: latencies.at(-1) || 0 };
delete metrics.latencies_ms;
console.log(JSON.stringify(metrics, null, 2));
process.exitCode = metrics.error_rate > Number(process.env.LOAD_MAX_ERROR_RATE || 0.02) ? 1 : 0;
