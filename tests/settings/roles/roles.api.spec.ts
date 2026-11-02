import { test, expect } from '../../../fixtures/test';
import { toRolePayload } from '../../../api/RolesApi';
import { env } from '../../../config/env';
import { buildRole, buildWorkspaceInvitee } from '../../../utils/testData';
import { knownBug } from '../../../utils/knownBug';

// Tests only change roles they create; built-in roles are read, never changed or deleted.
test.describe('Roles API', { tag: ['@settings', '@roles'] }, () => {
  test('should list the five built-in roles, marked as system roles', async ({ rolesApi }) => {
    const roles = await test.step('GET the roles', () => rolesApi.listRecords());

    await test.step('Admin, Member, Agent, Marketing and Finance are there, as system roles', () => {
      for (const id of [
        'workspace:admin',
        'workspace:member',
        'workspace:agent',
        'workspace:marketing',
        'workspace:finance',
      ]) {
        expect(
          roles.find((role) => role.id === id),
          `${id} should be listed`,
        ).toMatchObject({ isSystem: true });
      }
    });
  });

  test('should list every permission with the ones it needs', async ({ rolesApi }) => {
    const response = await test.step('GET the permission catalog', () => rolesApi.catalog());

    await test.step('responds 200; "edit contacts" needs "view contacts"', async () => {
      expect(response.status()).toBe(200);
      const { permissions } = (await response.json()).data;
      expect(permissions).toContainEqual({ key: 'contacts.edit', requires: ['contacts.view'] });
      expect(permissions).toContainEqual({ key: 'contacts.view', requires: [] });
    });
  });

  test('should create a role and return every field that was sent', async ({ rolesApi, cleanup }) => {
    const payload = toRolePayload(buildRole(), (await rolesApi.builtIn('Agent')).permissions);

    const response = await test.step('POST a new role', () => rolesApi.create(payload));
    const body = await response.json();
    if (body.data?.id) cleanup.add(`role ${payload.name}`, () => rolesApi.deleteIfExists(body.data.id));

    await test.step('responds 201 with every field, not a system role, and no members', () => {
      expect(response.status()).toBe(201);
      expect(body.data).toMatchObject({
        ...payload,
        permissions: expect.any(Array),
        isSystem: false,
        memberCount: 0,
      });
      expect([...body.data.permissions].sort()).toEqual([...payload.permissions!].sort());
    });
  });

  test('should update a role', async ({ rolesApi, cleanup }) => {
    const agent = await rolesApi.builtIn('Agent');
    const original = buildRole();
    const created = await test.step('create a role', () =>
      rolesApi.createRecord(toRolePayload(original, agent.permissions)));
    cleanup.add(`role ${original.name}`, () => rolesApi.deleteIfExists(created.id));
    const { name, description, contactVisibility } = toRolePayload(buildRole(original), agent.permissions);

    const response =
      await test.step('PATCH the name, description and contact access (with its permissions)', () =>
        rolesApi.update(created.id, {
          name,
          description,
          contactVisibility,
          permissions: created.permissions,
        }));

    await test.step('responds 200, and the list shows the new values', async () => {
      expect(response.status()).toBe(200);
      expect(await rolesApi.findRecord(created.id)).toMatchObject({ name, description, contactVisibility });
    });
  });

  test('should rename a role without resending its permissions', async ({ rolesApi, cleanup }) => {
    knownBug('role-rename-needs-permissions');
    const agent = await rolesApi.builtIn('Agent');
    const created = await test.step('create a role', () =>
      rolesApi.createRecord(toRolePayload(buildRole(), agent.permissions)));
    cleanup.add(`role ${created.name}`, () => rolesApi.deleteIfExists(created.id));
    const { name } = buildRole();

    const response = await test.step('PATCH only the name', () => rolesApi.update(created.id, { name }));

    await test.step('responds 200 with the new name and the same permissions', async () => {
      expect(response.status()).toBe(200);
      expect(await rolesApi.findRecord(created.id)).toMatchObject({ name, permissions: created.permissions });
    });
  });

  test('should never store a permission without the ones it needs', async ({ rolesApi, cleanup }) => {
    const payload = { ...toRolePayload(buildRole(), []), permissions: ['contacts.edit'] };

    const response = await test.step('POST a role that can edit contacts but not view them', () =>
      rolesApi.create(payload));
    const body = await response.json();
    if (body.data?.id) cleanup.add(`role ${payload.name}`, () => rolesApi.deleteIfExists(body.data.id));

    await test.step('the stored role cannot edit contacts it cannot see', () => {
      // Today the API answers 201 and quietly drops the permission; a 422 would also be fine.
      if (response.status() === 201) expect(body.data.permissions).not.toContain('contacts.edit');
      else expect(response.status()).toBe(422);
    });
  });

  test('should never give an Agent-based role a Member-only permission', async ({ rolesApi, cleanup }) => {
    const payload = { ...toRolePayload(buildRole(), []), permissions: ['reports.view'] };

    const response = await test.step('POST an Agent-based role with "view reports"', () =>
      rolesApi.create(payload));
    const body = await response.json();
    if (body.data?.id) cleanup.add(`role ${payload.name}`, () => rolesApi.deleteIfExists(body.data.id));

    await test.step('the stored role cannot view reports', () => {
      // Today the API answers 201 and quietly drops the permission; a 422 would also be fine.
      if (response.status() === 201) expect(body.data.permissions).not.toContain('reports.view');
      else expect(response.status()).toBe(422);
    });
  });

  test('should refuse to delete a role that a pending invitation uses', async ({
    rolesApi,
    workspaceUsersApi,
    cleanup,
  }) => {
    const role = await test.step('create a role', async () =>
      rolesApi.createRecord(toRolePayload(buildRole(), (await rolesApi.builtIn('Agent')).permissions)));
    cleanup.add(`role ${role.name}`, () => rolesApi.deleteIfExists(role.id));
    const invitationId = await test.step('invite an @example.com user with that role', () =>
      workspaceUsersApi.addForSetup({ ...buildWorkspaceInvitee(), roleId: role.id }));
    // Registered last, so it runs first: revoke the invitation, then the role can be deleted.
    cleanup.add('invitation', () => workspaceUsersApi.revokeIfPending(invitationId));

    const response = await test.step('DELETE the role', () => rolesApi.delete(role.id));

    await test.step('responds 409 asking to change or revoke the invitations first', async () => {
      expect(response.status()).toBe(409);
      expect((await response.json()).message).toBe(
        'Pending invitations use this role. Change or revoke them first',
      );
      expect(await rolesApi.findRecord(role.id)).toBeDefined();
    });
  });

  test('should delete a role so it leaves the list', async ({ rolesApi, cleanup }) => {
    const role = await test.step('create a role', async () =>
      rolesApi.createRecord(toRolePayload(buildRole(), (await rolesApi.builtIn('Agent')).permissions)));
    cleanup.add(`role ${role.name}`, () => rolesApi.deleteIfExists(role.id));

    const response = await test.step('DELETE it', () => rolesApi.delete(role.id));

    await test.step('responds 200, and the list no longer contains it', async () => {
      expect(response.status()).toBe(200);
      expect(await rolesApi.findRecord(role.id)).toBeUndefined();
    });
  });

  for (const [description, change, field] of [
    ['an unknown contact access', { contactVisibility: 'everyone' }, 'contactVisibility'],
    ['an unknown permission', { permissions: ['nope.nope'] }, 'permissions'],
    ['Admin as its base', { base: 'workspace:admin' }, 'base'],
  ] as const) {
    test(`should reject a role with ${description} with 422`, async ({ rolesApi, cleanup }) => {
      const payload = { ...toRolePayload(buildRole(), []), ...change } as never;

      const response = await test.step(`POST a role with ${description}`, () => rolesApi.create(payload));
      const body = await response.json();
      if (body.data?.id) cleanup.add('role', () => rolesApi.deleteIfExists(body.data.id));

      await test.step(`responds 422 naming ${field}`, () => {
        expect(response.status()).toBe(422);
        expect(Object.keys(body.message)).toEqual([field]);
      });
    });
  }

  test('should reject a request without a login token with 401', async ({
    request,
    rolesApi,
    apiHeaders,
  }) => {
    const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

    const response = await test.step('GET the roles without a login token', () =>
      request.get(`${env.apiUrl}${rolesApi.path}`, { headers: headersWithoutToken }));

    await test.step('responds 401', () => expect(response.status()).toBe(401));
  });
});
