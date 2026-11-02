import { expect, type Locator, type Page } from '@playwright/test';
import { SettingsNavigation } from './SettingsNavigation';
import { ENDPOINTS } from '../../api/ResourceApi';
import { waitForApiResponse } from '../../utils/network';
import { collapseSetupGuide } from '../setupGuide';
import type { WrapUpOutcomeData } from '../../utils/testData';

/**
 * Settings → Inbox → Wrap-Up: the outcomes agents pick when a conversation ends, and the steps
 * each one runs. Outcomes are listed on the left and edited on the right; nothing is stored until
 * "Save changes", which sends the whole list at once.
 */
export class WrapUpPage {
  readonly navigation: SettingsNavigation;
  readonly outcomeList: Locator;
  readonly editor: Locator;
  readonly createOutcomeButton: Locator;
  readonly saveButton: Locator;
  readonly unsavedChanges: Locator;

  constructor(private readonly page: Page) {
    this.navigation = new SettingsNavigation(page);
    this.outcomeList = page.getByRole('navigation', { name: 'Wrap-up outcomes' });
    this.editor = page.getByRole('region', { name: 'Outcome configuration' });
    // .first(): with no outcomes yet, the empty page shows a second Create outcome button.
    this.createOutcomeButton = page.getByRole('button', { name: 'Create outcome' }).first();
    this.saveButton = page.getByRole('button', { name: 'Save changes' });
    this.unsavedChanges = page.getByRole('status').filter({ hasText: 'Unsaved changes' });
  }

  async openFromDashboard(): Promise<void> {
    await this.navigation.openFromDashboard('Inbox', 'Wrap-Up');
    await expect(this.page).toHaveURL('/settings/wrap-up');
  }

  /** Open the page directly and wait until the wrap-up has loaded. */
  async open(): Promise<void> {
    const loaded = waitForApiResponse(this.page, 'GET', ENDPOINTS.wrapUp);
    await this.page.goto('/settings/wrap-up');
    expect((await loaded).ok(), 'the wrap-up should load').toBe(true);
  }

  /** The outcome's entry in the list on the left, e.g. "Edit outcome 1: Booked appointment". */
  outcomeEntry(name: string): Locator {
    return this.outcomeList.getByRole('button', {
      name: new RegExp(`^Edit outcome \\d+: ${escapeRegExp(name)}$`),
    });
  }

  /** Start a new outcome and fill it in; it is only stored once saved. */
  async addOutcome(outcome: WrapUpOutcomeData, closingNote: string): Promise<void> {
    await collapseSetupGuide(this.page);
    await this.createOutcomeButton.click();
    await expect(this.outcomeEntry('Untitled outcome')).toBeVisible();
    await this.fillOutcome(outcome);
    await this.chooseClosingNote(closingNote);
  }

  /** Select the outcome named `current` and change it to `updated`; it is only stored once saved. */
  async editOutcome(current: string, updated: WrapUpOutcomeData): Promise<void> {
    await this.outcomeEntry(current).click();
    await expect(this.nameInput).toHaveValue(current);
    await this.fillOutcome(updated);
  }

  /** Select the outcome and delete it; it is only removed from the server once saved. */
  async deleteOutcome(name: string): Promise<void> {
    await this.outcomeEntry(name).click();
    await expect(this.nameInput).toHaveValue(name);
    // No confirmation: the outcome goes at once, and Save changes makes it final.
    await this.editor.getByRole('button', { name: 'Remove outcome' }).click();
    await expect(this.outcomeEntry(name)).toHaveCount(0);
  }

  /**
   * Press Save changes and wait for the server.
   * The first save creates the workspace's wrap-up (POST); later ones update it (PATCH).
   */
  async save(): Promise<void> {
    const saved = this.page.waitForResponse(
      (response) =>
        ['POST', 'PATCH'].includes(response.request().method()) &&
        new URL(response.url()).pathname.startsWith(ENDPOINTS.wrapUp),
    );
    await this.saveButton.click();
    expect((await saved).ok(), 'the server should save the wrap-up').toBe(true);
    await expect(this.unsavedChanges).toHaveCount(0);
  }

  /** Reload, select the outcome and check the editor shows exactly `outcome` and its closing note. */
  async expectSavedOutcome(outcome: WrapUpOutcomeData, closingNote: string): Promise<void> {
    await this.open();
    await this.outcomeEntry(outcome.name).click();
    await expect(this.nameInput).toHaveValue(outcome.name);
    await expect(this.editor.getByRole('radio', { name: outcome.result, exact: true })).toBeChecked();
    await expect(this.editor.getByRole('textbox', { name: 'Description (optional)' })).toHaveValue(
      outcome.description,
    );
    await expect(this.closingNotesButton).toContainText(closingNote);
  }

  /** The message under the step's closing notes when none is chosen. */
  get missingClosingNote(): Locator {
    return this.editor.getByText('Select at least one closing note', { exact: true });
  }

  private get nameInput(): Locator {
    return this.editor.getByRole('textbox', { name: 'Outcome name' });
  }

  private get closingNotesButton(): Locator {
    return this.editor.getByRole('button', { name: /Closing notes the agent can pick from/ });
  }

  async fillOutcome(outcome: WrapUpOutcomeData): Promise<void> {
    await this.nameInput.fill(outcome.name);
    // The real radio input sits under the app's styled card, so click the option's label.
    await this.editor
      .getByRole('radiogroup', { name: 'Outcome result' })
      .getByText(outcome.result, { exact: true })
      .click();
    await expect(this.editor.getByRole('radio', { name: outcome.result, exact: true })).toBeChecked();
    await this.editor.getByRole('textbox', { name: 'Description (optional)' }).fill(outcome.description);
  }

  /** Choose the closing note the "Close conversation" step offers the agent. */
  private async chooseClosingNote(closingNote: string): Promise<void> {
    const picker = this.page.getByRole('listbox', { name: /Closing notes the agent can pick from/ });
    const option = picker.getByRole('option', { name: closingNote, exact: true });
    // On a slow machine (CI) a click that lands while the editor is still updating can leave the
    // picker closed, so click again until it opens and lists the note.
    await expect(async () => {
      if (!(await picker.isVisible())) await this.closingNotesButton.click({ timeout: 5_000 });
      await expect(option, `the picker should list "${closingNote}"`).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
    await option.click();
    // The picker lets several notes be chosen, so it stays open: close it with Escape.
    await this.page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(this.closingNotesButton).toContainText(closingNote);
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
