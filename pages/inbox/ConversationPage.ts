import { expect, type Locator, type Page } from '@playwright/test';
import { ENDPOINTS } from '../../api/ResourceApi';
import type { InboxMessage } from '../../api/InboxApi';
import { waitForApiResponse } from '../../utils/network';
import { collapseSetupGuide } from '../setupGuide';

/**
 * One conversation in the inbox: the message thread in the middle and the reply box under it.
 * Its address is /inbox/<workspace id>/<contact id>.
 */
export class ConversationPage {
  readonly replyBox: Locator;

  constructor(
    private readonly page: Page,
    private readonly workspaceId: string,
  ) {
    this.replyBox = page.getByPlaceholder(/^Reply to /);
  }

  /** Open a contact's conversation from the "All" list and wait until its messages have loaded. */
  async open(contactId: string): Promise<void> {
    const loaded = waitForApiResponse(this.page, 'GET', `${ENDPOINTS.contacts}/${contactId}/events`);
    await this.page.goto(`/inbox/${this.workspaceId}/${contactId}?assignee=all`);
    expect((await loaded).ok(), 'the conversation should load').toBe(true);
    await collapseSetupGuide(this.page);
  }

  /**
   * A message bubble in the thread, found by its exact text. The conversation list shows the last
   * message too, inside the row (role "button"); the thread has no landmark, so leave out text in buttons.
   */
  message(text: string): Locator {
    return this.page
      .getByText(text, { exact: true })
      .and(this.page.locator('xpath=//*[not(ancestor::button or ancestor::*[@role="button"])]'));
  }

  /**
   * Type a reply and send it with Enter, as an agent would.
   * @returns the stored message, taken from the server's answer.
   */
  async reply(text: string): Promise<InboxMessage> {
    await this.replyBox.fill(text);
    const sent = waitForApiResponse(this.page, 'POST', /\/v1\/channels\/[^/]+\/send-message$/);
    await this.replyBox.press('Enter');
    const response = await sent;
    expect(response.status(), 'the reply should be accepted').toBe(201);
    return (await response.json()).data;
  }
}
