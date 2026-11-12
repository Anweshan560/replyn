import { test, expect } from '../../../fixtures/test';
import { toClosingNotePayload, toSnippetPayload, toTagPayload } from '../../../api/SettingsApis';
import {
  buildClosingNote,
  buildFollowUpTitle,
  buildNoteText,
  buildSnippet,
  buildTag,
} from '../../../utils/testData';

/**
 * What an agent does to a conversation in the inbox: assign, lifecycle, tags, close and reopen,
 * snooze, follow-ups, notes with mentions, quick replies, and live updates between two people.
 * Every test works on the shared Instagram test conversation, which is put back as it was afterwards
 * (testConversation fixture). Nothing here sends a message to Instagram: the quick reply is only
 * inserted, not sent. These tests run one at a time (project "inbox").
 */
test.describe('Inbox conversation actions', { tag: ['@inbox'] }, () => {
  test.beforeEach(async ({ inboxApi, testConversation }) => {
    await inboxApi.ensureOpen(testConversation.contactId);
  });

  test('should unassign and assign to me from the contact panel', async ({
    conversationPage,
    inboxApi,
    testConversation,
  }) => {
    const { contactId, username } = testConversation;
    const me = await inboxApi.currentUser();
    await inboxApi.updateRecord(contactId, { assignedUserId: me.id, assignedTeamId: null });
    await conversationPage.open(contactId);

    await test.step('Unassign me: the panel offers "Assign to me", and the API has no assignee', async () => {
      await conversationPage.unassignMe();
      await expect(conversationPage.assignToMeButton).toBeVisible();
      expect((await inboxApi.getConversation(contactId)).assignedUserId).toBeNull();
    });
    await test.step('it is listed under Unassigned', async () => {
      await conversationPage.openList('Unassigned');
      await expect(conversationPage.listRow(username)).toBeVisible();
    });
    await test.step('Assign to me: the panel shows me, and it is listed under My inbox', async () => {
      await conversationPage.assignToMe();
      await expect(conversationPage.assignee(`${me.name} (me)`)).toBeVisible();
      await conversationPage.openList('My inbox');
      await expect(conversationPage.listRow(username)).toBeVisible();
    });
  });

  test('should change the lifecycle stage from the header', async ({
    conversationPage,
    inboxApi,
    lifecyclesApi,
    testConversation,
  }) => {
    const { contactId } = testConversation;
    const stages = await lifecyclesApi.listRecords();
    const currentId = (await inboxApi.getConversation(contactId)).lifecycleId;
    const other = stages.find((s) => s.id !== currentId && !s.isLost)!;
    await conversationPage.open(contactId);

    await test.step(`pick "${other.name}" in Change lifecycle`, () =>
      conversationPage.changeLifecycle(other.name));

    await test.step('the header shows it, and the API has it', async () => {
      await expect(conversationPage.lifecycleButton(other.name)).toBeVisible();
      expect((await inboxApi.getConversation(contactId)).lifecycleId).toBe(other.id);
    });
  });

  test('should add and remove a tag from the contact panel', async ({
    conversationPage,
    inboxApi,
    tagsApi,
    testConversation,
    cleanup,
  }) => {
    const { contactId } = testConversation;
    const tag = await tagsApi.createRecord(toTagPayload(buildTag()));
    cleanup.add(`tag ${tag.name}`, () => tagsApi.deleteIfExists(tag.id));
    await conversationPage.open(contactId);

    await test.step(`add "${tag.name}": it shows in the panel`, async () => {
      await conversationPage.addTag(tag.name);
      await expect(conversationPage.tag(tag.name)).toBeVisible();
    });
    await test.step('remove it: gone from the panel and the API', async () => {
      await conversationPage.removeTag(tag.name);
      await expect(conversationPage.tag(tag.name)).toBeHidden();
      expect((await inboxApi.getConversation(contactId)).tags).toEqual([]);
    });
  });

  test('should close with a closing note and reopen', async ({
    conversationPage,
    inboxApi,
    closingNotesApi,
    testConversation,
    cleanup,
  }) => {
    const { contactId, username } = testConversation;
    const category = await closingNotesApi.createRecord(toClosingNotePayload(buildClosingNote()));
    cleanup.add(`closing note ${category.category}`, () => closingNotesApi.deleteIfExists(category.id));
    await conversationPage.open(contactId);

    await test.step(`close with "${category.category}" and a summary`, () =>
      conversationPage.close({ category: category.category, summary: `Done ${buildNoteText()}` }));

    await test.step('the header offers Reopen; the API has it closed with the note', async () => {
      await expect(conversationPage.reopenButton).toBeVisible();
      const state = await inboxApi.getConversation(contactId);
      expect(state).toMatchObject({ status: 'closed', lastClosingNoteId: category.id });
    });
    await test.step('it is listed under Closed', async () => {
      await conversationPage.showStatus('Closed');
      await expect(conversationPage.listRow(username)).toBeVisible();
    });
    await test.step('Reopen: the header offers Close again, and it is open', async () => {
      await conversationPage.reopen();
      await expect(conversationPage.closeButton).toBeVisible();
      expect((await inboxApi.getConversation(contactId)).status).toBe('open');
    });
  });

  test('should snooze for an hour and unsnooze', async ({ conversationPage, inboxApi, testConversation }) => {
    const { contactId, username } = testConversation;
    await conversationPage.open(contactId);

    await test.step('snooze for 1 hour: the header offers Unsnooze', async () => {
      await conversationPage.snooze('1 hour');
      await expect(conversationPage.unsnoozeButton).toBeVisible();
    });
    await test.step('the API has it snoozed for about an hour, and it is listed under Snoozed', async () => {
      const { status, snoozedUntil } = await inboxApi.getConversation(contactId);
      expect(status).toBe('snoozed');
      const minutes = (Date.parse(snoozedUntil!) - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(55);
      // "1 hour" is rounded up to the next few minutes.
      expect(minutes).toBeLessThanOrEqual(66);
      await conversationPage.showStatus('Snoozed');
      await expect(conversationPage.listRow(username)).toBeVisible();
    });
    await test.step('Unsnooze: open again', async () => {
      await conversationPage.unsnooze();
      await expect(conversationPage.closeButton).toBeVisible();
      expect((await inboxApi.getConversation(contactId)).status).toBe('open');
    });
  });

  test('should create and remove a follow-up', async ({ conversationPage, inboxApi, testConversation }) => {
    const { contactId } = testConversation;
    const title = buildFollowUpTitle();
    await conversationPage.open(contactId);

    await test.step('Mark as follow up for tomorrow: the header shows it', async () => {
      await conversationPage.createFollowUp(title, 'Tomorrow');
      await expect(conversationPage.editFollowUpButton).toContainText('Tomorrow');
    });
    await test.step('the API has the title, due tomorrow at 9:00', async () => {
      const { followUp } = await inboxApi.getConversation(contactId);
      expect(followUp?.reason).toBe(title);
      const due = new Date(followUp!.dueAt!);
      expect(due.getTime()).toBeGreaterThan(Date.now());
      expect(due.getTime() - Date.now()).toBeLessThan(2 * 24 * 60 * 60_000);
    });
    await test.step('Remove it: gone from the header and the API', async () => {
      await conversationPage.removeFollowUp();
      await expect(conversationPage.editFollowUpButton).toBeHidden();
      expect((await inboxApi.getConversation(contactId)).followUp).toBeNull();
    });
  });

  test('should insert a quick reply into the reply box', async ({
    conversationPage,
    snippetsApi,
    testConversation,
    cleanup,
  }) => {
    const snippet = buildSnippet();
    const created = await snippetsApi.createRecord(toSnippetPayload({ ...snippet, visibility: 'Everyone' }));
    cleanup.add(`snippet ${snippet.name}`, () => snippetsApi.deleteIfExists(created.id));
    await conversationPage.open(testConversation.contactId);

    await test.step(`type "/" and pick "${snippet.name}"`, () =>
      conversationPage.insertQuickReply(snippet.name));

    await test.step('the reply box holds the snippet, ready to send', async () => {
      await expect(conversationPage.replyBox).toHaveValue(snippet.content);
    });
    // Never sent: that would message Instagram. Leave the box empty for the next test.
    await conversationPage.replyBox.fill('');
  });

  test.describe('with the Agent', () => {
    test('should notify a teammate mentioned in a note until they open it', async ({
      conversationPage,
      agent,
      testConversation,
    }) => {
      const { contactId, username } = testConversation;
      await agent.inboxApi.markRead(contactId);
      const before = await agent.inboxApi.unreadMentions();
      const text = buildNoteText();
      await conversationPage.open(contactId);

      await test.step(`write a note mentioning ${agent.name}: it shows in the thread`, async () => {
        await conversationPage.writeNote(text, agent.name);
        await expect(conversationPage.threadItemContaining(text)).toBeVisible();
      });
      await test.step('the Agent has one more unread mention', async () => {
        await expect
          .poll(async () => (await agent.inboxApi.unreadMentions()).mentions)
          .toBe(before.mentions + 1);
      });
      await test.step('the Agent finds it under Mentions, and opening it clears the mention', async () => {
        await agent.conversationPage.open(contactId);
        await agent.conversationPage.openList('Mentions');
        await expect(agent.conversationPage.listRow(username)).toBeVisible();
        await expect(agent.conversationPage.threadItemContaining(text)).toBeVisible();
        await expect.poll(async () => (await agent.inboxApi.unreadMentions()).mentions).toBe(before.mentions);
      });
    });

    test('should show a teammate’s note live, without reloading', async ({
      conversationPage,
      agent,
      testConversation,
    }) => {
      const { contactId } = testConversation;
      const text = buildNoteText();
      await test.step('the Agent has the conversation open', () => agent.conversationPage.open(contactId));
      await conversationPage.open(contactId);

      await test.step('I write a note', () => conversationPage.writeNote(text));

      await test.step('it appears on the Agent’s screen without a reload', async () => {
        await expect(agent.conversationPage.threadItemContaining(text)).toBeVisible({ timeout: 15_000 });
      });
    });
  });
});
