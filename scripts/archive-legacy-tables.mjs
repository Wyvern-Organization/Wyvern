import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const tables = [
  'recommendation_embeddings',
  'user_recommendations',
  'recommendation_signals',
  'replication_outbox',
  'replication_inbound_ledger',
  'oauth_client_registrations',
  'release_flags',
  'release_promotion_audit',
  'id_migration_map',
];

if (!process.env.DATABASE_URL?.trim()) throw new Error('Set DATABASE_URL to the original Wyvern PostgreSQL database');

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = path.resolve(process.env.WYVERN_ARCHIVE_OUTPUT || `.migration-archives/${timestamp}`);
const bucket = process.env.WYVERN_ARCHIVE_BUCKET || 'wyvern-backups';
const prefix = process.env.WYVERN_ARCHIVE_PREFIX || `legacy-archives/${timestamp}`;
const shouldUpload = process.env.WYVERN_ARCHIVE_UPLOAD === '1';
await mkdir(outputDir, { recursive: true });

const exportPayload = JSON.parse(await capture('python3', [path.join(import.meta.dirname, 'export-legacy-archive.py')]));
const manifest = {
  archive_version: 1,
  source: 'Wyvern-original/Wyvern/wyvern-backend',
  exported_at: new Date().toISOString(),
  database: exportPayload.database,
  prefix,
  tables: [],
};

for (const table of tables) {
  const exists = !!exportPayload.tables[table]?.exists;
  const rows = exportPayload.tables[table]?.rows || [];
  const payload = JSON.stringify({ table, exists, row_count: rows.length, rows }, null, 2);
  const filename = `${table}.json`;
  const filePath = path.join(outputDir, filename);
  await writeFile(filePath, payload);
  manifest.tables.push({
    table,
    exists,
    row_count: rows.length,
    object_key: `${prefix}/${filename}`,
    sha256: sha256(payload),
  });
}

const manifestPath = path.join(outputDir, 'manifest.json');
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

if (shouldUpload) {
  for (const item of [...manifest.tables, { object_key: `${prefix}/manifest.json`, table: 'manifest' }]) {
    const filename = item.table === 'manifest' ? 'manifest.json' : `${item.table}.json`;
    await run('npx', [
      'wrangler', 'r2', 'object', 'put', `${bucket}/${item.object_key}`,
      '--file', path.join(outputDir, filename),
      '--content-type', 'application/json',
      '--remote',
      '--force',
    ]);
  }
}

console.log(JSON.stringify({
  ok: true,
  output_dir: outputDir,
  uploaded: shouldUpload,
  bucket: shouldUpload ? bucket : null,
  prefix,
  manifest_sha256: sha256(await readFile(manifestPath, 'utf8')),
  tables: manifest.tables.map(({ table, exists, row_count, sha256: digest }) => ({ table, exists, row_count, sha256: digest })),
}, null, 2));

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`)));
  });
}

async function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
