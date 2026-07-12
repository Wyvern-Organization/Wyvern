type LimitRequest = {
  key: string;
  limit: number;
  window_seconds: number;
  now_ms?: number;
};

type LimitState = {
  count: number;
  reset_at: number;
};

export class RateLimitRoom {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const body = await request.json<LimitRequest>();
    const now = body.now_ms || Date.now();
    const windowMs = Math.max(1, body.window_seconds) * 1000;
    const storageKey = `limit:${body.key}`;
    let current = await this.state.storage.get<LimitState>(storageKey);

    if (!current || current.reset_at <= now) {
      current = { count: 0, reset_at: now + windowMs };
    }

    current.count += 1;
    await this.state.storage.put(storageKey, current);
    const alarm = await this.state.storage.getAlarm();
    if (alarm === null || alarm > current.reset_at) await this.state.storage.setAlarm(current.reset_at);

    return Response.json({
      success: current.count <= body.limit,
      count: current.count,
      limit: body.limit,
      reset_at: current.reset_at,
      retry_after: Math.max(1, Math.ceil((current.reset_at - now) / 1000)),
    });
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const entries = await this.state.storage.list<LimitState>({ prefix: 'limit:' });
    const expired: string[] = [];
    let nextAlarm: number | null = null;
    for (const [key, value] of entries) {
      if (value.reset_at <= now) expired.push(key);
      else if (nextAlarm === null || value.reset_at < nextAlarm) nextAlarm = value.reset_at;
    }
    if (expired.length) await this.state.storage.delete(expired);
    if (nextAlarm !== null) await this.state.storage.setAlarm(nextAlarm);
  }
}
