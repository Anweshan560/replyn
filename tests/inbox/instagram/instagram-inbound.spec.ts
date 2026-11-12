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

    await test.step('open the conversation and search for it: the message is in the thread', async () => {
      await conversationPage.open(contactId);
      // Notes and replies added since push it far up the thread; find it as an agent would.
      await conversationPage.searchMessages(message.text!);
      await expect(conversationPage.message(message.text!)).toBeVisible();
    });

    const text = `AUTOREPLY ${new Date().toISOString()} (UI) Thanks, we will get back to you shortly.`;
    const reply = await test.step('reply from the reply box', () => conversationPage.reply(text));

    await test.step('the reply shows in the thread and the box is empty again', async () => {
      await conversationPage.scrollThreadTo(conversationPage.message(text), 'down');
      await expect(conversationPage.message(text)).toBeVisible();
      await expect(conversationPage.replyBox).toHaveValue('');
    });
    await test.step('Instagram reports it delivered', () => inboxApi.expectDelivered(contactId, reply.id));
  });

  test('should send an image and deliver it', async ({ conversationPage, inboxApi }) => {
    const { contactId } = await test.step('find the newest daily message', () => inboxApi.getDailyMessage());
    await conversationPage.open(contactId);

    await test.step('attach an image: a preview shows above the reply box', async () => {
      await conversationPage.attach('tests/assets/inbox-image.jpg');
      await expect(conversationPage.attachmentPreview('inbox-image.jpg')).toBeVisible();
    });
    const sent = await test.step('send it', () => conversationPage.send());

    await test.step('it is stored as an image attachment, and Instagram reports it delivered', async () => {
      expect(sent).toMatchObject({ type: 'attachment', owner: 'user' });
      // Replyn stores uploads as PNG whatever the original format, so only the kind is checked.
      expect(sent.attachments?.[0]).toMatchObject({
        type: 'image',
        contentType: expect.stringMatching(/^image\//),
      });
      await inboxApi.expectDelivered(contactId, sent.id);
    });
  });
});
