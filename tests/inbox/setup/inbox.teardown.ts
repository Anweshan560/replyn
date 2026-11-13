import { test as teardown } from '../../../fixtures/test';

// Runs after the inbox tests (project "inbox-teardown"). Leaves the Instagram test conversation
// closed, so the next morning's message opens it again: that is a real customer message starting
// the "note when a customer opens a conversation" workflow, which tests/inbox/workflows checks.
teardown('close the Instagram test conversation for the next message', async ({ inboxApi }) => {
  const { contactId } = await inboxApi.getTestConversation();
  if ((await inboxApi.getConversation(contactId)).status !== 'closed') {
    await inboxApi.updateRecord(contactId, { status: 'closed', snoozedUntil: null });
  }
});
