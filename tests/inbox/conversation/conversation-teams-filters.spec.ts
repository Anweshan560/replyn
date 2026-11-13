import { test, expect } from '../../../fixtures/test';
import { toSavedFilePayload, toTeamPayload } from '../../../api/SettingsApis';
import { buildSavedFile, buildSavedView, buildTeam } from '../../../utils/testData';

/**
 * Team inboxes, Advanced filters and Saved files in the inbox, on the shared Instagram test
 * conversation (put back as it was afterwards). Nothing is sent to Instagram: the saved file is
 * attached and then removed again.
 */
test.describe('Inbox teams, filters and saved files', { tag: ['@inbox'] }, () => {
  test.beforeEach(async ({ inboxApi, testConversation }) => {
    await inboxApi.ensureOpen(testConversation.contactId);
  });

  test("should list a conversation assigned to a team in the team's inbox", async ({
    conversationPage,
    inboxApi,
    teamsApi,
    testConversation,
    cleanup,
  }) => {
    const { contactId, username } = testConversation;
    const team = await teamsApi.createRecord(toTeamPayload(buildTeam()));
    cleanup.add(`team ${team.name}`, () => teamsApi.deleteIfExists(team.id));
    await inboxApi.updateRecord(contactId, { assignedTeamId: team.id, assignedUserId: null });
    await conversationPage.open(contactId);

    await test.step('the contact panel shows the team', async () => {
      await expect(conversationPage.assignedTeam(team.name)).toBeVisible();
    });
    await test.step(`Teams → "${team.name}": the conversation is listed`, async () => {
      await conversationPage.openTeamList(team.name);
      await expect(conversationPage.listRow(username)).toBeVisible();
    });
  });

  test('should save an Advanced filters rule as a view that lists the conversation', async ({
    page,
    conversationPage,
    savedViewsPage,
    customViewsApi,
    testConversation,
    cleanup,
  }) => {
    const { contactId, username } = testConversation;
    const view = {
      ...buildSavedView(),
      rule: { field: 'First name' as const, operator: 'contains' as const, value: username },
      share: 'Just me' as const,
    };
    await conversationPage.open(contactId);

    const id = await test.step(`Advanced filters → "First name contains ${username}" → save as a view`, () =>
      savedViewsPage.createView(view, {
        from: 'Advanced filters',
        onFilled: async () => {
          // The live count only includes open conversations; ours is one of them.
          await expect(savedViewsPage.matchesText).not.toHaveText(/Matches 0 /);
        },
      }));
    cleanup.add(`view ${view.name}`, () => customViewsApi.deleteIfExists(id));

    await test.step('open the view from the sidebar: the conversation is listed', async () => {
      await savedViewsPage.sidebarLink(view).click();
      await expect(page).toHaveURL(new RegExp(`customView=${id}`));
      await expect(conversationPage.listRow(username)).toBeVisible();
    });
  });

  test('should attach a saved file to the reply box', async ({
    conversationPage,
    savedFilesApi,
    testConversation,
    cleanup,
  }) => {
    const file = buildSavedFile();
    const saved = await savedFilesApi.createRecord(toSavedFilePayload(file));
    cleanup.add(`saved file ${file.name}`, () => savedFilesApi.deleteIfExists(saved.id));
    await conversationPage.open(testConversation.contactId);

    await test.step(`Saved files → "${file.name}"`, () => conversationPage.attachSavedFile(file.name));

    await test.step('it waits above the reply box, ready to send', async () => {
      await expect(conversationPage.pendingAttachment(file.name)).toBeVisible();
    });
    // Never sent (its address is a placeholder). Remove it so nothing is left in the reply box.
    await test.step('Remove attachment: gone again', async () => {
      await conversationPage.removeAttachment();
      await expect(conversationPage.pendingAttachment(file.name)).toBeHidden();
    });
  });
});
