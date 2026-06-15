import { createEmptyState } from './state';
import type { AppState } from './domain';

export class AppStateRoom {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname.endsWith('/state')) {
      const stored = (await this.state.storage.get<AppState>('state')) || createEmptyState();
      return Response.json({ success: true, data: stored, error: null });
    }

    if (request.method === 'PUT' && url.pathname.endsWith('/state')) {
      const payload = await request.json() as AppState;
      await this.state.storage.put('state', payload);
      return Response.json({ success: true, data: { saved: true }, error: null });
    }

    if (request.method === 'DELETE' && url.pathname.endsWith('/state')) {
      await this.state.storage.delete('state');
      return Response.json({ success: true, data: { reset: true }, error: null });
    }

    return new Response('Not found', { status: 404 });
  }
}
