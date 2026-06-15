import { createEmptyState } from './state';
import type { AppState } from './domain';

export class PresenceRoom {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname.endsWith('/snapshot')) {
      const snapshot = (await this.state.storage.get<Record<string, string>>('presence')) || {};
      return Response.json({ success: true, data: snapshot, error: null });
    }

    if (request.method === 'PUT' && url.pathname.endsWith('/presence')) {
      const body = (await request.json()) as { user_id: string; presence: string };
      const snapshot = (await this.state.storage.get<Record<string, string>>('presence')) || {};
      snapshot[body.user_id] = body.presence;
      await this.state.storage.put('presence', snapshot);
      return Response.json({ success: true, data: body, error: null });
    }

    if (request.method === 'GET' && url.pathname.endsWith('/app-state')) {
      const appState = (await this.state.storage.get<AppState>('app-state')) || createEmptyState();
      return Response.json({ success: true, data: appState, error: null });
    }

    if (request.method === 'PUT' && url.pathname.endsWith('/app-state')) {
      const body = (await request.json()) as AppState;
      await this.state.storage.put('app-state', body);
      return Response.json({ success: true, data: { saved: true }, error: null });
    }

    return new Response('Not found', { status: 404 });
  }
}
