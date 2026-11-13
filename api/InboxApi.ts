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
  attachments?: { type: string; contentType: string; url: string }[];
  channel: { id: string; type: string };
};

export type ConversationStatus = 'open' | 'closed' | 'snoozed';

/** The conversation fields kept on the contact (a conversation belongs to one contact). */
export type ConversationState = {
  id: string;
  username: string | null;
  status: ConversationStatus;
  snoozedUntil: string | null;
  assignedUserId: string | null;
  assignedTeamId: string | null;
  lifecycleId: string;
  lastClosingNoteId: string | null;
  tags: ({ id: string } | string)[];
  followUp: { id: string; reason: string | null; dueAt: string | null } | null;
  unreadCount?: number;
  unreadMentionCount?: number;
  /** Set when the contact opted out of broadcasts; `optOutSource` says who did it (e.g. "teammate"). */
  optedOutAt: string | null;
  optOutSource: string | null;
  channels: { id: string; type: string }[];
};

/** The filters the inbox's lists send to POST /conversations/search. */
export type ConversationFilters = {
  status?: ConversationStatus;
  /** A user id, or "null" for the Unassigned list. */
  assignedTo?: string;
  /** "mentions" (the Mentions list), "unattended" (Unreplied), "follow_up" (Follow-ups). */
  view?: 'mentions' | 'unattended' | 'follow_up';
  sortBy?: 'newest' | 'oldest';
  limit?: number;
  /** Quick filters, e.g. `{ rules: [{ id: 'facet-channel', field: 'channel', operator: 'hasAnyOf', value: [channelId] }] }`. */
  filter?: { rules: { id: string; field: string; operator: string; value: string[] }[] };
};

export type Activity = {
  id: string;
  type: string;
  userId: string | null;
  mentioned: string[] | null;
  payload: Record<string, any>;
  createdAt: string;
};

type ConversationRow = { contact: ConversationState; message: InboxMessage | null };

/** The daily Instagram message as found in the inbox: who sent it, through which channel. */
export type DailyMessage = { contactId: string; channelId: string; message: InboxMessage };

/** The Instagram conversation the inbox tests work on, whatever its state. */
export type TestConversation = { contactId: string; channelId: string; username: string };

/** What restoreConversation() puts back after a test. */
export type ConversationSnapshot = Pick<
  ConversationState,
  'status' | 'snoozedUntil' | 'assignedUserId' | 'assignedTeamId' | 'lifecycleId' | 'followUp'
> & { tags: string[] };

/**
 * The inbox: conversations, the messages in them, replies, and the actions on a conversation.
 * A conversation belongs to a contact: its state (status, assignee, lifecycle, tags) is changed with
 * PATCH /contacts/<id>, its messages and notes are the contact's events, and replies go out through
 * the contact's channel.
 */
export class InboxApi {
  constructor(
    private readonly request: APIRequestContext,
    private readonly headers: HeadersProvider,
  ) {}

  // --- Lists ------------------------------------------------------------------------------------

  /** POST /conversations/search with the filters a list sends; an empty body is the "All" list. */
  async searchConversations(filters: ConversationFilters = {}): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() =>
      this.request.post(this.url(`${ENDPOINTS.conversations}/search`), { headers, data: filters }),
    );
  }

  /** The contacts in a list, e.g. `{ status: 'closed' }` or `{ assignedTo: 'null', status: 'open' }`. */
  async listedContactIds(filters: ConversationFilters): Promise<string[]> {
    const response = await this.searchConversations({ limit: 100, ...filters });
    expect(response.ok(), `the list ${JSON.stringify(filters)} should load`).toBe(true);
    return ((await response.json()).data.result as ConversationRow[]).map((row) => row.contact.id);
  }

  /** GET /conversations/count: how many conversations each inbox list holds. */
  async counts(params: Record<string, string> = { status: 'open' }): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() =>
      this.request.get(this.url(`${ENDPOINTS.conversations}/count`), { headers, params }),
    );
  }

  async countsRecord(params?: Record<string, string>): Promise<Record<string, number>> {
    const response = await this.counts(params);
    expect(response.ok(), 'the inbox counts should load').toBe(true);
    return (await response.json()).data;
  }

  /** How many conversations and mentions the logged-in user has not read yet. */
  async unreadMentions(): Promise<{ conversations: number; mentions: number }> {
    const headers = await this.headers();
    const response = await this.request.get(this.url(`${ENDPOINTS.conversations}/mentions/unread-count`), {
      headers,
    });
    expect(response.ok(), 'the unread mentions count should load').toBe(true);
    return (await response.json()).data;
  }

  // --- One conversation --------------------------------------------------------------------------

  async getConversation(contactId: string): Promise<ConversationState> {
    const headers = await this.headers();
    const response = await this.request.get(this.url(`${ENDPOINTS.contacts}/${contactId}`), { headers });
    expect(response.ok(), 'the conversation should load').toBe(true);
    return (await response.json()).data;
  }

  /** PATCH the conversation's state, as the inbox's buttons do (status, assignee, lifecycle, tags). */
  async update(contactId: string, changes: Record<string, unknown>): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() =>
      this.request.patch(this.url(`${ENDPOINTS.contacts}/${contactId}`), { headers, data: changes }),
    );
  }

  /** Like update(), but fails the test if the API refuses, and returns the new state. */
  async updateRecord(contactId: string, changes: Record<string, unknown>): Promise<ConversationState> {
    const response = await this.update(contactId, changes);
    expect(response.status(), `PATCH ${JSON.stringify(changes)}: ${await response.text()}`).toBe(200);
    return (await response.json()).data;
  }

  /**
   * Make sure the conversation is open, e.g. after an earlier run stopped half-way. Only changes it
   * when needed: every status change adds a line to the conversation's thread.
   */
  async ensureOpen(contactId: string): Promise<void> {
    if ((await this.getConversation(contactId)).status !== 'open') {
      await this.updateRecord(contactId, { status: 'open', snoozedUntil: null });
    }
  }

  /** PUT a follow-up reminder: a reason and when it is due. */
  async setFollowUp(contactId: string, followUp: { reason?: string; dueAt?: string }): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() =>
      this.request.put(this.url(`${ENDPOINTS.contacts}/${contactId}/follow-up`), {
        headers,
        data: followUp,
      }),
    );
  }

  async removeFollowUp(contactId: string): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() =>
      this.request.delete(this.url(`${ENDPOINTS.contacts}/${contactId}/follow-up`), { headers }),
    );
  }

  /**
   * Add an internal note. Mentions are written `@[Name](userId)` in the text and listed in
   * `mentioned`. Notes cannot be deleted (only edited), so tests mark their text as test data.
   */
  async addNote(contactId: string, text: string, mentioned: string[] = []): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() =>
      this.request.post(this.url(`${ENDPOINTS.contacts}/${contactId}/activity`), {
        headers,
        data: { type: 'note', payload: { text }, mentioned },
      }),
    );
  }

  /** The conversation's activity log (notes, status and lifecycle changes), newest first. */
  async activities(contactId: string): Promise<Activity[]> {
    const headers = await this.headers();
    const response = await this.request.get(this.url(`${ENDPOINTS.contacts}/${contactId}/events`), {
      headers,
      params: { type: 'activity' },
    });
    expect(response.ok(), 'the activity log should load').toBe(true);
    return (await response.json()).data.result.map((e: { activity: Activity }) => e.activity);
  }

  /** Mark the conversation as read by the logged-in user, as opening it does. */
  async markRead(contactId: string): Promise<APIResponse> {
    const headers = await this.headers();
    return this.request.patch(this.url(`${ENDPOINTS.contacts}/${contactId}/interact`), {
      headers,
      data: { date: new Date().toISOString() },
    });
  }

  /** The logged-in user: id, and the name the Mentions list shows ("first last"). */
  async currentUser(): Promise<{ id: string; name: string }> {
    const headers = await this.headers();
    const response = await this.request.get(this.url(ENDPOINTS.me), { headers });
    expect(response.ok(), 'the current user should load').toBe(true);
    const { id, firstName, lastName } = (await response.json()).data;
    return { id, name: [firstName, lastName].filter(Boolean).join(' ') };
  }

  // --- Messages ---------------------------------------------------------------------------------

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

  /** Every Instagram conversation in any state: open, closed or snoozed. */
  private async instagramConversations(): Promise<ConversationState[]> {
    const rows: ConversationState[] = [];
    for (const status of ['open', 'closed', 'snoozed'] as const) {
      const response = await this.searchConversations({ status, limit: 100 });
      expect(response.ok(), 'the conversation list should load').toBe(true);
      for (const { contact } of (await response.json()).data.result as ConversationRow[]) {
        if (contact.channels.some((c) => c.type === 'instagram')) rows.push(contact);
      }
    }
    return rows;
  }

  /**
   * The newest message from the Instagram sender job received in the last 24 hours, or undefined.
   * Looks through every Instagram conversation's messages, because once someone replies the list
   * only shows the reply as the conversation's last message.
   */
  async findDailyMessage(): Promise<DailyMessage | undefined> {
    const since = Date.now() - REPLY_WINDOW_MS;
    let newest: DailyMessage | undefined;
    for (const contact of await this.instagramConversations()) {
      const channel = contact.channels.find((c) => c.type === 'instagram')!;
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

  /**
   * The sender job's conversation, for tests that change its state but send nothing to Instagram,
   * so they do not need a message from the last 24 hours.
   */
  async getTestConversation(): Promise<TestConversation> {
    for (const contact of await this.instagramConversations()) {
      const fromSender = (await this.messages(contact.id)).some(
        (m) => m.owner === 'contact' && m.text?.startsWith(`${DAILY_MESSAGE_PREFIX} `),
      );
      if (fromSender) {
        const channelId = contact.channels.find((c) => c.type === 'instagram')!.id;
        return { contactId: contact.id, channelId, username: contact.username ?? '' };
      }
    }
    throw new Error(
      `No Instagram conversation with a "${DAILY_MESSAGE_PREFIX}" message. See README, "Daily Instagram message".`,
    );
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

  // --- Putting the shared conversation back ------------------------------------------------------

  /** The state restoreConversation() puts back. Take it before a test changes anything. */
  async snapshotConversation(contactId: string): Promise<ConversationSnapshot> {
    const c = await this.getConversation(contactId);
    return {
      status: c.status,
      snoozedUntil: c.snoozedUntil,
      assignedUserId: c.assignedUserId,
      assignedTeamId: c.assignedTeamId,
      lifecycleId: c.lifecycleId,
      followUp: c.followUp,
      tags: c.tags.map((t) => (typeof t === 'string' ? t : t.id)),
    };
  }

  /** Put back what a test changed. Only differing fields are sent, so the activity log stays short. */
  async restoreConversation(contactId: string, snapshot: ConversationSnapshot): Promise<void> {
    const now = await this.snapshotConversation(contactId);
    const changes: Record<string, unknown> = {};
    if (now.status !== snapshot.status || now.snoozedUntil !== snapshot.snoozedUntil) {
      // A snooze that has already ended would be refused, so a snoozed conversation comes back open.
      const stillSnoozed = snapshot.status === 'snoozed' && Date.parse(snapshot.snoozedUntil!) > Date.now();
      changes.status = stillSnoozed ? 'snoozed' : snapshot.status === 'snoozed' ? 'open' : snapshot.status;
      changes.snoozedUntil = stillSnoozed ? snapshot.snoozedUntil : null;
    }
    if (now.assignedUserId !== snapshot.assignedUserId || now.assignedTeamId !== snapshot.assignedTeamId) {
      changes.assignedUserId = snapshot.assignedUserId;
      changes.assignedTeamId = snapshot.assignedTeamId;
    }
    if (now.lifecycleId !== snapshot.lifecycleId) changes.lifecycleId = snapshot.lifecycleId;
    if ([...now.tags].sort().join() !== [...snapshot.tags].sort().join()) changes.tags = snapshot.tags;
    if (Object.keys(changes).length) await this.updateRecord(contactId, changes);

    if (now.followUp?.id !== snapshot.followUp?.id) {
      if (snapshot.followUp?.dueAt) {
        await this.setFollowUp(contactId, {
          reason: snapshot.followUp.reason ?? undefined,
          dueAt: snapshot.followUp.dueAt,
        });
      } else {
        await this.removeFollowUp(contactId);
      }
    }
  }

  private url(path: string): string {
    return `${env.apiUrl}${path}`;
  }
}
