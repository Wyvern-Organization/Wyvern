import { expect } from 'vitest';

export type RealtimeEnvelope = {
  type?: string;
  event?: string;
  channel_id?: string | null;
  channel_ids?: string[];
  data?: Record<string, unknown>;
  backend?: string;
};

export type TestSocket = {
  ws: WebSocket;
  messages: RealtimeEnvelope[];
  mark: () => number;
  waitForMessage: (predicate: (message: RealtimeEnvelope) => boolean, after?: number, timeoutMs?: number) => Promise<RealtimeEnvelope>;
  expectNoMessage: (predicate: (message: RealtimeEnvelope) => boolean, after?: number, waitMs?: number) => Promise<void>;
  requestDisconnect: () => void;
};

export function bindTestSocket(ws: WebSocket): TestSocket {
  const messages: RealtimeEnvelope[] = [];
  ws.addEventListener('message', (event) => {
    const raw = String(event.data || '');
    try {
      messages.push(JSON.parse(raw) as RealtimeEnvelope);
    } catch {
      messages.push({ type: 'raw', data: { raw } });
    }
  });
  ws.accept();

  return {
    ws,
    messages,
    mark: () => messages.length,
    waitForMessage: async (predicate, after = 0, timeoutMs = 1500) => {
      return waitFor(() => messages.slice(after).find(predicate), timeoutMs);
    },
    expectNoMessage: async (predicate, after = 0, waitMs = 100) => {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      const found = messages.slice(after).find(predicate);
      expect(found).toBeUndefined();
    },
    requestDisconnect: () => {
      ws.send(JSON.stringify({ action: 'disconnect' }));
    },
  };
}

export async function waitFor<T>(factory: () => T | undefined, timeoutMs = 1500, intervalMs = 10): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = factory();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}
