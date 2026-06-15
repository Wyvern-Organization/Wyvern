const baseUrl = process.env.WYVERN_VERIFY_BASE_URL || 'http://127.0.0.1:8787';
const username = `storageverify_${Date.now()}`;

async function jsonFetch(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { response, body, text };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const register = await jsonFetch('/api/v1/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    username,
    email: `${username}@example.com`,
    password: 'correct horse battery',
    accepted_legal: true,
    terms_version: '2026-05-22',
    privacy_version: '2026-05-22',
  }),
});
assert(register.response.ok, `register failed: ${register.response.status} ${register.text}`);
const token = register.body?.data?.tokens?.access_token;
assert(token, 'missing access token');

const authHeaders = { authorization: `Bearer ${token}` };

const diagnostics = await jsonFetch('/api/v1/runtime/diagnostics', { headers: authHeaders });
assert(diagnostics.response.ok, `diagnostics failed: ${diagnostics.response.status} ${diagnostics.text}`);
assert(diagnostics.body?.data?.bindings?.app_state_room === true, 'APP_STATE_ROOM not active');
assert(diagnostics.body?.data?.bindings?.media_bucket === true, 'MEDIA_BUCKET not active');

const stateVerify = await jsonFetch('/api/v1/runtime/verify/state-room', { headers: authHeaders });
assert(stateVerify.response.ok, `state verify failed: ${stateVerify.response.status} ${stateVerify.text}`);
assert(stateVerify.body?.data?.backend === 'durable_object', 'state backend is not durable_object');

const payload = 'storage-runtime-body';
const uploadForm = new FormData();
uploadForm.set('file', new File([payload], 'storage-runtime.txt', { type: 'text/plain' }));
const upload = await jsonFetch('/api/v1/uploads', {
  method: 'POST',
  headers: authHeaders,
  body: uploadForm,
});
assert(upload.response.ok, `upload failed: ${upload.response.status} ${upload.text}`);
const uploadId = upload.body?.data?.id;
assert(uploadId, 'missing upload id');

const mediaVerify = await jsonFetch(`/api/v1/runtime/verify/media-bucket/${uploadId}`, { headers: authHeaders });
assert(mediaVerify.response.ok, `media verify failed: ${mediaVerify.response.status} ${mediaVerify.text}`);
assert(mediaVerify.body?.data?.backend === 'r2', 'media backend is not r2');

console.log(JSON.stringify({ ok: true, baseUrl, username, uploadId }, null, 2));
