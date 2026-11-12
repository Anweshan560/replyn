import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { ENDPOINTS, type HeadersProvider } from './ResourceApi';
import { env } from '../config/env';
import { sendTimed } from '../utils/timing';

/** Every message the Instagram sender job sends starts with this (scripts/instagram/common.ts). */
export const DAILY_MESSAGE_PREFIX = 'AUTOTEST';

/**
 * Instagram only lets a business reply within 24 hours of the person's last message, and the
 * sender job runs once a day, so the newest message in that window is the one to use.
 */
const REPLY_WINDOW_MS = 24 * 60 * 60_000;

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'received' | 'read' | 'failed';

export type InboxMessage = {
  id: string;
  text: string | null;
  type: string;
  owner: 'contact' | 'user';
  conversationId: string;
  error: unknown;
  receivedAt: string;
  statuses: { status: MessageStatus }[];
  channel: { id: string; type: string };
};

type ConversationRow = {
  contact: { id: string; username: string | null; channels: { id: string; type: string }[] };
  message: InboxMessage | null;
};

/** The daily Instagram message as found in the inbox: who sent it, through which channel. */
export type DailyMessage = { contactId: string; channelId: string; message: InboxMessage };

/**
 * The inbox: conversations, the messages in them, and replies. A conversation belongs to a contact,
 * so its messages are read from the contact's events and replies go to the contact's channel.
 */
export class InboxApi {
  constructor(
    private readonly request: APIRequestContext,
    private readonly headers: HeadersProvider,
  ) {}

  /** POST /conversations/search, as the inbox's "All" list sends it (an empty body lists everything open). */
  async searchConversations(body: Record<string, unknown> = {}): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() =>
      this.request.post(this.url(`${ENDPOINTS.conversations}/search`), { headers, data: body }),
    );
  }

  /** A contact's timeline: messages and activities, newest first. */
  async contactEvents(contactId: string): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() =>
      this.request.get(this.url(`${ENDPOINTS.contacts}/${contactId}/events`), { headers }),
    );
  }

  /** Reply to a contact through one of the workspace's channels. This really sends the message. */
  async sendMessage(channelId: string, payload: Record<string, unknown>): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() =>
      this.request.post(this.url(`${ENDPOINTS.channels}/${channelId}/send-message`), {
        headers,
        data: payload,
      }),
    );
  }

  /** Send a text reply and return the stored message; throws if the API refuses it. */
  async sendText(channelId: string, contactId: string, text: string): Promise<InboxMessage> {
    const response = await this.sendMessage(channelId, { contactId, type: 'text', text });
    expect(response.status(), `reply should be accepted: ${await response.text()}`).toBe(201);
    return (await response.json()).data;
  }

  /** The contact's messages, newest first. */
  async messages(contactId: string): Promise<InboxMessage[]> {
    const response = await this.contactEvents(contactId);
    expect(response.ok(), 'the conversation should load').toBe(true);
    const events: { type: string; message?: InboxMessage }[] = (await response.json()).data.result;
    return events.filter((e) => e.type === 'message' && e.message).map((e) => e.message!);
  }

  /**
   * The newest message from the Instagram sender job received in the last 24 hours, or undefined.
   * Looks through every open Instagram conversation, because once someone replies the list only
   * shows the reply as the conversation's last message.
   */
  async findDailyMessage(): Promise<DailyMessage | undefined> {
    const response = await this.searchConversations();
    expect(response.ok(), 'the conversation list should load').toBe(true);
    const rows: ConversationRow[] = (await response.json()).data.result;
    const since = Date.now() - REPLY_WINDOW_MS;

    let newest: DailyMessage | undefined;
    for (const { contact } of rows) {
      const channel = contact.channels.find((c) => c.type === 'instagram');
      if (!channel) continue;
      const found = (await this.messages(contact.id)).find(
        (m) =>
          m.owner === 'contact' &&
          m.text?.startsWith(`${DAILY_MESSAGE_PREFIX} `) &&
          Date.parse(m.receivedAt) >= since,
      );
      if (found && (!newest || Date.parse(found.receivedAt) > Date.parse(newest.message.receivedAt))) {
        newest = { contactId: contact.id, channelId: channel.id, message: found };
      }
    }
    return newest;
  }

  /** Like findDailyMessage, but fails with a clear message when the sender job did not deliver one. */
  async getDailyMessage(): Promise<DailyMessage> {
    const found = await this.findDailyMessage();
    if (!found) {
      throw new Error(
        `No "${DAILY_MESSAGE_PREFIX}" Instagram message in the inbox from the last 24 hours. ` +
          'Check the latest "Instagram Sender" run on GitHub Actions (see README, "Daily Instagram message").',
      );
    }
    return found;
  }

  /** Wait until Instagram confirms the message reached the person (status "delivered"). */
  async expectDelivered(contactId: string, messageId: string): Promise<void> {
    await expect
      .poll(
        async () => {
          const message = (await this.messages(contactId)).find((m) => m.id === messageId);
          return message?.statuses.map((s) => s.status) ?? [];
        },
        { message: 'the reply should be delivered to Instagram', timeout: 60_000, intervals: [2_000, 5_000] },
      )
      .toContain('delivered');
  }

  private url(path: string): string {
    return `${env.apiUrl}${path}`;
  }
}
