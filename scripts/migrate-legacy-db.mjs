import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const baseUrl = process.env.WYVERN_IMPORT_BASE_URL || 'https://app.wyvernhub.net';
const accessToken = process.env.WYVERN_IMPORT_ACCESS_TOKEN;
const inputPath = process.env.WYVERN_IMPORT_STATE_JSON;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function jsonFetch(urlPath, init = {}) {
  const response = await fetch(`${baseUrl}${urlPath}`, init);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { response, body, text };
}

assert(accessToken, 'Set WYVERN_IMPORT_ACCESS_TOKEN to an admin access token');
assert(inputPath, 'Set WYVERN_IMPORT_STATE_JSON');

const file = await fs.readFile(path.resolve(inputPath), 'utf8');
const state = JSON.parse(file);

const importResponse = await jsonFetch('/api/v1/runtime/import-state', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ state }),
});
assert(importResponse.response.ok, `import failed: ${importResponse.response.status} ${importResponse.text}`);

let backupKey = null;
if (accessToken) {
  const backupResponse = await jsonFetch('/api/v1/runtime/backup-state', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });
  assert(backupResponse.response.ok, `backup failed: ${backupResponse.response.status} ${backupResponse.text}`);
  backupKey = backupResponse.body?.data?.key || null;
}

console.log(JSON.stringify({
  ok: true,
  imported: true,
  mode: 'admin-bearer-token',
  backup_key: backupKey,
}, null, 2));
