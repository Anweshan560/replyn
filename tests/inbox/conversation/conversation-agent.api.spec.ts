import { test, expect } from '../../../fixtures/test';
import { toTagPayload, toTeamPayload } from '../../../api/SettingsApis';
import { buildNoteText, buildTag, buildTeam } from '../../../utils/testData';

/**
 * What the built-in Agent role may do to a conversation, through the API, as the Agent account.
 * Its defaults (Settings → Roles → Agent): Contacts they see "All contacts", Contacts "View" and
 * "Add and change", Conversations "Assign". Closing, snoozing, notes and follow-ups have no toggle:
 * every role may do them. The admin sets each starting state; the shared Instagram test
 * conversation is put back afterwards. Nothing is sent to Instagram.
 */
test.describe('Inbox: what an Agent may do to a conversation', { tag: ['@inbox', '@permissions'] }, () => {
  test.beforeEach(async ({ inboxApi, testConversation }) => {
    await inboxApi.ensureOpen(testConversation.contactId);
  });

  test("should list other people's and unassigned conversations for an Agent (All contacts)", async ({
    inboxApi,
    agent,
    testConversation,
  }) => {
    const { contactId } = testConversation;
    const me = await inboxApi.currentUser();

    await test.step("assigned to the admin: in the Agent's open list", async () => {
      await inboxApi.updateRecord(contactId, { assignedUserId: me.id, assignedTeamId: null });
      expect(await agent.inboxApi.listedContactIds({ status: 'open' })).toContain(contactId);
    });
    await test.step("unassigned: in the Agent's open list", async () => {
      await inboxApi.updateRecord(contactId, { assignedUserId: null });
      expect(await agent.inboxApi.listedContactIds({ status: 'open' })).toContain(contactId);
    });
  });

  test('should let an Agent take over, hand on and unassign a conversation (Conversations → Assign)', async ({
    inboxApi,
    agent,
    testConversation,
  }) => {
    const { contactId } = testConversation;
    const me = await inboxApi.currentUser();
    await inboxApi.updateRecord(contactId, { assignedUserId: me.id, assignedTeamId: null });

    await test.step("take over the admin's conversation: responds 200, assigned to the Agent", async () => {
      const state = await agent.inboxApi.updateRecord(contactId, { assignedUserId: agent.id });
      expect(state.assignedUserId).toBe(agent.id);
    });
    await test.step('hand it to the admin: responds 200, assigned to the admin', async () => {
      const state = await agent.inboxApi.updateRecord(contactId, { assignedUserId: me.id });
      expect(state.assignedUserId).toBe(me.id);
    });
    await test.step('unassign it: responds 200, assigned to nobody', async () => {
      const state = await agent.inboxApi.updateRecord(contactId, { assignedUserId: null });
      expect(state.assignedUserId).toBeNull();
    });
  });

  test('should let an Agent assign a conversation to a team', async ({
    agent,
    teamsApi,
    testConversation,
    cleanup,
  }) => {
    const team = await teamsApi.createRecord(toTeamPayload(buildTeam()));
    cleanup.add(`team ${team.name}`, () => teamsApi.deleteIfExists(team.id));

    const state = await test.step(`assign "${team.name}" with no agent`, () =>
      agent.inboxApi.updateRecord(testConversation.contactId, {
        assignedTeamId: team.id,
        assignedUserId: null,
      }));

    await test.step('responds 200 with the team', () => {
      expect(state).toMatchObject({ assignedTeamId: team.id, assignedUserId: null });
    });
  });

  test('should let an Agent close, reopen and snooze a conversation', async ({ agent, testConversation }) => {
    const { contactId } = testConversation;
    const until = new Date(Date.now() + 60 * 60 * 1000);

    await test.step('close: responds 200, closed', async () => {
      expect((await agent.inboxApi.updateRecord(contactId, { status: 'closed' })).status).toBe('closed');
    });
    await test.step('reopen: responds 200, open', async () => {
      expect((await agent.inboxApi.updateRecord(contactId, { status: 'open' })).status).toBe('open');
    });
    await test.step('snooze for an hour: responds 200, snoozed', async () => {
      const state = await agent.inboxApi.updateRecord(contactId, {
        status: 'snoozed',
        snoozedUntil: until.toISOString(),
      });
      expect(state).toMatchObject({ status: 'snoozed', snoozedUntil: until.toISOString() });
    });
  });

  test('should let an Agent change the lifecycle stage, tags and broadcast opt-out (Contacts → Add and change)', async ({
    inboxApi,
    agent,
    lifecyclesApi,
    tagsApi,
    testConversation,
    cleanup,
  }) => {
    const { contactId } = testConversation;
    const before = await inboxApi.getConversation(contactId);
    const stage = (await lifecyclesApi.listRecords()).find((s) => s.id !== before.lifecycleId && !s.isLost)!;
    const tag = await tagsApi.createRecord(toTagPayload(buildTag()));
    cleanup.add(`tag ${tag.name}`, () => tagsApi.deleteIfExists(tag.id));
    cleanup.add('opt the test contact back in', () =>
      inboxApi.updateRecord(contactId, { optedOut: false }).then(),
    );

    await test.step(`lifecycle stage "${stage.name}": responds 200 with it`, async () => {
      expect((await agent.inboxApi.updateRecord(contactId, { lifecycleId: stage.id })).lifecycleId).toBe(
        stage.id,
      );
    });
    await test.step(`tag "${tag.name}": the conversation has it`, async () => {
      const tagIds = before.tags.map((t) => (typeof t === 'string' ? t : t.id));
      await agent.inboxApi.updateRecord(contactId, { tags: [...tagIds, tag.id] });
      const after = (await inboxApi.getConversation(contactId)).tags.map((t) =>
        typeof t === 'string' ? t : t.id,
      );
      expect(after).toContain(tag.id);
    });
    await test.step('opt out of broadcasts: opted out', async () => {
      expect((await agent.inboxApi.updateRecord(contactId, { optedOut: true })).optedOutAt).not.toBeNull();
    });
  });

  test('should let an Agent add a note and set a follow-up', async ({ agent, testConversation }) => {
    const { contactId } = testConversation;

    await test.step('add a note: responds 201', async () => {
      expect((await agent.inboxApi.addNote(contactId, buildNoteText())).status()).toBe(201);
    });
    await test.step('set a follow-up for tomorrow: responds 200', async () => {
      const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      expect(
        (await agent.inboxApi.setFollowUp(contactId, { reason: 'qa agent check', dueAt })).status(),
      ).toBe(200);
    });
  });
});
