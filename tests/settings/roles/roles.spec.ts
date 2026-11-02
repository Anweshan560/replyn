import { test, expect } from '../../../fixtures/test';
import { toRolePayload } from '../../../api/RolesApi';
import { CONTACT_VISIBILITY, buildRole } from '../../../utils/testData';

// Tests only change roles they create; the built-in roles are only looked at.
test.describe('Settings → Roles', { tag: ['@settings', '@roles'] }, () => {
  test(
    'should open Roles from the Settings menu with the five built-in roles',
    { tag: '@smoke' },
    async ({ rolesPage }) => {
      await test.step('go to Settings → Workspace → Roles', () => rolesPage.openFromDashboard());
      await test.step('Admin, Member, Agent, Marketing and Finance are listed as built-in', async () => {
        for (const name of ['Admin', 'Member', 'Agent', 'Marketing', 'Finance']) {
          await expect(rolesPage.row(name)).toContainText('Built-in');
        }
      });
    },
  );

  test('should not offer Delete for a built-in role', async ({ rolesPage }) => {
    await test.step('open Settings → Roles', () => rolesPage.open());
    await test.step("the Member role's actions are Edit and Copy role only", async () => {
      expect(await rolesPage.actionsOf('Member')).toEqual(['Edit', 'Copy role']);
    });
  });

  test('should not offer Admin as a starting point for a new role', async ({ rolesPage }) => {
    await test.step('open Settings → Roles and press New role', async () => {
      await rolesPage.open();
      await rolesPage.newRoleButton.click();
    });
    await test.step('the dialog offers From scratch and the built-in roles except Admin, and says why', async () => {
      const options = rolesPage.startFromDialog.getByRole('option');
      await expect(options.filter({ hasText: /^From scratch/ })).toHaveCount(1);
      await expect(options.filter({ hasText: /^Admin/ })).toHaveCount(0);
      await expect(rolesPage.startFromDialog).toContainText(
        "Admin holds everything, so it isn't a starting point.",
      );
    });
  });

  test('should save every choice when user creates a role from Agent', async ({
    rolesPage,
    rolesApi,
    cleanup,
  }) => {
    const role = buildRole();
    const agent = await rolesApi.builtIn('Agent');

    await test.step('open Settings → Roles', () => rolesPage.open());
    await test.step('start a new role from Agent: the editor says it was copied', async () => {
      await rolesPage.startNewRole('Agent');
      await expect(rolesPage.editor.summary).toContainText('Everything matches Agent');
    });
    await test.step('fill in name, description and contact access, and tick extra permissions', async () => {
      await rolesPage.editor.fill(role);
      for (const permission of role.extraPermissions) {
        await expect(rolesPage.editor.summary).toContainText(`+ ${permission.label}`);
      }
    });
    const id = await test.step('create the role', () => rolesPage.editor.create());
    cleanup.add(`role ${role.name}`, () => rolesApi.deleteIfExists(id));

    await test.step('the list shows it with its contact access and no members', async () => {
      const row = rolesPage.row(role.name);
      await expect(row).toContainText(role.contactVisibility);
      await expect(row).toContainText('0 members');
    });
    await test.step("the server stored Agent's permissions plus the extras, based on Agent", async () => {
      const stored = await rolesApi.findRecord(id);
      const expected = toRolePayload(role, agent.permissions);
      expect(stored).toMatchObject({ ...expected, permissions: expect.any(Array), isSystem: false });
      expect([...stored!.permissions].sort()).toEqual([...expected.permissions!].sort());
    });
  });

  test('should save the changes when user edits a role', async ({ rolesPage, rolesApi, cleanup }) => {
    const original = buildRole();
    const agent = await rolesApi.builtIn('Agent');
    const created = await test.step('create a role to edit (through the API)', () =>
      rolesApi.createRecord(toRolePayload(original, agent.permissions)));
    cleanup.add(`role ${original.name}`, () => rolesApi.deleteIfExists(created.id));
    const updated = buildRole(original);

    await test.step('open it from its Edit action: Save changes is disabled until something changes', async () => {
      await rolesPage.open();
      await rolesPage.chooseAction(original.name, 'Edit');
      await expect(rolesPage.editor.nameInput).toHaveValue(original.name);
      await expect(rolesPage.editor.footer.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    });
    await test.step('change the name, description and contact access, and save', async () => {
      await rolesPage.editor.nameInput.fill(updated.name);
      await rolesPage.editor.descriptionInput.fill(updated.description);
      await rolesPage.editor.chooseContactVisibility(updated.contactVisibility);
      await rolesPage.editor.save();
    });

    await test.step('the list shows the new name instead of the old one', async () => {
      await expect(rolesPage.row(updated.name)).toBeVisible();
      await expect(rolesPage.row(original.name)).toHaveCount(0);
    });
    await test.step('the server stored the changes and kept the permissions', async () => {
      expect(await rolesApi.findRecord(created.id)).toMatchObject({
        name: updated.name,
        description: updated.description,
        contactVisibility: CONTACT_VISIBILITY[updated.contactVisibility],
        permissions: created.permissions,
      });
    });
  });

  test('should start a new role from an existing one when user copies it', async ({
    page,
    rolesPage,
    rolesApi,
    cleanup,
  }) => {
    const source = buildRole();
    const agent = await rolesApi.builtIn('Agent');
    const created = await test.step('create a role to copy (through the API)', () =>
      rolesApi.createRecord(toRolePayload(source, agent.permissions)));
    cleanup.add(`role ${source.name}`, () => rolesApi.deleteIfExists(created.id));

    await test.step('choose Copy role', async () => {
      await rolesPage.open();
      await rolesPage.chooseAction(source.name, 'Copy role');
    });
    await test.step('a new role opens, copied from it, with its permissions ticked', async () => {
      await expect(rolesPage.editor.heading).toHaveText('New role');
      await expect(page.getByRole('banner')).toContainText(`Copied from ${source.name}`);
      for (const { area, label } of source.extraPermissions) {
        await expect(rolesPage.editor.permission(area, label)).toBeChecked();
      }
    });
  });

  test('should remove a role when user deletes it', async ({ rolesPage, rolesApi, cleanup }) => {
    const role = buildRole();
    const agent = await rolesApi.builtIn('Agent');
    const created = await test.step('create a role to delete (through the API)', () =>
      rolesApi.createRecord(toRolePayload(role, agent.permissions)));
    // Safety net only: does nothing if the test deleted it as expected.
    cleanup.add(`role ${role.name}`, () => rolesApi.deleteIfExists(created.id));

    await test.step('delete it from its actions, confirming the dialog that names it', async () => {
      await rolesPage.open();
      await rolesPage.deleteRole(role.name);
    });
    await test.step('it is gone from the list and the server', async () => {
      await expect(rolesPage.row(role.name)).toHaveCount(0);
      expect(await rolesApi.findRecord(created.id)).toBeUndefined();
    });
  });
});
