import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { ENDPOINTS } from '../../api/ResourceApi';
import type { InboxMessage } from '../../api/InboxApi';
import { waitForApiResponse } from '../../utils/network';
import { collapseSetupGuide } from '../setupGuide';

/** The inbox's lists, in the "Inbox navigation" sidebar. */
export type InboxList = 'My inbox' | 'Mentions' | 'All' | 'Unassigned' | 'Participating';

/**
 * One conversation in the inbox, at /inbox/<workspace id>/<contact id>: the conversation list on
 * the left, the header (lifecycle, Close, more actions), the message thread with the reply box, and
 * the contact panel on the right ("Conversation actions": assignee, lifecycle, tags).
 *
 * Several controls exist twice in the page (one copy hidden for smaller screens), so buttons are
 * filtered to the visible one.
 */
export class ConversationPage {
  readonly replyBox: Locator;
  readonly noteBox: Locator;
  readonly closeButton: Locator;
  readonly reopenButton: Locator;
  readonly unsnoozeButton: Locator;
  readonly editFollowUpButton: Locator;
  readonly assignToMeButton: Locator;
  readonly unassignMeButton: Locator;
  readonly conversationActions: Locator;
  readonly closeDialog: Locator;
  readonly snoozeDialog: Locator;
  readonly followUpDialog: Locator;
  readonly editFollowUpDialog: Locator;
  readonly inboxNavigation: Locator;

  constructor(
    private readonly page: Page,
    private readonly workspaceId: string,
  ) {
    this.replyBox = page.getByPlaceholder(/^Reply to /);
    this.noteBox = page.getByPlaceholder(/^Add a private note/);
    this.closeButton = this.button('Close conversation');
    this.reopenButton = this.button('Reopen conversation');
    this.unsnoozeButton = this.button('Unsnooze conversation');
    this.editFollowUpButton = this.button('Edit follow-up');
    this.assignToMeButton = this.button('Assign to me');
    this.unassignMeButton = this.button('Unassign me');
    this.conversationActions = page.getByRole('group', { name: 'Conversation actions' });
    this.closeDialog = page.getByRole('dialog', { name: 'Close conversation' });
    this.snoozeDialog = page.getByRole('dialog', { name: 'Snooze conversation' });
    this.followUpDialog = page.getByRole('dialog', { name: 'Mark as follow up' });
    this.editFollowUpDialog = page.getByRole('dialog', { name: 'Edit follow-up' });
    this.inboxNavigation = page.getByRole('navigation', { name: 'Inbox navigation' });
  }

  /** Open a contact's conversation in the "All" list and wait until its messages have loaded. */
  async open(contactId: string): Promise<void> {
    const loaded = waitForApiResponse(this.page, 'GET', `${ENDPOINTS.contacts}/${contactId}/events`);
    await this.page.goto(`/inbox/${this.workspaceId}/${contactId}?assignee=all`);
    expect((await loaded).ok(), 'the conversation should load').toBe(true);
    await collapseSetupGuide(this.page);
  }

  // --- Thread -----------------------------------------------------------------------------------

  /**
   * A message bubble in the thread, found by its exact text. The conversation list shows the last
   * message too, inside the row (role "button"); the thread has no landmark, so leave out text in buttons.
   */
  message(text: string): Locator {
    return this.page.getByText(text, { exact: true }).and(this.outsideButtons());
  }

  /**
   * Scroll the thread until `item` shows. The thread opens at the newest entries and loads older
   * ones while scrolling up, so an older message (e.g. this morning's, after notes were added) is
   * not in the page at first. Once scrolled up, new messages do not scroll into view by themselves,
   * so scroll back down to see them.
   */
  async scrollThreadTo(item: Locator, direction: 'up' | 'down'): Promise<void> {
    const box = await this.replyBox.boundingBox();
    if (!box) throw new Error('The reply box is not on screen');
    // Just above the reply box is the thread.
    await this.page.mouse.move(box.x + box.width / 2, box.y - 150);
    // Older entries load in pages while scrolling up; give each page a moment to arrive.
    for (let i = 0; i < 60 && !(await item.isVisible()); i++) {
      await this.page.mouse.wheel(0, direction === 'up' ? -3000 : 3000);
      await this.page.waitForTimeout(800);
    }
  }

  /**
   * More options → Search messages: search this conversation's messages. The thread jumps to the
   * first match and highlights it; the search bar shows e.g. "1/1".
   */
  async searchMessages(query: string): Promise<void> {
    await this.button('More options').click();
    await this.page.getByRole('menuitem', { name: 'Search messages' }).click();
    const search = this.page.getByRole('searchbox', { name: 'Search messages' });
    await search.fill(query);
    await search.press('Enter');
  }

  /**
   * A note or message in the thread that contains `text` (e.g. a note's unique marker). Notes are
   * also listed in the contact panel (a complementary region), so that is left out too.
   */
  threadItemContaining(text: string): Locator {
    return this.page
      .getByText(text)
      .and(this.outsideButtons())
      .and(this.page.locator('xpath=//*[not(ancestor::aside or ancestor::*[@role="complementary"])]'));
  }

  /**
   * Type a reply and send it with Enter, as an agent would. This really sends it to Instagram.
   * @returns the stored message, taken from the server's answer.
   */
  async reply(text: string): Promise<InboxMessage> {
    await this.replyBox.fill(text);
    return this.expectSent(() => this.replyBox.press('Enter'));
  }

  /** Attach a file to the reply box; it shows as a preview until sent. */
  async attach(filePath: string): Promise<void> {
    const uploaded = waitForApiResponse(this.page, 'GET', /\/v2\/assets\/direct-upload/);
    // The reply box's own file input comes first; the "Saved files" picker adds another.
    await this.page.locator('input[type=file]').first().setInputFiles(filePath);
    expect((await uploaded).ok(), 'the file should upload').toBe(true);
  }

  /** The attachment preview above the reply box, by file name. */
  attachmentPreview(fileName: string): Locator {
    return this.page.getByRole('img', { name: fileName });
  }

  /** Send what is in the reply box (text and/or attachments) with the Send button. */
  async send(): Promise<InboxMessage> {
    return this.expectSent(() => this.button(/^Send/).click());
  }

  /**
   * Type `/` and part of a snippet's name, and pick it from the "Snippet list".
   * The reply box then holds the snippet's text, ready to edit or send.
   */
  async insertQuickReply(snippetName: string): Promise<void> {
    await this.replyBox.click();
    // The search stops at a space, like the Mentions list, so type only the first word.
    await this.replyBox.pressSequentially(`/${snippetName.split(' ')[0]}`, { delay: 50 });
    await this.page
      .getByRole('listbox', { name: 'Snippet list' })
      .getByRole('option', { name: snippetName })
      .click();
  }

  /**
   * Write an internal note. With `mention`, type `@` and the start of their name and pick them
   * from the "Mentions" list; the note then notifies them.
   */
  async writeNote(text: string, mention?: string): Promise<Response> {
    await this.button('Write a private note').click();
    await this.noteBox.click();
    await this.noteBox.pressSequentially(text, { delay: 20 });
    if (mention) {
      await this.noteBox.pressSequentially(` @${mention.slice(0, 3)}`, { delay: 60 });
      await this.page
        .getByRole('listbox', { name: 'Mentions' })
        .getByRole('option', { name: new RegExp(`^@${escapeRegExp(mention)} `) })
        .click();
    }
    const saved = waitForApiResponse(this.page, 'POST', /\/v1\/contacts\/[^/]+\/activity$/);
    await this.noteBox.press('Enter');
    const response = await saved;
    expect(response.status(), 'the note should be saved').toBe(201);
    return response;
  }

  // --- Header: lifecycle, close, snooze, follow-up ----------------------------------------------

  /** The header's lifecycle button, e.g. "Lifecycle: Hot Lead". */
  lifecycleButton(stage: string): Locator {
    return this.button(`Lifecycle: ${stage}`);
  }

  async changeLifecycle(stage: string): Promise<void> {
    await this.button('Change lifecycle').click();
    await this.expectSaved(() => this.page.getByRole('menuitem', { name: stage, exact: true }).click());
  }

  /** Close with the dialog. Category and summary are optional. */
  async close(note: { category?: string; summary?: string } = {}): Promise<void> {
    await this.closeButton.click();
    if (note.category) {
      await this.closeDialog.getByRole('button', { name: 'Category' }).click();
      await this.page.getByRole('option', { name: note.category, exact: true }).click();
    }
    if (note.summary) await this.closeDialog.getByRole('textbox', { name: 'Summary' }).fill(note.summary);
    await this.expectSaved(() =>
      this.closeDialog.getByRole('button', { name: 'Close', exact: true }).click(),
    );
    await expect(this.closeDialog).toBeHidden();
  }

  async reopen(): Promise<void> {
    await this.expectSaved(() => this.reopenButton.click());
  }

  /** Snooze with one of the dialog's presets, e.g. "1 hour" or "Tomorrow 9am". */
  async snooze(preset: string): Promise<void> {
    await this.openResolveAction('Snooze');
    await this.expectSaved(() =>
      this.snoozeDialog.getByRole('button', { name: new RegExp(`^${escapeRegExp(preset)} `) }).click(),
    );
  }

  async unsnooze(): Promise<void> {
    await this.expectSaved(() => this.unsnoozeButton.click());
  }

  /** Mark as follow up with a title and one of the "Remind me" presets, e.g. "Tomorrow". */
  async createFollowUp(title: string, remindMe: string): Promise<void> {
    await this.openResolveAction('Mark as follow up');
    await this.followUpDialog.getByRole('textbox', { name: 'Title*' }).fill(title);
    await this.followUpDialog
      .getByRole('button', { name: new RegExp(`^${escapeRegExp(remindMe)} `) })
      .click();
    const saved = waitForApiResponse(this.page, 'PUT', /\/v1\/contacts\/[^/]+\/follow-up$/);
    await this.followUpDialog.getByRole('button', { name: 'Create follow-up' }).click();
    expect((await saved).ok(), 'the follow-up should be saved').toBe(true);
  }

  /** Open the header's follow-up and press Remove. */
  async removeFollowUp(): Promise<void> {
    await this.editFollowUpButton.click();
    const removed = waitForApiResponse(this.page, 'DELETE', /\/v1\/contacts\/[^/]+\/follow-up$/);
    await this.editFollowUpDialog.getByRole('button', { name: 'Remove' }).click();
    expect((await removed).ok(), 'the follow-up should be removed').toBe(true);
  }

  // --- Contact panel: assignee and tags -----------------------------------------------------------

  async assignToMe(): Promise<void> {
    await this.expectSaved(() => this.assignToMeButton.click());
  }

  async unassignMe(): Promise<void> {
    await this.expectSaved(() => this.unassignMeButton.click());
  }

  /** The assignee shown in the panel, e.g. "anweshan (me)". */
  assignee(name: string | RegExp): Locator {
    return this.conversationActions.getByText(name);
  }

  async addTag(name: string): Promise<void> {
    await this.button('Add tag').click();
    await this.expectSaved(() =>
      this.page.getByRole('listbox', { name: 'Tags' }).getByRole('option', { name }).click(),
    );
    await this.page.keyboard.press('Escape');
  }

  /** A tag on the conversation, in the panel's "Tags" grid. */
  tag(name: string): Locator {
    return this.conversationActions.getByRole('grid', { name: 'Tags' }).getByRole('row', { name });
  }

  async removeTag(name: string): Promise<void> {
    await this.expectSaved(() => this.tag(name).getByRole('button', { name: 'Remove tag' }).click());
  }

  // --- Conversation list ------------------------------------------------------------------------

  /** Switch to one of the inbox's lists in the sidebar. */
  async openList(list: InboxList): Promise<void> {
    await this.inboxNavigation.getByRole('link', { name: new RegExp(`^${list}( \\d+)?$`) }).click();
  }

  /** Show open, closed or snoozed conversations in the list. */
  async showStatus(status: 'Open' | 'Closed' | 'Snoozed' | 'All'): Promise<void> {
    await this.button(/^Conversation status/).click();
    await this.page.getByRole('menuitemradio', { name: status, exact: true }).click();
  }

  /** A conversation's row in the list. Its name includes "Select <name> <name>". */
  listRow(contactName: string): Locator {
    const name = escapeRegExp(contactName);
    return this.page.getByRole('button', { name: new RegExp(`Select ${name} ${name}`) });
  }

  /**
   * Quick filters: pick one value of a field (e.g. Channel → "testqaadmin") and Apply. The field's
   * own dropdown button is 0 px wide, so the click goes to the value shown in the field.
   */
  async applyQuickFilter(field: 'Channel' | 'Assignee' | 'Tags', option: string): Promise<void> {
    await this.button('Quick filters').click();
    const dialog = this.page.getByRole('dialog', { name: 'Quick filters' });
    const trigger = dialog.getByRole('group').filter({ has: this.page.getByRole('button', { name: field }) });
    await trigger.locator('[data-slot="autocomplete-value"]').click();
    const options = this.page.getByRole('listbox', { name: `Suggestions ${field}` });
    await options.getByRole('option', { name: option }).click();
    // The options stay open over the Apply button; Escape closes them, not the dialog.
    await this.page.keyboard.press('Escape');
    await expect(options).toBeHidden();
    await expect(trigger).toContainText(option);
    const listed = waitForApiResponse(this.page, 'POST', `${ENDPOINTS.conversations}/search`);
    await dialog.getByRole('button', { name: 'Apply' }).click();
    expect((await listed).ok(), 'the filtered list should load').toBe(true);
  }

  /** Teams in the sidebar: expand the section and open the team's own list. */
  async openTeamList(teamName: string): Promise<void> {
    const teams = this.inboxNavigation.getByRole('button', { name: 'Teams', exact: true });
    if ((await teams.getAttribute('aria-expanded')) !== 'true') await teams.click();
    const listed = waitForApiResponse(this.page, 'POST', `${ENDPOINTS.conversations}/search`);
    await this.inboxNavigation.getByRole('link', { name: teamName, exact: true }).click();
    expect((await listed).ok(), "the team's list should load").toBe(true);
  }

  /**
   * The team's name shown in the contact panel's "Assigned team" field. The field's own button is
   * 0 px wide (like the Quick filters fields), so the visible value next to it is what is checked.
   */
  assignedTeam(teamName: string): Locator {
    return this.conversationActions
      .getByRole('group')
      .filter({ has: this.page.getByRole('button', { name: `${teamName} Assigned team`, exact: true }) })
      .getByText(teamName, { exact: true });
  }

  /** Files, quick replies and more → Saved files: search for the file and attach it. */
  async attachSavedFile(fileName: string): Promise<void> {
    await this.button('Files, quick replies and more').click();
    await this.page.getByRole('menuitem', { name: /^Saved files/ }).click();
    const picker = this.page.getByRole('dialog', { name: 'Saved files' });
    await picker.getByRole('searchbox', { name: 'Search files' }).fill(fileName);
    await picker.getByRole('button', { name: `Attach ${fileName}` }).click();
    await expect(picker).toBeHidden();
  }

  /** An attachment waiting above the reply box (picked from Saved files), by its name. */
  pendingAttachment(name: string): Locator {
    return this.button('Remove attachment')
      .locator('xpath=ancestor::*[.//textarea][1]')
      .getByText(name, { exact: true });
  }

  async removeAttachment(): Promise<void> {
    await this.button('Remove attachment').click();
  }

  /**
   * Record a voice message for a few seconds and send it. Needs a microphone: the tests start
   * Chrome with a fake one (--use-fake-device-for-media-stream). This really sends it to Instagram.
   */
  async sendVoiceMessage(seconds: number): Promise<InboxMessage> {
    await this.button('Record a voice message').click();
    await expect(this.button('Discard recording')).toBeVisible();
    await this.page.waitForTimeout(seconds * 1000);
    return this.expectSent(() => this.button('Send').click());
  }

  /** More options → "Opt out of broadcasts" or "Opt back in to broadcasts". */
  async setBroadcastOptOut(optOut: boolean): Promise<void> {
    await this.button('More options').click();
    const item = optOut ? 'Opt out of broadcasts' : 'Opt back in to broadcasts';
    await this.expectSaved(() => this.page.getByRole('menuitem', { name: item }).click());
  }

  /** The items of the header's More options menu, e.g. "Opt back in to broadcasts". */
  async moreOptionsItems(): Promise<string[]> {
    await this.button('More options').click();
    const items = await this.page
      .getByRole('menu', { name: 'More options' })
      .getByRole('menuitem')
      .allInnerTexts();
    await this.page.keyboard.press('Escape');
    return items.map((item) => item.trim());
  }

  // --- Helpers ----------------------------------------------------------------------------------

  private button(name: string | RegExp): Locator {
    return this.page
      .getByRole('button', { name, exact: typeof name === 'string' })
      .filter({ visible: true })
      .first();
  }

  private outsideButtons(): Locator {
    return this.page.locator('xpath=//*[not(ancestor::button or ancestor::*[@role="button"])]');
  }

  private async openResolveAction(item: 'Snooze' | 'Mark as follow up' | 'Run workflow'): Promise<void> {
    await this.button('More resolve actions').click();
    await this.page.getByRole('menuitem', { name: item }).click();
  }

  /** Run an action that PATCHes the conversation and wait until the server accepted it. */
  private async expectSaved(action: () => Promise<void>): Promise<void> {
    const saved = waitForApiResponse(this.page, 'PATCH', /\/v1\/contacts\/[^/]+$/);
    await action();
    expect((await saved).status(), 'the change should be saved').toBe(200);
  }

  private async expectSent(action: () => Promise<void>): Promise<InboxMessage> {
    const sent = waitForApiResponse(this.page, 'POST', /\/v1\/channels\/[^/]+\/send-message$/);
    await action();
    const response = await sent;
    expect(response.status(), 'the message should be accepted').toBe(201);
    return (await response.json()).data;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
