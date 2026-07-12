import type { AppRepository } from './state';
import type { UserRecord, WorkspaceDocumentRecord, WorkspaceGitCommitRecord, WorkspaceGitRepositoryRecord } from './domain';
import { nowIso, sha1Bytes } from './security';

const encoder = new TextEncoder();

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function hexBytes(value: string): Uint8Array {
  const output = new Uint8Array(value.length / 2);
  for (let index = 0; index < output.length; index += 1) output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return output;
}

export function gitObjectBytes(type: 'blob' | 'tree' | 'commit' | 'tag', content: Uint8Array): Uint8Array {
  return concatBytes(encoder.encode(`${type} ${content.length}\0`), content);
}

export async function gitObjectSha(type: 'blob' | 'tree' | 'commit' | 'tag', content: Uint8Array): Promise<string> {
  return sha1Bytes(gitObjectBytes(type, content));
}

export async function workspaceGitObjectSet(commit: WorkspaceGitCommitRecord): Promise<Array<{ sha: string; type: 'blob' | 'tree' | 'commit'; bytes: Uint8Array }>> {
  const blobContent = encoder.encode(commit.content);
  const blob = gitObjectBytes('blob', blobContent);
  const treeContent = concatBytes(encoder.encode(`100644 ${commit.file_path}\0`), hexBytes(commit.blob_sha));
  const tree = gitObjectBytes('tree', treeContent);
  const seconds = Math.floor(new Date(commit.created_at).getTime() / 1000);
  const parent = commit.parent_sha ? `parent ${commit.parent_sha}\n` : '';
  const identity = `${commit.author_name} <${commit.author_user_id || 'system'}@users.wyvernhub.net> ${seconds} +0000`;
  const commitContent = encoder.encode(`tree ${commit.tree_sha}\n${parent}author ${identity}\ncommitter ${identity}\n\n${commit.message}\n`);
  const commitBytes = gitObjectBytes('commit', commitContent);
  return [
    { sha: commit.blob_sha, type: 'blob', bytes: blob },
    { sha: commit.tree_sha, type: 'tree', bytes: tree },
    { sha: commit.sha, type: 'commit', bytes: commitBytes },
  ];
}

export async function ensureWorkspaceGitSnapshot(
  repo: AppRepository,
  document: WorkspaceDocumentRecord,
  actor: UserRecord | null,
  message = `Update ${document.title}`,
): Promise<{ repository: WorkspaceGitRepositoryRecord; commit: WorkspaceGitCommitRecord; created: boolean }> {
  let repository = Object.values(repo.state.workspaceGitRepositories).find((item) => item.document_id === document.id);
  const now = nowIso();
  if (!repository) {
    repository = {
      id: repo.nextId('workspace_git_repository'),
      document_id: document.id,
      slug: `workspace-${document.id.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`,
      default_branch: 'main',
      head_commit_sha: null,
      created_at: now,
      updated_at: now,
    };
    repo.state.workspaceGitRepositories[repository.id] = repository;
  }
  const current = repository.head_commit_sha ? repo.state.workspaceGitCommits[repository.head_commit_sha] : null;
  if (current?.content === document.content) return { repository, commit: current, created: false };

  const blobSha = await gitObjectSha('blob', encoder.encode(document.content));
  const treeSha = await gitObjectSha('tree', concatBytes(encoder.encode('100644 README.md\0'), hexBytes(blobSha)));
  const createdAt = document.updated_at || now;
  const authorName = (actor?.display_name || actor?.username || 'Wyvern User').replace(/[\n<>]/g, ' ').trim() || 'Wyvern User';
  const parentSha = repository.head_commit_sha;
  const seconds = Math.floor(new Date(createdAt).getTime() / 1000);
  const identity = `${authorName} <${actor?.id || 'system'}@users.wyvernhub.net> ${seconds} +0000`;
  const commitContent = encoder.encode(`tree ${treeSha}\n${parentSha ? `parent ${parentSha}\n` : ''}author ${identity}\ncommitter ${identity}\n\n${message}\n`);
  const sha = await gitObjectSha('commit', commitContent);
  const commit: WorkspaceGitCommitRecord = {
    sha,
    repository_id: repository.id,
    parent_sha: parentSha,
    branch: repository.default_branch,
    tree_sha: treeSha,
    blob_sha: blobSha,
    file_path: 'README.md',
    content: document.content,
    message,
    author_user_id: actor?.id || null,
    author_name: authorName,
    created_at: createdAt,
  };
  repo.state.workspaceGitCommits[sha] = commit;
  repository.head_commit_sha = sha;
  repository.updated_at = now;
  return { repository, commit, created: true };
}

export function workspaceGitCommits(repo: AppRepository, repositoryId: string): WorkspaceGitCommitRecord[] {
  return Object.values(repo.state.workspaceGitCommits)
    .filter((item) => item.repository_id === repositoryId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}
