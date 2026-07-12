import { getConfig } from './config';
import type { Env } from './types';

export interface OutboundMailInput {
  from_address: string;
  from_name?: string | null;
  to: string[];
  subject: string;
  text_body: string;
  html_body?: string | null;
  in_reply_to?: string | null;
  references?: string | null;
}

export interface OutboundMailResult {
  message_id: string | null;
  result: string | null;
  raw: unknown;
}

export async function sendViaSmtp2go(env: Env, input: OutboundMailInput): Promise<OutboundMailResult> {
  const config = getConfig(env);
  if (!config.smtp2goApiKey) throw new Error('SMTP2GO API key is not configured');
  const endpoint = `${config.smtp2goBaseUrl}/email/send`;
  const sender = input.from_name?.trim()
    ? `"${input.from_name.trim().replace(/"/g, '\\"')}" <${input.from_address}>`
    : input.from_address;

  const custom_headers = [
    input.in_reply_to ? { header: 'In-Reply-To', value: input.in_reply_to } : null,
    input.references ? { header: 'References', value: input.references } : null,
  ].filter(Boolean);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      'X-Smtp2go-Api-Key': config.smtp2goApiKey,
    },
    body: JSON.stringify({
      sender,
      to: input.to,
      subject: input.subject,
      text_body: input.text_body,
      ...(input.html_body ? { html_body: input.html_body } : {}),
      ...(custom_headers.length ? { custom_headers } : {}),
    }),
  });

  const raw = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof raw === 'object' && raw && 'data' in raw
      ? String((raw as { data?: { error?: string } }).data?.error || '')
      : '';
    throw new Error(message || `SMTP2GO request failed with ${response.status}`);
  }

  const data = (raw && typeof raw === 'object' && 'data' in raw ? (raw as { data?: Record<string, unknown> }).data : null) || {};
  return {
    message_id: typeof data.email_id === 'string' ? data.email_id : typeof data.schedule_id === 'string' ? data.schedule_id : null,
    result: typeof (raw as { result?: unknown })?.result === 'string' ? String((raw as { result?: unknown }).result) : null,
    raw,
  };
}
