import { test, expect, type Cleanup } from '../../../fixtures/test';
import { toClosingNotePayload, toTagPayload } from '../../../api/SettingsApis';
import {
  INBOUND_MESSAGE_WORKFLOW,
  toEventWorkflowPayload,
  type WorkflowRecord,
  type WorkflowExecution,
  type WorkflowsApi,
} from '../../../api/WorkflowsApi';
import { buildClosingNote, buildNoteText, buildTag, buildWorkflow } from '../../../utils/testData';

/**
 * Workflows that start by themselves when something happens in the inbox, through the API. Each test
 * makes its own workflow whose trigger only matches a test-only tag or closing note category, so it
 * fires for this test's change and nothing else; it is archived afterwards. The last test checks the
 * one workflow that stays on: a real Instagram message from the customer opening the conversation.
 */
test.describe('Workflows started by inbox events API', { tag: ['@inbox', '@workflows'] }, () => {
  test.beforeEach(async ({ inboxApi, testConversation }) => {
    await inboxApi.ensureOpen(testConversation.contactId);
  });

  /**
   * Activate `workflow`, and archive it after the test.
   * @returns a function that finds the workflow's newest run for the contact that started after this
   * call. createRecord may reuse an archived test workflow, which keeps its earlier runs.
   */
  async function switchOn(
    workflowsApi: WorkflowsApi,
    cleanup: Cleanup,
    workflow: WorkflowRecord,
    contactId: string,
  ): Promise<() => Promise<WorkflowExecution | undefined>> {
    cleanup.add(`workflow ${workflow.name}`, () => workflowsApi.deleteIfExists(workflow.id));
    const runsOf = async () =>
      (await workflowsApi.contactExecutions(contactId)).filter((run) => run.workflowId === workflow.id);
    const before = new Set((await runsOf()).map((run) => run.id));
    expect((await workflowsApi.activate(workflow.id)).status(), 'the workflow should switch on').toBe(201);
    return async () => (await runsOf()).find((run) => !before.has(run.id));
  }

  test('should add a note when a watched tag is added', async ({
    inboxApi,
    tagsApi,
    workflowsApi,
    testConversation,
    cleanup,
  }) => {
    const { contactId } = testConversation;
    const tag = await tagsApi.createRecord(toTagPayload(buildTag()));
    cleanup.add(`tag ${tag.name}`, () => tagsApi.deleteIfExists(tag.id));
    const note = `Tagged ${tag.name}: ${buildNoteText()}`;
    const workflow = await workflowsApi.createRecord(
      toEventWorkflowPayload(
        buildWorkflow(),
        { nodeType: 'tag_added', label: 'Tag Added', conditions: { tagIds: [tag.id] } },
        { nodeType: 'add_note', label: 'Add Note', config: { note } },
      ),
    );
    const newRun = await test.step('switch on "Tag Added → Add Note", watching only the test tag', () =>
      switchOn(workflowsApi, cleanup, workflow, contactId));

    await test.step('tag the conversation', () => inboxApi.updateRecord(contactId, { tags: [tag.id] }));

    await test.step('the workflow runs to the end and adds the note, as the system', async () => {
      await expect(async () => {
        expect(await newRun()).toMatchObject({ status: 'completed', completedSteps: 2, totalSteps: 2 });
      }).toPass({ timeout: 30_000 });
      const notes = (await inboxApi.activities(contactId)).filter((a) => a.type === 'note');
      expect(notes.find((a) => a.payload.text === note)).toMatchObject({ userId: null });
    });
  });

  test('should add a tag when the conversation is closed with a watched closing note', async ({
    inboxApi,
    tagsApi,
    closingNotesApi,
    workflowsApi,
    testConversation,
    cleanup,
  }) => {
    const { contactId } = testConversation;
    const tag = await tagsApi.createRecord(toTagPayload(buildTag()));
    cleanup.add(`tag ${tag.name}`, () => tagsApi.deleteIfExists(tag.id));
    const category = await closingNotesApi.createRecord(toClosingNotePayload(buildClosingNote()));
    cleanup.add(`closing note ${category.category}`, () => closingNotesApi.deleteIfExists(category.id));
    const workflow = await workflowsApi.createRecord(
      toEventWorkflowPayload(
        buildWorkflow(),
        {
          nodeType: 'conversation_closed',
          label: 'Conversation Closed',
          conditions: { topicIds: [category.id] },
        },
        { nodeType: 'add_tag', label: 'Add Tag', config: { tags: [tag.id] } },
      ),
    );
    const newRun =
      await test.step('switch on "Conversation Closed → Add Tag", watching only the test category', () =>
        switchOn(workflowsApi, cleanup, workflow, contactId));

    await test.step(`close the conversation as "${category.category}"`, () =>
      inboxApi.updateRecord(contactId, {
        status: 'closed',
        closingNote: { topicId: category.id, topicName: category.category, summary: buildNoteText() },
      }));

    await test.step('the workflow runs and the conversation has the tag', async () => {
      await expect(async () => {
        const tags = (await inboxApi.getConversation(contactId)).tags.map((t) =>
          typeof t === 'string' ? t : t.id,
        );
        expect(tags).toContain(tag.id);
      }).toPass({ timeout: 30_000 });
      expect(await newRun()).toMatchObject({ status: 'completed' });
    });
  });

  test('should not start the workflow when the conversation is closed with another category', async ({
    inboxApi,
    tagsApi,
    closingNotesApi,
    workflowsApi,
    testConversation,
    cleanup,
  }) => {
    const { contactId } = testConversation;
    const tag = await tagsApi.createRecord(toTagPayload(buildTag()));
    cleanup.add(`tag ${tag.name}`, () => tagsApi.deleteIfExists(tag.id));
    const watched = await closingNotesApi.createRecord(toClosingNotePayload(buildClosingNote()));
    const other = await closingNotesApi.createRecord(toClosingNotePayload(buildClosingNote()));
    cleanup.add('closing notes', async () => {
      await closingNotesApi.deleteIfExists(watched.id);
      await closingNotesApi.deleteIfExists(other.id);
    });
    const workflow = await workflowsApi.createRecord(
      toEventWorkflowPayload(
        buildWorkflow(),
        {
          nodeType: 'conversation_closed',
          label: 'Conversation Closed',
          conditions: { topicIds: [watched.id] },
        },
        { nodeType: 'add_tag', label: 'Add Tag', config: { tags: [tag.id] } },
      ),
    );
    const newRun = await switchOn(workflowsApi, cleanup, workflow, contactId);

    await test.step(`close the conversation as "${other.category}" (not watched)`, () =>
      inboxApi.updateRecord(contactId, {
        status: 'closed',
        closingNote: { topicId: other.id, topicName: other.category, summary: buildNoteText() },
      }));

    await test.step('after 10 seconds the workflow has not run and the tag is not there', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      expect(await newRun(), 'no new run').toBeUndefined();
      const tags = (await inboxApi.getConversation(contactId)).tags.map((t) =>
        typeof t === 'string' ? t : t.id,
      );
      expect(tags).not.toContain(tag.id);
    });
  });

  test('should start the workflow when this morning’s customer message opened the conversation', async ({
    inboxApi,
    workflowsApi,
  }) => {
    const { contactId, message } = await test.step('find this morning’s Instagram message', () =>
      inboxApi.getDailyMessage());
    const receivedAt = Date.parse(message.receivedAt);
    const workflowId = await workflowsApi.ensureInboundMessageWorkflow();
    const workflow = (await (await workflowsApi.get(workflowId)).json()).data as WorkflowRecord;
    test.skip(
      Date.parse(workflow.createdAt) > receivedAt,
      'The workflow was switched on after this morning’s message. It is checked from tomorrow.',
    );
    // The inbox teardown closes the conversation after each run, so the morning message opens it: the
    // log then shows it opened, not by a user, right after the message. If it was still open (a run
    // stopped early, or someone reopened it), the message opened nothing and there is nothing to check.
    const openedByMessage = (await inboxApi.activities(contactId)).some(
      (a) =>
        a.type === 'conversation_status_change' &&
        a.payload.status === 'open' &&
        !a.userId &&
        Math.abs(Date.parse(a.createdAt) - receivedAt) < 2 * 60_000,
    );
    test.skip(
      !openedByMessage,
      'The conversation was already open when this morning’s message arrived, so the message did not open it. It is checked again tomorrow.',
    );

    await test.step(`"${INBOUND_MESSAGE_WORKFLOW.name}" ran for it`, async () => {
      const runs = (await workflowsApi.contactExecutions(contactId)).filter(
        (r) => r.workflowId === workflowId,
      );
      const run = runs.find((r) => !r.createdAt || Date.parse(r.createdAt) >= receivedAt - 60_000);
      expect(
        run,
        `a run since ${message.receivedAt}; runs found: ${JSON.stringify(runs.slice(0, 3))}`,
      ).toMatchObject({
        status: 'completed',
      });
    });
  });
});
