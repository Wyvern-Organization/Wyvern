import { applyWorkspaceGitPushPatch, createEmptyState, normalizeState, type WorkspaceGitPushPatch } from './state';
import type { AppState } from './domain';

export class AppStateRoom {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname.endsWith('/state')) {
      const snapshot = await this.state.storage.transaction(async (transaction) => ({
        stored: (await transaction.get<AppState>('state')) || createEmptyState(),
        revision: (await transaction.get<number>('state_revision')) || 0,
      }));
      return Response.json({ success: true, data: snapshot.stored, revision: snapshot.revision, error: null });
    }

    if (request.method === 'PUT' && url.pathname.endsWith('/state')) {
      const payload = await request.json() as AppState;
      const supplied = request.headers.get('X-Wyvern-State-Revision');
      const result = await this.state.storage.transaction(async (transaction) => {
        const currentRevision = (await transaction.get<number>('state_revision')) || 0;
        if (supplied !== null && (!/^\d+$/.test(supplied) || Number(supplied) !== currentRevision)) {
          return { saved: false as const, revision: currentRevision };
        }
        const revision = currentRevision + 1;
        await transaction.put('state', payload);
        await transaction.put('state_revision', revision);
        return { saved: true as const, revision };
      });
      if (!result.saved) return Response.json({ success: false, data: { revision: result.revision }, error: { code: 'STATE_CONFLICT' } }, { status: 409 });
      return Response.json({ success: true, data: { saved: true, revision: result.revision }, error: null });
    }

    if (request.method === 'POST' && url.pathname.endsWith('/state/workspace-git-push')) {
      const payload = await request.json() as WorkspaceGitPushPatch;
      const result = await this.state.storage.transaction(async (transaction) => {
        const stored = normalizeState((await transaction.get<AppState>('state')) || createEmptyState());
        const applied = applyWorkspaceGitPushPatch(stored, payload);
        if (applied.applied) {
          const revision = ((await transaction.get<number>('state_revision')) || 0) + 1;
          await transaction.put('state', stored);
          await transaction.put('state_revision', revision);
        }
        return applied;
      });
      return Response.json({ success: result.applied, data: result, error: result.applied ? null : { code: result.reason } });
    }

    if (request.method === 'DELETE' && url.pathname.endsWith('/state')) {
      const revision = await this.state.storage.transaction(async (transaction) => {
        await transaction.delete('state');
        const next = ((await transaction.get<number>('state_revision')) || 0) + 1;
        await transaction.put('state_revision', next);
        return next;
      });
      return Response.json({ success: true, data: { reset: true, revision }, error: null });
    }

    return new Response('Not found', { status: 404 });
  }
}
