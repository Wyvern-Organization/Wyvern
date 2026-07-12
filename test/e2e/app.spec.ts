import { expect, test } from '@playwright/test';
import { createUserCredentials, registerThroughUi, registerUserViaApi, waitForShell } from './helpers';

test.describe('wyvern shell e2e', () => {
  test('serves voice feedback sounds from the public asset path', async ({ request }) => {
    for (const sound of ['call.wav', 'rtc_connect.wav', 'rtc_disconnect.wav', 'rtc_error.wav']) {
      const response = await request.get(`/sounds/${sound}`);
      expect(response.ok()).toBeTruthy();
      expect(response.headers()['content-type']).toContain('audio/wav');
    }
  });

  test('connects realtime through the Worker API route', async ({ page }) => {
    const user = createUserCredentials('realtime-route');
    await page.addInitScript(() => {
      (globalThis as unknown as { __nativeWebSocket?: typeof WebSocket }).__nativeWebSocket = WebSocket;
    });
    const socketUrl = new Promise<string>((resolve) => {
      page.once('websocket', (socket) => resolve(socket.url()));
    });

    await registerThroughUi(page, user, { mockVerifiedSession: true });
    await page.evaluate(() => {
      const browser = globalThis as unknown as {
        __nativeWebSocket: new (url: string) => WebSocket;
        sessionStorage: { getItem: (key: string) => string | null };
        location: { origin: string };
      };
      const token = browser.sessionStorage.getItem('wy_access');
      const wsUrl = `${browser.location.origin.replace(/^http/, 'ws')}/api/v1/ws?token=${encodeURIComponent(token || '')}`;
      const socket = new browser.__nativeWebSocket(wsUrl);
      socket.addEventListener('open', () => socket.close());
    });
    await expect(socketUrl).resolves.toContain('/api/v1/ws?token=');
  });

  test('covers registration, server/channel messaging, DMs, and settings', async ({ page, request }) => {
    const primaryUser = createUserCredentials('shell');
    const buddyUser = createUserCredentials('buddy');
    const serverName = `Builders ${Date.now()}`;
    const channelName = `general-${Math.random().toString(36).slice(2, 6)}`;
    const serverMessage = `Server hello ${Date.now()}`;
    const dmMessage = `DM hello ${Date.now()}`;
    const updatedDisplayName = `Captain ${Math.random().toString(36).slice(2, 6)}`;
    const updatedBio = `Bio ${Date.now()}`;

    await registerUserViaApi(request, buddyUser);
    await registerThroughUi(page, primaryUser, { mockVerifiedSession: true });

    await page.getByTestId('server-create-trigger').first().click();
    await expect(page.getByTestId('server-create-modal')).toBeVisible();
    await page.getByTestId('server-create-name').fill(serverName);
    await page.getByTestId('server-create-details').fill('A browser-tested server');
    await page.getByTestId('server-create-save').click();

    await page.getByTestId('channel-create-trigger').click();
    await expect(page.getByTestId('channel-create-modal')).toBeVisible();
    await page.getByTestId('channel-create-name').fill(channelName);
    await page.getByTestId('channel-create-save').click();

    await expect(page.getByTestId('message-composer-input')).toBeVisible();
    await page.getByTestId('message-composer-input').fill(serverMessage);
    await page.getByTestId('message-send-button').click();
    await expect(page.getByText(serverMessage)).toBeVisible();

    await page.getByRole('button', { name: 'Open Server Settings' }).click();
    await page.getByRole('button', { name: 'Moderation' }).click();
    await expect(page.getByTestId('server-moderation-panel')).toContainText('Report queue');
    await expect(page.getByTestId('server-moderation-panel')).toContainText('Member tools');
    await page.locator('.server-settings-hub-modal').getByRole('button', { name: 'Close' }).click();

    await page.reload();
    await waitForShell(page);
    await page.locator(`.server-pill[title="${serverName}"]`).click();
    await expect(page.getByText(serverMessage)).toBeVisible();

    await page.getByTestId('nav-direct-messages').first().click();
    await page.getByTestId('dm-create-trigger').click();
    await expect(page.getByTestId('dm-create-modal')).toBeVisible();
    await page.getByTestId('dm-create-input').fill(buddyUser.username);
    await page.getByTestId('dm-create-submit').click();
    await expect(page.getByTestId('message-composer-input')).toBeVisible();
    await page.getByTestId('message-composer-input').fill(dmMessage);
    await page.getByTestId('message-send-button').click();
    await expect(page.getByText(dmMessage)).toBeVisible();

    await page.getByTestId('settings-open-trigger').first().click();
    await expect(page.getByTestId('settings-hub-modal')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Billing' })).toHaveCount(0);
    await expect(page.getByTestId('settings-premium-accent')).toBeVisible();
    await page.getByTestId('settings-display-name').fill(updatedDisplayName);
    await page.getByTestId('settings-bio').fill(updatedBio);
    await page.getByTestId('settings-save-profile').click();
    await expect(page.getByTestId('settings-display-name')).toHaveValue(updatedDisplayName);
    await page.getByRole('button', { name: 'Close' }).click();

    await page.reload();
    await page.getByTestId('settings-open-trigger').first().click();
    await expect(page.getByTestId('settings-display-name')).toHaveValue(updatedDisplayName);
    await expect(page.getByTestId('settings-bio')).toHaveValue(updatedBio);
  });

  test('blocks an unverified UI A account at the email-verification gate', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const primaryUser = createUserCredentials('mobile-ui-a');

    await registerThroughUi(page, primaryUser, { waitForApp: false });
    await expect(page.getByTestId('email-verification-view')).toBeVisible();
    await expect(page.getByTestId('email-verification-banner')).toBeVisible();
    await expect(page.getByTestId('email-verification-request')).toBeVisible();
    await expect(page.getByTestId('server-create-trigger')).toHaveCount(0);
    const dimensions = await page.evaluate(() => {
      const documentElement = (globalThis as unknown as {
        document: { documentElement: { scrollWidth: number; clientWidth: number } };
      }).document.documentElement;
      return { scrollWidth: documentElement.scrollWidth, clientWidth: documentElement.clientWidth };
    });
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  });

  test('does not launch the disabled Edge shell from a stale local preference', async ({ page }) => {
    const user = createUserCredentials('edge-disabled');
    await registerThroughUi(page, user, { mockVerifiedSession: true });
    await page.evaluate(() => {
      const browser = globalThis as unknown as { localStorage: { setItem(key: string, value: string): void } };
      browser.localStorage.setItem('wyvern_edge_mode_enabled', '1');
    });
    await page.reload();

    await expect(page.getByTestId('server-create-trigger').first()).toBeVisible();
    await expect(page.locator('iframe.edge-shell-frame')).toHaveCount(0);
  });
});
