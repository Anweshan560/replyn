import { test, expect } from '../../fixtures/test';
import { getAgentCredentials } from '../../config/env';
import { AccessPage } from '../../pages/permissions/AccessPage';

// These tests run logged in as the limited test account (role "Agent"), see tests/setup/agent.setup.ts.
// They only open pages and read; nothing is changed.
test.describe('Permissions: Agent in the browser', { tag: ['@permissions'] }, () => {
  test.skip(!getAgentCredentials(), 'TEST_AGENT_USERNAME and TEST_AGENT_PASSWORD are not set');

  test('should show only the pages an Agent may use in the sidebar', async ({ page }) => {
    const access = new AccessPage(page);
    await access.open('/dashboard');

    const paths = await test.step('read the sidebar links', () => access.sidebarPaths());

    await test.step('Home, Inbox, Contacts, Appointments, Snippets and Files, nothing more', () => {
      expect(paths).toEqual([
        '/dashboard',
        '/inbox',
        '/contacts',
        '/appointments',
        '/settings/snippets',
        '/settings/files',
      ]);
    });
  });

  // Pages the Agent role has no permission for, and the permission the message names.
  for (const { name, path, permission } of [
    { name: 'Reports', path: '/reports', permission: 'Can open reports' },
    { name: 'Clinic → Billing', path: '/clinics/billing', permission: 'Can view the billing ledger' },
    { name: 'Settings → Roles', path: '/settings/roles', permission: 'Can manage roles' },
    {
      name: 'Settings → API keys and webhooks',
      path: '/settings/developer',
      permission: 'Can manage API keys and webhooks',
    },
  ]) {
    test(`should block ${name} when opened by its URL`, async ({ page }) => {
      const access = new AccessPage(page);

      await test.step(`open ${path}`, () => access.open(path));

      await test.step(`says "You don't have access to this" and names "${permission}"`, async () => {
        await expect(access.noAccessHeading).toBeVisible();
        await expect(access.missingPermission(permission)).toBeVisible();
      });
    });
  }

  test('should send an Agent who opens Organization settings back to Home', async ({ page }) => {
    const access = new AccessPage(page);

    await test.step('open /settings/organization', () => access.open('/settings/organization'));

    await test.step('lands on /dashboard', () => expect(page).toHaveURL('/dashboard'));
  });
});
