import { Hono } from 'hono';
import { getConfig } from '../lib/config';
import { hashToken, isExpired, nowIso } from '../lib/security';
import { applyWorkspaceGitPush, dmHiddenKey, dmParticipantKey, getRuntimeControls, memberKey, loadRepository, WORKSPACE_GIT_MAX_REPOSITORY_BYTES, type AppRepository } from '../lib/state';
import type { Env } from '../lib/types';
import { parseGitCommit, parseGitPack, treeEntries, type GitRawObject } from '../lib/git-pack';
import { gitObjectBytes, workspaceGitCommits, workspaceGitObjectSet } from '../lib/workspace-git';
import { checkRateLimit } from '../lib/rate-limit';

type GitContext = { repo: AppRepository; repositoryId: string; slug: string; defaultBranch: string; head: string | null; credentialId: string; userId: string; scope: 'read' | 'write' };
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const ZERO_SHA = '0'.repeat(40);
const MAX_PUSH_BYTES = 1 * 1024 * 1024;
const MAX_GIT_OBJECT_BYTES = 512 * 1024;
const MAX_GIT_UNPACKED_BYTES = 1 * 1024 * 1024;
const MAX_WORKSPACE_CONTENT_BYTES = 200_000;

function unauthorizedGitResponse(): Response {
  return new Response('Git credential required\n', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Wyvern Workspace Git"', 'cache-control': 'no-store' } });
}

function gitToken(header: string | undefined): string | null {
  if (!header?.startsWith('Basic ')) return null;
  try {
    const decoded = atob(header.slice('Basic '.length));
    const delimiter = decoded.indexOf(':');
    return delimiter < 0 ? null : decoded.slice(delimiter + 1);
  } catch {
    return null;
  }
}

async function resolveGitContext(env: Env, slug: string, authorization: string | undefined, requiredScope: 'read' | 'write' = 'read'): Promise<GitContext | Response> {
  const token = gitToken(authorization);
  if (!token) return unauthorizedGitResponse();
  const repo = await loadRepository(env);
  const repository = Object.values(repo.state.workspaceGitRepositories).find((item) => item.slug === slug);
  if (!repository) return new Response('Repository not found\n', { status: 404 });
  const tokenHash = await hashToken(token);
  const credential = Object.values(repo.state.workspaceGitCredentials).find((item) => item.repository_id === repository.id && item.token_hash === tokenHash && !item.revoked_at && (!item.expires_at || !isExpired(item.expires_at)));
  if (!credential || (requiredScope === 'write' && credential.scope !== 'write')) return unauthorizedGitResponse();
  const context: GitContext = { repo, repositoryId: repository.id, slug: repository.slug, defaultBranch: repository.default_branch, head: repository.head_commit_sha, credentialId: credential.id, userId: credential.user_id, scope: credential.scope };
  if (!canAccessGitWorkspace(env, context)) return new Response('Git credential no longer has access to this Workspace\n', { status: 403, headers: { 'cache-control': 'no-store' } });
  return context;
}

function gzipGitObject(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate')) as ReadableStream<Uint8Array>;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function packetLine(value: string): string {
  return `${(value.length + 4).toString(16).padStart(4, '0')}${value}`;
}

function reportStatus(unpack: string, ref: string, detail?: string): Response {
  const refStatus = unpack === 'ok' ? `ok ${ref}\n` : `ng ${ref} ${detail || unpack}\n`;
  return new Response(`${packetLine(`unpack ${unpack}\n`)}${packetLine(refStatus)}0000`, { headers: { 'content-type': 'application/x-git-receive-pack-result', 'cache-control': 'no-store' } });
}

function looseObject(raw: GitRawObject): Uint8Array {
  return gitObjectBytes(raw.type, raw.content);
}

function rawFromLoose(bytes: Uint8Array, sha: string): GitRawObject | null {
  const nul = bytes.indexOf(0);
  if (nul < 0) return null;
  const [type, sizeText] = textDecoder.decode(bytes.subarray(0, nul)).split(' ');
  if (!['commit', 'tree', 'blob', 'tag'].includes(type) || Number(sizeText) !== bytes.length - nul - 1) return null;
  return { sha, type: type as GitRawObject['type'], content: bytes.subarray(nul + 1) };
}

async function existingGitObjects(context: GitContext): Promise<Map<string, GitRawObject>> {
  const objects = new Map<string, GitRawObject>();
  for (const commit of workspaceGitCommits(context.repo, context.repositoryId)) {
    for (const object of await workspaceGitObjectSet(commit)) {
      const parsed = rawFromLoose(object.bytes, object.sha);
      if (parsed) objects.set(parsed.sha, parsed);
    }
  }
  // Preserve exact bytes received from Git clients over synthesized legacy
  // workspace snapshots, which may not contain a multi-file tree.
  for (const item of Object.values(context.repo.state.workspaceGitObjects)) {
    if (item.repository_id !== context.repositoryId) continue;
    objects.set(item.sha, { sha: item.sha, type: item.type, content: decodeBase64(item.content_base64) });
  }
  return objects;
}

function parseReceiveCommands(body: Uint8Array): { commands: Array<{ oldSha: string; newSha: string; ref: string }>; packOffset: number } {
  const commands: Array<{ oldSha: string; newSha: string; ref: string }> = [];
  let offset = 0;
  let first = true;
  while (true) {
    if (offset + 4 > body.length) throw new Error('Truncated Git receive request');
    const length = Number.parseInt(textDecoder.decode(body.subarray(offset, offset + 4)), 16);
    if (!Number.isFinite(length) || length < 0) throw new Error('Invalid Git packet length');
    offset += 4;
    if (length === 0) break;
    if (length < 4 || offset + length - 4 > body.length) throw new Error('Invalid Git packet payload');
    let line = textDecoder.decode(body.subarray(offset, offset + length - 4));
    offset += length - 4;
    if (first) line = line.split('\0', 1)[0];
    first = false;
    const match = line.trim().match(/^([a-f0-9]{40}) ([a-f0-9]{40}) (refs\/[A-Za-z0-9._/-]+)$/);
    if (!match) throw new Error('Unsupported Git reference update');
    commands.push({ oldSha: match[1], newSha: match[2], ref: match[3] });
  }
  return { commands, packOffset: offset };
}

function validateWorkspaceCommitChain(newSha: string, expectedOld: string, objects: Map<string, GitRawObject>): {
  reachable: Set<string>;
  commit: ReturnType<typeof parseGitCommit>;
  readme: { content: string; blobSha: string };
} {
  if (newSha === expectedOld) throw new Error('Branch is already up to date');
  const reachable = new Set<string>();
  let sha = newSha;
  let target: ReturnType<typeof parseGitCommit> | null = null;
  let readme: { content: string; blobSha: string } | null = null;
  let commits = 0;
  while (sha !== expectedOld) {
    if (++commits > 512) throw new Error('Git push contains too many commits');
    const commitObject = objects.get(sha);
    if (!commitObject || commitObject.type !== 'commit') throw new Error('Pushed commit references an unavailable Git commit');
    const commit = parseGitCommit(commitObject.content);
    if (commit.parents.length > 1) throw new Error('Merge commits are not supported for Workspace Git');
    const tree = objects.get(commit.tree);
    if (!tree || tree.type !== 'tree') throw new Error('Pushed commit tree is unavailable or invalid');
    const entries = treeEntries(tree.content);
    if (entries.length !== 1 || entries[0].name !== 'README.md' || entries[0].mode !== '100644') {
      throw new Error('Workspace Git accepts exactly one 100644 README.md file');
    }
    const blob = objects.get(entries[0].sha);
    if (!blob || blob.type !== 'blob') throw new Error('Workspace README object is unavailable or invalid');
    let content: string;
    try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(blob.content); }
    catch { throw new Error('Workspace README must be valid UTF-8'); }
    if (textEncoder.encode(content).length > MAX_WORKSPACE_CONTENT_BYTES) throw new Error('Workspace README exceeds the 200 KB editor limit');
    reachable.add(sha);
    reachable.add(commit.tree);
    reachable.add(blob.sha);
    if (!target) {
      target = commit;
      readme = { content, blobSha: blob.sha };
    }
    const parent = commit.parents[0] || ZERO_SHA;
    if (parent === ZERO_SHA && expectedOld !== ZERO_SHA) throw new Error('Non-fast-forward updates are not supported');
    sha = parent;
  }
  if (!target || !readme) throw new Error('Pushed branch target is not a commit');
  return { reachable, commit: target, readme };
}

function canAccessGitWorkspace(env: Env, context: GitContext): boolean {
  const repository = context.repo.state.workspaceGitRepositories[context.repositoryId];
  const document = repository ? context.repo.state.workspaceDocuments[repository.document_id] : null;
  const channel = document ? context.repo.state.channels[document.channel_id] : null;
  const user = context.repo.state.users[context.userId];
  const controls = getRuntimeControls(context.repo.state);
  if (!repository || !document || !channel || !user || !user.email_verified_at || (user.email_verification_version || 0) < getConfig(env).emailVerificationRequiredVersion || controls.maintenance_mode || !controls.workspaces_enabled || !controls.community_tools_enabled) return false;
  if (context.repo.state.userModerationRecords[context.userId] && context.repo.state.userModerationRecords[context.userId].status !== 'active') return false;
  if (document.visibility === 'private') return document.owner_user_id === context.userId;
  if (channel.type === 'dm') return !!context.repo.state.dmParticipants[dmParticipantKey(channel.id, context.userId)] && !context.repo.state.dmHiddenStates[dmHiddenKey(channel.id, context.userId)];
  return !!channel.server_id
    && !!context.repo.state.serverMembers[memberKey(channel.server_id, context.userId)]
    && !Object.values(context.repo.state.serverBans).some((ban) => ban.server_id === channel.server_id && ban.user_id === context.userId && !ban.unbanned_at);
}

export function buildGitRouter() {
  const git = new Hono<{ Bindings: Env }>();
  const slugFor = (value: string | undefined) => String(value || '').replace(/\.git$/, '');

  git.get('/workspaces/:repository/HEAD', async (c) => {
    const context = await resolveGitContext(c.env, slugFor(c.req.param('repository')), c.req.header('authorization'));
    if (context instanceof Response) return context;
    return new Response(`ref: refs/heads/${context.defaultBranch}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  });

  git.get('/workspaces/:repository/info/refs', async (c) => {
    const context = await resolveGitContext(c.env, slugFor(c.req.param('repository')), c.req.header('authorization'));
    if (context instanceof Response) return context;
    if (c.req.query('service') === 'git-receive-pack') {
      const ref = context.head
        ? `${context.head} refs/heads/${context.defaultBranch}`
        : `${ZERO_SHA} capabilities^{}`;
      const advertisement = `${packetLine('# service=git-receive-pack\n')}0000${packetLine(`${ref}\0report-status no-thin\n`)}0000`;
      return new Response(advertisement, { headers: { 'content-type': 'application/x-git-receive-pack-advertisement', 'cache-control': 'no-store' } });
    }
    const body = context.head ? `${context.head}\trefs/heads/${context.defaultBranch}\n` : '';
    // Deliberately plain text: Git then uses the compatible dumb-HTTP read path.
    return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  });

  git.get('/workspaces/:repository/objects/info/packs', async (c) => {
    const context = await resolveGitContext(c.env, slugFor(c.req.param('repository')), c.req.header('authorization'));
    if (context instanceof Response) return context;
    return new Response('\n', { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  });

  git.get('/workspaces/:repository/objects/:prefix/:suffix', async (c) => {
    const context = await resolveGitContext(c.env, slugFor(c.req.param('repository')), c.req.header('authorization'));
    if (context instanceof Response) return context;
    const sha = `${c.req.param('prefix')}${c.req.param('suffix')}`;
    if (!/^[a-f0-9]{40}$/.test(sha)) return new Response('Object not found\n', { status: 404 });
    const object = (await existingGitObjects(context)).get(sha);
    if (object) return new Response(gzipGitObject(looseObject(object)), { headers: { 'content-type': 'application/x-git-loose-object', 'cache-control': 'private, no-store' } });
    return new Response('Object not found\n', { status: 404 });
  });

  git.all('/workspaces/:repository/git-upload-pack', async () => new Response('Smart Git transport is not enabled for this Workspace yet. Use the read-only Git endpoint or the Workspace editor.\n', { status: 501 }));
  git.post('/workspaces/:repository/git-receive-pack', async (c) => {
    const context = await resolveGitContext(c.env, slugFor(c.req.param('repository')), c.req.header('authorization'), 'write');
    if (context instanceof Response) return context;
    if (!canAccessGitWorkspace(c.env, context)) return reportStatus('Workspace write access is no longer available', `refs/heads/${context.defaultBranch}`, 'Workspace write access is no longer available');
    const rate = await checkRateLimit(c.env, 'workspace.git.push', context.credentialId, 5, 60);
    if (!rate.success) return reportStatus('Git push rate limit exceeded', `refs/heads/${context.defaultBranch}`, 'Git push rate limit exceeded');
    const declaredLength = Number(c.req.header('content-length') || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PUSH_BYTES) return reportStatus('Git push exceeds the 1 MiB best-effort limit', `refs/heads/${context.defaultBranch}`, 'Git push exceeds the 1 MiB best-effort limit');
    const body = new Uint8Array(await c.req.raw.arrayBuffer());
    const ref = `refs/heads/${context.defaultBranch}`;
    try {
      if (body.length > MAX_PUSH_BYTES) throw new Error('Git push exceeds the 1 MiB best-effort limit');
      const request = parseReceiveCommands(body);
      if (request.commands.length !== 1) throw new Error('Only one branch update per push is supported');
      const command = request.commands[0];
      if (command.ref !== ref) throw new Error(`Only ${ref} can be updated`);
      if (command.newSha === ZERO_SHA) throw new Error('Branch deletion is not supported');
      const expectedOld = context.head || ZERO_SHA;
      if (command.oldSha !== expectedOld) throw new Error('Branch changed on the server; fetch and merge before pushing');
      const existing = await existingGitObjects(context);
      const pushed = await parseGitPack(body.subarray(request.packOffset), existing, MAX_GIT_OBJECT_BYTES, MAX_GIT_UNPACKED_BYTES);
      const allObjects = new Map(existing);
      pushed.forEach((object) => allObjects.set(object.sha, object));
      const validated = validateWorkspaceCommitChain(command.newSha, expectedOld, allObjects);
      const persisted = pushed.filter((item) => validated.reachable.has(item.sha) && !existing.has(item.sha));
      const storedBytes = Object.values(context.repo.state.workspaceGitObjects).filter((item) => item.repository_id === context.repositoryId).reduce((total, item) => total + item.size, 0);
      const newBytes = persisted.reduce((total, item) => total + item.content.length, 0);
      if (storedBytes + newBytes > WORKSPACE_GIT_MAX_REPOSITORY_BYTES) throw new Error('Workspace Git repository reached its 1 MiB best-effort limit');

      const repository = context.repo.state.workspaceGitRepositories[context.repositoryId];
      const document = repository ? context.repo.state.workspaceDocuments[repository.document_id] : null;
      if (!repository || !document) throw new Error('Workspace repository no longer exists');
      const timestamp = nowIso();
      const authorName = validated.commit.author.replace(/\s*<.*$/, '').trim() || 'Git user';
      const result = await applyWorkspaceGitPush(c.env, {
        repository_id: repository.id,
        credential_id: context.credentialId,
        user_id: context.userId,
        expected_head: context.head,
        required_email_verification_version: getConfig(c.env).emailVerificationRequiredVersion,
        commit: {
          sha: command.newSha,
          repository_id: repository.id,
          parent_sha: validated.commit.parents[0] || null,
          branch: repository.default_branch,
          tree_sha: validated.commit.tree,
          blob_sha: validated.readme.blobSha,
          file_path: 'README.md',
          content: validated.readme.content,
          message: validated.commit.message.slice(0, 500),
          author_user_id: context.userId,
          author_name: authorName.slice(0, 120),
          created_at: timestamp,
        },
        objects: persisted.map((object) => ({
          sha: object.sha,
          type: object.type,
          content_base64: encodeBase64(object.content),
          size: object.content.length,
          created_at: timestamp,
        })),
        document: {
          id: document.id,
          expected_updated_at: document.updated_at,
          content: validated.readme.content,
          updated_at: timestamp,
          updated_by_user_id: context.userId,
        },
        repository_updated_at: timestamp,
      });
      if (!result.applied) {
        const message = result.reason === 'branch_changed' || result.reason === 'document_changed'
          ? 'Branch changed on the server; fetch and merge before pushing'
          : result.reason === 'repository_limit'
            ? 'Workspace Git repository reached its 1 MiB best-effort limit'
            : result.reason === 'access_revoked'
              ? 'Workspace write access is no longer available'
              : 'Git push could not be applied';
        return reportStatus(message, ref, message);
      }
      return reportStatus('ok', ref);
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/[\r\n]/g, ' ').slice(0, 300) : 'Git push could not be processed';
      return reportStatus(message, ref, message);
    }
  });
  git.all('/workspaces/:repository/git-receive-pack', async () => new Response('Use POST for git-receive-pack.\n', { status: 405 }));

  return git;
}
