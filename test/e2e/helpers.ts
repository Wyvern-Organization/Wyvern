import { expect, type APIRequestContext, type Page } from '@playwright/test';

export interface UserCredentials {
  username: string;
  email: string;
  password: string;
  displayName: string;
}

interface AuthTokens {
  access: string;
  refresh: string | null;
}

const PASSWORD = 'correct horse battery';
const LEGAL_VERSION = '2026-05-22';

export function createUserCredentials(prefix: string): UserCredentials {
  const slug = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
  const username = slug.replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  return {
    username,
    email: `${username}@example.com`,
    password: PASSWORD,
    displayName: `${prefix} ${slug.slice(-4)}`,
  };
}

export async function prepareBrowserSession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const storage = (globalThis as { localStorage?: { setItem: (key: string, value: string) => void } }).localStorage;
    storage?.setItem('changelog_dismissed_v1', 'true');
  });
}

export async function registerUserViaApi(
  request: APIRequestContext,
  credentials: UserCredentials,
): Promise<void> {
  const response = await request.post('/api/v1/auth/register', {
    data: {
      username: credentials.username,
      email: credentials.email,
      password: credentials.password,
      display_name: credentials.displayName,
      accepted_legal: true,
      terms_version: LEGAL_VERSION,
      privacy_version: LEGAL_VERSION,
    },
  });
  expect(response.ok()).toBeTruthy();
}

export async function loginViaApi(
  request: APIRequestContext,
  credentials: UserCredentials,
): Promise<AuthTokens> {
  const response = await request.post('/api/v1/auth/login', {
    data: {
      email: credentials.email,
      password: credentials.password,
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return {
    access: body?.data?.tokens?.access_token || body?.data?.access_token,
    refresh: body?.data?.tokens?.refresh_token || body?.data?.refresh_token || null,
  };
}

export async function seedAuthenticatedSession(
  page: Page,
  tokens: AuthTokens,
): Promise<void> {
  await page.addInitScript((seed) => {
    const session = (globalThis as { sessionStorage?: { setItem: (key: string, value: string) => void } }).sessionStorage;
    const local = (globalThis as { localStorage?: { setItem: (key: string, value: string) => void } }).localStorage;
    session?.setItem('wy_access', seed.access);
    if (seed.refresh) {
      session?.setItem('wy_refresh', seed.refresh);
    }
    local?.setItem('changelog_dismissed_v1', 'true');
  }, tokens);
}

async function mockVerifiedSessionForFeatureTests(page: Page): Promise<void> {
  await page.route('**/api/v1/users/me**', async (route) => {
    const response = await route.fetch();
    const body = await response.json().catch(() => null) as { data?: Record<string, unknown> } | null;
    if (!response.ok() || !body?.data) {
      await route.fulfill({ response });
      return;
    }
    await route.fulfill({
      response,
      json: {
        ...body,
        data: {
          ...body.data,
          email_verified: true,
          email_verified_at: new Date().toISOString(),
        },
      },
    });
  });
  await page.route('**/edge/api/v1/users/me**', async (route) => {
    const response = await route.fetch();
    const body = await response.json().catch(() => null) as { data?: Record<string, unknown> } | null;
    if (!response.ok() || !body?.data) {
      await route.fulfill({ response });
      return;
    }
    await route.fulfill({
      response,
      json: {
        ...body,
        data: {
          ...body.data,
          email_verified: true,
          email_verified_at: new Date().toISOString(),
        },
      },
    });
  });
}

export async function registerThroughUi(page: Page, credentials: UserCredentials, { mockVerifiedSession = false, waitForApp = true }: { mockVerifiedSession?: boolean; waitForApp?: boolean } = {}): Promise<void> {
  await prepareBrowserSession(page);
  if (mockVerifiedSession) await mockVerifiedSessionForFeatureTests(page);
  await page.goto('/');
  await page.getByTestId('auth-switch-register').click();
  await page.getByTestId('auth-displayName').fill(credentials.displayName);
  await page.getByTestId('auth-username').fill(credentials.username);
  await page.getByTestId('auth-email').fill(credentials.email);
  await page.getByTestId('auth-password').fill(credentials.password);
  await page.getByTestId('auth-acceptedLegal').check();
  await page.getByTestId('auth-register-submit').click();
  if (waitForApp) {
    try {
      await waitForShell(page);
    } catch (error) {
      if (!mockVerifiedSession) throw error;
      await page.reload();
      await waitForShell(page);
    }
  }
}

export async function waitForShell(page: Page): Promise<void> {
  await expect(page.getByTestId('server-create-trigger').first()).toBeVisible();
  await expect(page.getByTestId('settings-open-trigger').first()).toBeVisible();
}
