import { test, expect } from '../../../fixtures/test';
import { toClosingNotePayload, toTagPayload } from '../../../api/SettingsApis';
import { buildClosingNote, buildFollowUpTitle, buildNoteText, buildTag } from '../../../utils/testData';
import { knownBug } from '../../../utils/knownBug';

/**
 * What an agent does to a conversation, through the API: assign, lifecycle, tags, close and reopen,
 * snooze, follow-ups and notes. Every test works on the shared Instagram test conversation (see the
 * testConversation fixture), which is put back as it was afterwards. Nothing here sends a message
 * to Instagram. These tests run one at a time (project "inbox"), since they share one conversation.
 */
test.describe('Inbox conversation actions API', { tag: ['@inbox'] }, () => {
  test.beforeEach(async ({ inboxApi, testConversation }) => {
    // Start from an open conversation, whatever an earlier run left behind.
    await inboxApi.ensureOpen(testConversation.contactId);
  });

  test('should move a conversation between Unassigned and My inbox', async ({
    inboxApi,
    testConversation,
  }) => {
    const { contactId } = testConversation;
    const me = (await inboxApi.currentUser()).id;
    const myInbox = { assignedTo: me, status: 'open' } as const;
    const unassigned = { assignedTo: 'null', status: 'open' } as const;

    await test.step('unassign: responds 200 with no assignee', async () => {
      const state = await inboxApi.updateRecord(contactId, { assignedUserId: null, assignedTeamId: null });
      expect(state.assignedUserId).toBeNull();
    });
    await test.step('it is in Unassigned, not in My inbox', async () => {
      expect(await inboxApi.listedContactIds(unassigned)).toContain(contactId);
      expect(await inboxApi.listedContactIds(myInbox)).not.toContain(contactId);
    });
    const mineBefore = (await inboxApi.countsRecord()).mine;

    await test.step('assign to me: responds 200 with me as the assignee', async () => {
      const state = await inboxApi.updateRecord(contactId, { assignedUserId: me, assignedTeamId: null });
      expect(state.assignedUserId).toBe(me);
    });
    await test.step('it is in My inbox, not in Unassigned, and "mine" counts one more', async () => {
      expect(await inboxApi.listedContactIds(myInbox)).toContain(contactId);
      expect(await inboxApi.listedContactIds(unassigned)).not.toContain(contactId);
      expect((await inboxApi.countsRecord()).mine).toBe(mineBefore + 1);
    });
  });

  test('should count as many conversations in My inbox as the list shows', async ({ inboxApi }) => {
    const me = (await inboxApi.currentUser()).id;
    const counts = await test.step('read the counts', () => inboxApi.countsRecord());
    const listed = await test.step('list My inbox', () =>
      inboxApi.listedContactIds({ assignedTo: me, status: 'open' }));
    expect(counts.mine).toBe(listed.length);
  });

  test('should change the lifecycle stage and log it', async ({
    inboxApi,
    lifecyclesApi,
    testConversation,
  }) => {
    const { contactId } = testConversation;
    const current = (await inboxApi.getConversation(contactId)).lifecycleId;
    const other = (await lifecyclesApi.listRecords()).find((stage) => stage.id !== current && !stage.isLost)!;

    const state = await test.step(`PATCH the lifecycle to "${other.name}"`, () =>
      inboxApi.updateRecord(contactId, { lifecycleId: other.id }));

    await test.step('responds 200 with the new stage', () => expect(state.lifecycleId).toBe(other.id));
    await test.step('the activity log records the change', async () => {
      const [latest] = await inboxApi.activities(contactId);
      expect(latest).toMatchObject({ type: 'lifecycle_change', payload: { lifecycleId: other.id } });
    });
  });

  test('should add and remove a tag', async ({ inboxApi, tagsApi, testConversation, cleanup }) => {
    const { contactId } = testConversation;
    const tag = await test.step('create an inbox tag', () => tagsApi.createRecord(toTagPayload(buildTag())));
    cleanup.add(`tag ${tag.name}`, () => tagsApi.deleteIfExists(tag.id));
    const tagIds = async () =>
      (await inboxApi.getConversation(contactId)).tags.map((t) => (typeof t === 'string' ? t : t.id));

    await test.step('PATCH the tags with it: the conversation has it', async () => {
      await inboxApi.updateRecord(contactId, { tags: [tag.id] });
      expect(await tagIds()).toEqual([tag.id]);
    });
    await test.step('PATCH an empty list: the tag is gone', async () => {
      await inboxApi.updateRecord(contactId, { tags: [] });
      expect(await tagIds()).toEqual([]);
    });
  });

  test('should close with a closing note and reopen', async ({
    inboxApi,
    closingNotesApi,
    testConversation,
    cleanup,
  }) => {
    const { contactId } = testConversation;
    const category = await test.step('create a closing note category', () =>
      closingNotesApi.createRecord(toClosingNotePayload(buildClosingNote())));
    cleanup.add(`closing note ${category.category}`, () => closingNotesApi.deleteIfExists(category.id));
    const summary = `Closed by the API test ${buildNoteText()}`;

    const closed = await test.step('PATCH status "closed" with the closing note', () =>
      inboxApi.updateRecord(contactId, {
        status: 'closed',
        closingNote: { topicId: category.id, topicName: category.category, summary },
      }));

    await test.step('responds 200 and closed; the conversation then has the note', async () => {
      expect(closed.status).toBe('closed');
      // A fresh GET: the PATCH response itself shows the previous note (known bug, test below).
      expect((await inboxApi.getConversation(contactId)).lastClosingNoteId).toBe(category.id);
    });
    await test.step('it is in the Closed list, not the Open one', async () => {
      expect(await inboxApi.listedContactIds({ status: 'closed' })).toContain(contactId);
      expect(await inboxApi.listedContactIds({ status: 'open' })).not.toContain(contactId);
    });
    await test.step('the activity log has the closing note', async () => {
      const [latest] = await inboxApi.activities(contactId);
      expect(latest).toMatchObject({
        type: 'conversation_status_change',
        payload: { status: 'closed', closingNote: { topicId: category.id, summary } },
      });
    });

    await test.step('reopen: open again, logged as opened by a team member', async () => {
      expect((await inboxApi.updateRecord(contactId, { status: 'open' })).status).toBe('open');
      const [latest] = await inboxApi.activities(contactId);
      expect(latest).toMatchObject({
        type: 'conversation_status_change',
        payload: { status: 'open', openReason: 'team_member' },
      });
      expect(await inboxApi.listedContactIds({ status: 'open' })).toContain(contactId);
    });
  });

  test('should answer a close with the closing note it saved', async ({
    inboxApi,
    closingNotesApi,
    testConversation,
    cleanup,
  }) => {
    knownBug('close-response-stale-closing-note');
    const category = await closingNotesApi.createRecord(toClosingNotePayload(buildClosingNote()));
    cleanup.add(`closing note ${category.category}`, () => closingNotesApi.deleteIfExists(category.id));

    const closed = await inboxApi.updateRecord(testConversation.contactId, {
      status: 'closed',
      closingNote: { topicId: category.id, topicName: category.category, summary: buildNoteText() },
    });

    expect(closed.lastClosingNoteId).toBe(category.id);
  });

  test('should not log anything when an open conversation is set to open', async ({
    inboxApi,
    testConversation,
  }) => {
    knownBug('reopen-open-conversation-logged');
    const { contactId } = testConversation;
    const [latestBefore] = await inboxApi.activities(contactId);

    await inboxApi.updateRecord(contactId, { status: 'open' });

    const [latestAfter] = await inboxApi.activities(contactId);
    expect(latestAfter.id, 'no new activity').toBe(latestBefore.id);
  });

  test('should close without a closing note', async ({ inboxApi, testConversation }) => {
    const state = await inboxApi.updateRecord(testConversation.contactId, { status: 'closed' });
    expect(state.status).toBe('closed');
  });

  test('should snooze until a time and unsnooze', async ({ inboxApi, testConversation }) => {
    const { contactId } = testConversation;
    const until = new Date(Date.now() + 60 * 60_000);
    until.setSeconds(0, 0);

    await test.step('PATCH status "snoozed" for an hour: responds 200 with the time', async () => {
      const state = await inboxApi.updateRecord(contactId, {
        status: 'snoozed',
        snoozedUntil: until.toISOString(),
      });
      expect(state).toMatchObject({ status: 'snoozed', snoozedUntil: until.toISOString() });
    });
    await test.step('it is in the Snoozed list', async () => {
      expect(await inboxApi.listedContactIds({ status: 'snoozed' })).toContain(contactId);
    });
    await test.step('unsnooze: open, with no snooze time', async () => {
      const state = await inboxApi.updateRecord(contactId, { status: 'open', snoozedUntil: null });
      expect(state).toMatchObject({ status: 'open', snoozedUntil: null });
    });
  });

  test('should set and remove a follow-up', async ({ inboxApi, testConversation }) => {
    const { contactId } = testConversation;
    const reason = buildFollowUpTitle();
    const dueAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();

    await test.step('PUT a follow-up: responds 200, and the conversation has it', async () => {
      expect((await inboxApi.setFollowUp(contactId, { reason, dueAt })).status()).toBe(200);
      expect((await inboxApi.getConversation(contactId)).followUp).toMatchObject({ reason, dueAt });
    });
    await test.step('DELETE it: responds 200, and it is gone', async () => {
      expect((await inboxApi.removeFollowUp(contactId)).status()).toBe(200);
      expect((await inboxApi.getConversation(contactId)).followUp).toBeNull();
    });
  });

  test('should add a note to the activity log', async ({ inboxApi, testConversation }) => {
    const { contactId } = testConversation;
    const text = buildNoteText();
    const me = (await inboxApi.currentUser()).id;

    const response = await test.step('POST a note', () => inboxApi.addNote(contactId, text));

    await test.step('responds 201, and the log shows it as mine', async () => {
      expect(response.status()).toBe(201);
      const [latest] = await inboxApi.activities(contactId);
      expect(latest).toMatchObject({ type: 'note', userId: me, payload: { text } });
    });
  });

  test('should refuse invalid changes', async ({ inboxApi, testConversation }) => {
    const { contactId } = testConversation;
    for (const [what, send] of [
      ['an unknown status', () => inboxApi.update(contactId, { status: 'bogus' })],
      ['a follow-up without a due date', () => inboxApi.setFollowUp(contactId, {})],
    ] as const) {
      await test.step(`${what}: responds 400 or 422`, async () => {
        const response = await send();
        expect([400, 422], await response.text()).toContain(response.status());
      });
    }
  });

  test('should list conversations by last activity, newest or oldest first', async ({ inboxApi }) => {
    const bumped = async (sortBy: 'newest' | 'oldest') => {
      const response = await inboxApi.searchConversations({ sortBy, status: 'open', limit: 100 });
      return ((await response.json()).data.result as { contact: { lastBumpedAt: string } }[]).map((r) =>
        Date.parse(r.contact.lastBumpedAt),
      );
    };
    const newest = await bumped('newest');
    const oldest = await bumped('oldest');
    expect(newest, 'newest first').toEqual([...newest].sort((a, b) => b - a));
    expect(oldest, 'oldest first').toEqual([...oldest].sort((a, b) => a - b));
  });

  test.describe('with the Agent', () => {
    test('should notify a mentioned teammate until they open the conversation', async ({
      inboxApi,
      agent,
      testConversation,
    }) => {
      const { contactId } = testConversation;
      await agent.inboxApi.markRead(contactId);
      const before = await agent.inboxApi.unreadMentions();

      await test.step(`mention ${agent.name} in a note`, async () => {
        const text = `${buildNoteText()} @[${agent.name}](${agent.id}) please check`;
        expect((await inboxApi.addNote(contactId, text, [agent.id])).status()).toBe(201);
      });

      await test.step('the Agent has one more unread mention, and the conversation is in their Mentions', async () => {
        await expect
          .poll(async () => (await agent.inboxApi.unreadMentions()).mentions)
          .toBe(before.mentions + 1);
        expect(await agent.inboxApi.listedContactIds({ view: 'mentions' })).toContain(contactId);
      });
      await test.step('once the Agent has read it, the mention is no longer unread', async () => {
        expect((await agent.inboxApi.markRead(contactId)).ok()).toBe(true);
        expect((await agent.inboxApi.unreadMentions()).mentions).toBe(before.mentions);
      });
    });

    test('should let an Agent assign, close, reopen, snooze, follow up and add notes', async ({
      agent,
      testConversation,
    }) => {
      const { contactId } = testConversation;
      const api = agent.inboxApi;
      const steps: [string, () => Promise<{ status(): number }>, number][] = [
        [
          'assign to themselves',
          () => api.update(contactId, { assignedUserId: agent.id, assignedTeamId: null }),
          200,
        ],
        ['close', () => api.update(contactId, { status: 'closed' }), 200],
        ['reopen', () => api.update(contactId, { status: 'open' }), 200],
        [
          'snooze',
          () =>
            api.update(contactId, {
              status: 'snoozed',
              snoozedUntil: new Date(Date.now() + 3600e3).toISOString(),
            }),
          200,
        ],
        ['unsnooze', () => api.update(contactId, { status: 'open', snoozedUntil: null }), 200],
        [
          'set a follow-up',
          () =>
            api.setFollowUp(contactId, {
              reason: buildFollowUpTitle(),
              dueAt: new Date(Date.now() + 86400e3).toISOString(),
            }),
          200,
        ],
        ['remove the follow-up', () => api.removeFollowUp(contactId), 200],
        ['add a note', () => api.addNote(contactId, buildNoteText()), 201],
      ];
      for (const [what, send, expected] of steps) {
        await test.step(`${what}: responds ${expected}`, async () =>
          expect((await send()).status()).toBe(expected));
      }
    });
  });
});
