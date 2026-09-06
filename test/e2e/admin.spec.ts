import { expect, test } from '@playwright/test';
import { loginViaApi, prepareBrowserSession, registerUserViaApi, seedAuthenticatedSession, type UserCredentials } from './helpers';
import { signBridgePayload } from '../../src/lib/security';

async function ensureAdminUser(request: Parameters<typeof registerUserViaApi>[0]): Promise<UserCredentials> {
  const adminUser: UserCredentials = {
    username: 'e2eadmin',
    email: 'e2eadmin@example.com',
    password: 'correct horse battery',
    displayName: 'E2E Admin',
  };
  const response = await request.post('/api/v1/auth/register', {
    data: {
      username: adminUser.username,
      email: adminUser.email,
      password: adminUser.password,
      display_name: adminUser.displayName,
      accepted_legal: true,
      terms_version: '2026-05-22',
      privacy_version: '2026-05-22',
    },
  });
  expect([200, 400]).toContain(response.status());
  return adminUser;
}

test.describe('wyvern admin e2e', () => {
  test('loads release data and records promotions', async ({ page, request }) => {
    const adminUser = await ensureAdminUser(request);
    const tokens = await loginViaApi(request, adminUser);

    await prepareBrowserSession(page);
    await seedAuthenticatedSession(page, tokens);
    await page.goto('/admin');

    await expect(page.getByTestId('admin-release-summary')).toContainText('Release Channel');
    await expect(page.getByTestId('admin-release-flags')).toContainText('community_tools');
    await expect(page.getByTestId('admin-release-status')).toContainText(/ready to promote|aligned|locked/i);

    const promoteButton = page.getByTestId('admin-promote-button');
    if (await promoteButton.isEnabled()) {
      await promoteButton.click();
      await page.getByTestId('admin-reason-input').fill('Promote after review');
      await page.locator('.modal-overlay .btn-confirm').click();
      await expect(page.getByTestId('admin-release-status')).toContainText(/aligned|nothing to promote/i);
      await expect(page.getByTestId('admin-release-audit')).toContainText('community_tools');
    }
  });

  test('supports user moderation search and inbound mail triage from the admin console', async ({ page, request }) => {
    const adminUser = await ensureAdminUser(request);
    const targetUser: UserCredentials = {
      username: `member${Date.now()}`,
      email: `member-${Date.now()}@example.com`,
      password: 'correct horse battery',
      displayName: 'Target Member',
    };

    await registerUserViaApi(request, targetUser);
    const adminTokens = await loginViaApi(request, adminUser);
    const targetTokens = await loginViaApi(request, targetUser);

    await request.patch('/api/v1/users/me', {
      headers: { Authorization: `Bearer ${targetTokens.access}` },
      data: { avatar: '/wyvern_logo.png', bio: 'Needs review' },
    });

    const mailBody = JSON.stringify({
      from_address: 'sender@example.com',
      to_address: 'support@wyvernhub.net',
      subject: 'Admin mail triage',
      text_body: 'Please help',
    });
    const signed = await signBridgePayload('e2e-mail-secret', new TextEncoder().encode(mailBody).buffer.slice(0) as ArrayBuffer);
    const ingest = await request.post('/api/v1/internal/mail/inbox', {
      headers: {
        'content-type': 'application/json',
        'X-Wyvern-Mail-Timestamp': signed.timestamp,
        'X-Wyvern-Mail-Signature': signed.signature,
      },
      data: JSON.parse(mailBody),
    });
    const ingestBody = await ingest.json();
    const mailId = ingestBody?.data?.item?.id;

    await prepareBrowserSession(page);
    await seedAuthenticatedSession(page, adminTokens);
    await page.goto('/admin');

    await page.getByTestId('admin-user-search').fill(targetUser.username);
    await expect(page.getByTestId('admin-users-results')).toContainText(targetUser.username);
    await expect(page.getByTestId('admin-users-results')).toContainText(targetUser.email);

    await page.locator('#userStatusFilter').selectOption('active');
    await page.locator('#userDirectoryFilter').selectOption('off');
    await page.locator('#userAvatarFilter').selectOption('yes');
    await expect(page.getByTestId('admin-users-results')).toContainText(targetUser.username);
    await page.locator('#userAvatarFilter').selectOption('');

    await page.getByRole('button', { name: 'Remove Avatar' }).first().click();
    await page.getByTestId('admin-reason-input').fill('Avatar violation');
    await page.locator('.modal-overlay .btn-danger').click();
    await expect(page.getByTestId('admin-users-results')).toContainText('No Avatar');

    await expect(page.getByTestId('admin-mail-inbox')).toContainText('Admin mail triage');
    await page.getByText('Admin mail triage').first().click();
    await expect(page.locator('#mailDetail')).toContainText('sender@example.com');
    await page.getByRole('button', { name: 'Save Triage' }).click();
    await expect.poll(async () => {
      const response = await request.get(`/api/v1/admin/mail/inbox/${mailId}`, {
        headers: { Authorization: `Bearer ${adminTokens.access}` },
      });
      const body = await response.json();
      return body?.data?.item?.status || '';
    }).toBe('new');
  });

  test('renders persisted runtime controls and platform-report triage', async ({ page, request }) => {
    const adminUser = await ensureAdminUser(request);
    const reporter = {
      username: `reporter${Date.now()}`,
      email: `reporter-${Date.now()}@example.com`,
      password: 'correct horse battery',
      displayName: 'Report Reporter',
    };
    const target = {
      username: `reporttarget${Date.now()}`,
      email: `report-target-${Date.now()}@example.com`,
      password: 'correct horse battery',
      displayName: 'Report Target',
    };

    await registerUserViaApi(request, reporter);
    await registerUserViaApi(request, target);
    const [adminTokens, reporterTokens, targetTokens] = await Promise.all([
      loginViaApi(request, adminUser),
      loginViaApi(request, reporter),
      loginViaApi(request, target),
    ]);
    const targetMeResponse = await request.get('/api/v1/users/me', {
      headers: { Authorization: `Bearer ${targetTokens.access}` },
    });
    const targetMe = await targetMeResponse.json();
    const reportResponse = await request.post('/api/v1/reports', {
      headers: { Authorization: `Bearer ${reporterTokens.access}` },
      data: {
        target_type: 'profile',
        target_id: targetMe?.data?.id,
        reason: 'harassment',
        details: 'Platform report created by browser coverage.',
      },
    });
    expect(reportResponse.ok()).toBeTruthy();

    await prepareBrowserSession(page);
    await seedAuthenticatedSession(page, adminTokens);
    await page.goto('/admin');

    await expect(page.getByTestId('admin-runtime-controls')).toContainText('Maintenance mode');
    await expect(page.getByTestId('admin-runtime-controls').getByRole('button', { name: 'Save Runtime Controls' })).toBeVisible();
    await expect(page.getByTestId('admin-platform-reports')).toContainText('Profile • harassment');
    await page.getByTestId('admin-platform-reports').getByText('Profile • harassment').click();
    await expect(page.getByTestId('admin-platform-report-detail')).toContainText('Platform report created by browser coverage.');
    await expect(page.getByTestId('admin-platform-report-detail').getByRole('button', { name: 'Save Report Status' })).toBeVisible();
  });
});
