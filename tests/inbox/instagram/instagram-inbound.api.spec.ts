import { test, expect } from '../../../fixtures/test';
import { DAILY_MESSAGE_PREFIX } from '../../../api/InboxApi';

/**
 * The daily Instagram message, through the API. A scheduled job (scripts/instagram/send-dm.ts) DMs
 * the Instagram account connected to the test workspace every morning; these tests check Replyn
 * received it and that a reply reaches Instagram. See README, "Daily Instagram message".
 *
 * The reply test really sends an Instagram message to the sender account. That is the point: it is
 * a throwaway test account, and it only ever gets these replies.
 */
test.describe('Instagram inbound messages API', { tag: ['@inbox', '@instagram'] }, () => {
  // The inbox teardown leaves the conversation closed for the next morning's message; reopen it.
  test.beforeEach(async ({ inboxApi, testConversation }) => {
    await inboxApi.ensureOpen(testConversation.contactId);
  });

  test('should have received the daily Instagram message', async ({ inboxApi }) => {
    const { message } = await test.step('find the newest daily message from the last 24 hours', () =>
      inboxApi.getDailyMessage());

    await test.step('it came from the contact, through Instagram, with no error', () => {
      expect(message.text).toMatch(new RegExp(`^${DAILY_MESSAGE_PREFIX} \\d{4}-\\d{2}-\\d{2} `));
      expect(message.owner).toBe('contact');
      expect(message.type).toBe('text');
      expect(message.channel.type).toBe('instagram');
      expect(message.error).toBeNull();
      expect(message.statuses.map((s) => s.status)).toContain('received');
    });
  });

  test('should refuse a reply without the required fields', async ({ inboxApi }) => {
    const { channelId } = await test.step('find the Instagram channel', () => inboxApi.getDailyMessage());

    const response = await test.step('POST an empty reply', () => inboxApi.sendMessage(channelId, {}));

    await test.step('responds 422 naming the contact and the message type', async () => {
      expect(response.status()).toBe(422);
      expect((await response.json()).message).toMatchObject({
        contactId: expect.any(String),
        type: expect.any(String),
      });
    });
  });

  test('should deliver a reply to Instagram', async ({ inboxApi }) => {
    const { contactId, channelId } = await test.step('find the daily message', () =>
      inboxApi.getDailyMessage());
    const text = `AUTOREPLY ${new Date().toISOString()} (API) Thanks for your message!`;

    const reply = await test.step('reply through the API', () =>
      inboxApi.sendText(channelId, contactId, text));

    await test.step('the reply is stored as the agent’s, in the same conversation', () => {
      expect(reply).toMatchObject({ text, owner: 'user', type: 'text', error: null });
      expect(reply.channel.type).toBe('instagram');
    });
    await test.step('Instagram reports it delivered', () => inboxApi.expectDelivered(contactId, reply.id));
    await test.step('the conversation is no longer in Unreplied', async () => {
      expect(await inboxApi.listedContactIds({ view: 'unattended' })).not.toContain(contactId);
    });
  });
});
