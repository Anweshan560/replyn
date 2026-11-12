import { test, expect } from '../../../fixtures/test';

/**
 * The daily Instagram message, in the inbox. A scheduled job (scripts/instagram/send-dm.ts) DMs the
 * Instagram account connected to the test workspace every morning; this test finds that message in
 * the conversation and replies from Replyn, as an agent would. See README, "Daily Instagram message".
 * The reply really reaches the sender's throwaway Instagram account.
 */
test.describe('Instagram inbound messages', { tag: ['@inbox', '@instagram'] }, () => {
  test('should show the daily Instagram message and deliver a reply', async ({
    conversationPage,
    inboxApi,
  }) => {
    const { contactId, message } = await test.step('find the newest daily message', () =>
      inboxApi.getDailyMessage());

    await test.step('open the conversation: the message is in the thread', async () => {
      await conversationPage.open(contactId);
      await expect(conversationPage.message(message.text!)).toBeVisible();
    });

    const text = `AUTOREPLY ${new Date().toISOString()} (UI) Thanks, we will get back to you shortly.`;
    const reply = await test.step('reply from the reply box', () => conversationPage.reply(text));

    await test.step('the reply shows in the thread and the box is empty again', async () => {
      await expect(conversationPage.message(text)).toBeVisible();
      await expect(conversationPage.replyBox).toHaveValue('');
    });
    await test.step('Instagram reports it delivered', () => inboxApi.expectDelivered(contactId, reply.id));
  });
});
