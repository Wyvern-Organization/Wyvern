import type { ApiEnvelope } from './types';

export function successResponse<T>(data: T, status = 200): Response {
  const payload: ApiEnvelope<T> = {
    success: true,
    data,
    error: null,
  };

  return json(payload, status);
}

export function errorResponse(code: string, message: string, status = 400, details: unknown = null): Response {
  const payload: ApiEnvelope<null> = {
    success: false,
    data: null,
    error: {
      code,
      message,
      details,
    },
  };

  return json(payload, status);
}

export function json(payload: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}
