import { test, expect } from '../../../fixtures/test';
import { toTagPayload } from '../../../api/SettingsApis';
import { toEventWorkflowPayload } from '../../../api/WorkflowsApi';
import { buildNoteText, buildTag, buildWorkflow } from '../../../utils/testData';

/**
 * A workflow started by something an agent does in the inbox: tagging the conversation from the
 * contact panel adds the workflow's note to the thread. The workflow only watches a test-only tag,
 * so it fires for nothing else, and is archived afterwards.
 */
test.describe('Workflows started by inbox events', { tag: ['@inbox', '@workflows'] }, () => {
  test('should show the note a workflow adds when the agent tags the conversation', async ({
    conversationPage,
    inboxApi,
    tagsApi,
    workflowsApi,
    testConversation,
    cleanup,
  }) => {
    const { contactId } = testConversation;
    await inboxApi.ensureOpen(contactId);
    const tag = await tagsApi.createRecord(toTagPayload(buildTag()));
    cleanup.add(`tag ${tag.name}`, () => tagsApi.deleteIfExists(tag.id));
    const note = `Tagged ${tag.name} by an agent: ${buildNoteText()}`;
    const workflow = await workflowsApi.createRecord(
      toEventWorkflowPayload(
        buildWorkflow(),
        { nodeType: 'tag_added', label: 'Tag Added', conditions: { tagIds: [tag.id] } },
        { nodeType: 'add_note', label: 'Add Note', config: { note } },
      ),
    );
    cleanup.add(`workflow ${workflow.name}`, () => workflowsApi.deleteIfExists(workflow.id));
    expect((await workflowsApi.activate(workflow.id)).status()).toBe(201);
    await conversationPage.open(contactId);

    await test.step(`add "${tag.name}" from the contact panel`, () => conversationPage.addTag(tag.name));

    await test.step('the workflow’s note appears in the thread without a reload', async () => {
      await expect(conversationPage.threadItemContaining(note)).toBeVisible({ timeout: 30_000 });
    });
  });
});
