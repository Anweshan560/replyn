import { test, expect } from '../../../fixtures/test';
import { toTeamPayload } from '../../../api/SettingsApis';
import { buildTeam } from '../../../utils/testData';

/**
 * Team inboxes and the filter rules behind Advanced filters, through the API, on the shared Instagram
 * test conversation (put back as it was afterwards). Nothing is sent to Instagram.
 */
test.describe('Inbox teams and filters API', { tag: ['@inbox'] }, () => {
  // The lists below are open conversations only, and the teardown closes the shared one.
  test.beforeEach(async ({ inboxApi, testConversation }) => {
    await inboxApi.ensureOpen(testConversation.contactId);
  });

  test('should list a conversation under the team it is assigned to', async ({
    inboxApi,
    teamsApi,
    testConversation,
    cleanup,
  }) => {
    const { contactId } = testConversation;
    const team = await teamsApi.createRecord(toTeamPayload(buildTeam()));
    cleanup.add(`team ${team.name}`, () => teamsApi.deleteIfExists(team.id));
    const teamList = {
      status: 'open' as const,
      filter: { rules: [{ id: 'team', field: 'team', operator: 'hasAnyOf', value: [team.id] }] },
    };

    await test.step('assign the team (no agent): responds 200 with the team', async () => {
      const state = await inboxApi.updateRecord(contactId, { assignedTeamId: team.id, assignedUserId: null });
      expect(state).toMatchObject({ assignedTeamId: team.id, assignedUserId: null });
    });
    await test.step("it is in the team's list", async () => {
      expect(await inboxApi.listedContactIds(teamList)).toContain(contactId);
    });
    await test.step("unassign the team: no longer in the team's list", async () => {
      await inboxApi.updateRecord(contactId, { assignedTeamId: null });
      expect(await inboxApi.listedContactIds(teamList)).not.toContain(contactId);
    });
  });

  test('should refuse an agent who is not a member of the assigned team', async ({
    inboxApi,
    teamsApi,
    testConversation,
    cleanup,
  }) => {
    const team = await teamsApi.createRecord(toTeamPayload(buildTeam()));
    cleanup.add(`team ${team.name}`, () => teamsApi.deleteIfExists(team.id));
    const me = (await inboxApi.currentUser()).id;

    const response = await inboxApi.update(testConversation.contactId, {
      assignedTeamId: team.id,
      assignedUserId: me,
    });

    expect(response.status()).toBe(400);
    expect((await response.json()).message).toBe('Assigned user is not a member of the assigned team');
  });

  test('should match conversations by an Advanced filters rule', async ({ inboxApi, testConversation }) => {
    const { contactId, username } = testConversation;
    const rule = (value: string) => ({
      status: 'open' as const,
      filter: { rules: [{ id: 'name', field: 'firstName', operator: 'contains', value: [value] }] },
    });

    await test.step(`first name contains "${username}": the conversation matches`, async () => {
      expect(await inboxApi.listedContactIds(rule(username))).toContain(contactId);
    });
    await test.step('a name nobody has: nothing matches', async () => {
      expect(await inboxApi.listedContactIds(rule('qa-no-such-name-000000'))).toEqual([]);
    });
  });
});
