import { expect, type Locator, type Page } from '@playwright/test';
import { SettingsNavigation } from './SettingsNavigation';
import { ENDPOINTS } from '../../api/ResourceApi';
import { waitForApiResponse } from '../../utils/network';
import { collapseSetupGuide } from '../setupGuide';
import { WEBHOOK_EVENT, type WebhookData } from '../../utils/testData';

/**
 * Settings → Workspace → API Keys, the "Webhooks" tab: URLs the app calls when events happen.
 * Each webhook is a card with Reveal signing secret / Edit / Delete; deleting asks to type DELETE.
 */
export class WebhooksPage {
  readonly navigation: SettingsNavigation;
  readonly tab: Locator;
  readonly panel: Locator;
  readonly addButton: Locator;
  readonly createDialog: Locator;
  readonly editDialog: Locator;
  readonly deleteDialog: Locator;
  readonly secretDialog: Locator;

  constructor(private readonly page: Page) {
    this.navigation = new SettingsNavigation(page);
    this.tab = page.getByRole('tab', { name: 'Webhooks' });
    this.panel = page.getByRole('tabpanel', { name: 'Webhooks' });
    this.addButton = page.getByRole('button', { name: 'Add Webhook', exact: true });
    this.createDialog = page.getByRole('dialog', { name: 'Add Webhook' });
    this.editDialog = page.getByRole('dialog', { name: 'Edit Webhook' });
    this.deleteDialog = page.getByRole('dialog', { name: 'Delete webhook?' });
    this.secretDialog = page.getByRole('dialog', { name: 'Signing secret' });
  }

  /** Go to Settings → API Keys through the menu, then open the Webhooks tab. */
  async openFromDashboard(): Promise<void> {
    await this.navigation.openFromDashboard('Connections', 'API Keys');
    await expect(this.page).toHaveURL('/settings/developer');
    await this.openTab();
  }

  /** Open the page directly, on the Webhooks tab, once the webhooks have loaded. */
  async open(): Promise<void> {
    await this.page.goto('/settings/developer');
    await this.openTab();
  }

  /** The webhook's card: its URL, description, events and buttons. */
  card(webhook: WebhookData): Locator {
    // The innermost box holding both the URL and the action buttons is this webhook's card.
    return this.panel
      .locator('div')
      .filter({ has: this.page.getByText(webhook.url, { exact: true }) })
      .filter({ has: this.page.getByRole('toolbar', { name: 'Webhook actions' }) })
      .last();
  }

  /**
   * Add a webhook for the one event the app offers.
   * @returns the new webhook's id, taken from the server's answer.
   */
  async createWebhook(webhook: WebhookData): Promise<string> {
    await this.addButton.click();
    await expect(this.createDialog).toBeVisible();
    await this.fillDialog(this.createDialog, webhook);
    const eventCheckbox = this.createDialog.getByRole('checkbox', { name: WEBHOOK_EVENT });
    // The real checkbox sits under the app's styled box, so click its label as a user does.
    await this.createDialog.getByText(WEBHOOK_EVENT, { exact: true }).click();
    await expect(eventCheckbox).toBeChecked();
    const created = waitForApiResponse(this.page, 'POST', ENDPOINTS.webhookEndpoints);
    await this.createDialog.getByRole('button', { name: 'Create', exact: true }).click();
    const response = await created;
    expect(response.status(), 'the server should create the webhook').toBe(201);
    await expect(this.createDialog).toBeHidden();
    return (await response.json()).data.id;
  }

  /** Reload, open the webhook's edit dialog and check it shows exactly `webhook`, for its event. */
  async expectSavedValues(webhook: WebhookData): Promise<void> {
    await this.open();
    await this.clickAction(webhook, 'Edit');
    await expect(this.editDialog.getByRole('textbox', { name: 'Endpoint URL' })).toHaveValue(webhook.url);
    await expect(this.editDialog.getByRole('textbox', { name: 'Description (optional)' })).toHaveValue(
      webhook.description,
    );
    await expect(this.editDialog.getByRole('checkbox', { name: WEBHOOK_EVENT })).toBeChecked();
    await this.editDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(this.editDialog).toBeHidden();
  }

  /** Change the URL and description of `current` to those of `updated`, and save. */
  async editWebhook(current: WebhookData, updated: WebhookData): Promise<void> {
    await this.open();
    await this.clickAction(current, 'Edit');
    await expect(this.editDialog).toBeVisible();
    await this.fillDialog(this.editDialog, updated);
    const saved = waitForApiResponse(this.page, 'PATCH', new RegExp(`^${ENDPOINTS.webhookEndpoints}/[^/]+$`));
    await this.editDialog.getByRole('button', { name: 'Update', exact: true }).click();
    expect((await saved).ok(), 'the server should save the changes').toBe(true);
    await expect(this.editDialog).toBeHidden();
  }

  /**
   * Open the webhook's signing secret.
   * @returns the secret shown. Never log it: it is a real credential.
   */
  async revealSigningSecret(webhook: WebhookData): Promise<string> {
    await this.clickAction(webhook, 'Reveal signing secret');
    await expect(this.secretDialog).toBeVisible();
    await expect(this.secretDialog).toContainText(webhook.url);
    const secretInput = this.secretDialog.getByRole('textbox', { name: 'Signing secret' });
    await expect(secretInput).not.toHaveValue('');
    return secretInput.inputValue();
  }

  async closeSigningSecret(): Promise<void> {
    await this.secretDialog.getByRole('button', { name: 'Done' }).click();
    await expect(this.secretDialog).toBeHidden();
  }

  /** Press Delete; the dialog names the URL and keeps its button disabled until DELETE is typed. */
  async startDelete(webhook: WebhookData): Promise<Locator> {
    await this.open();
    await this.clickAction(webhook, 'Delete');
    await expect(this.deleteDialog).toBeVisible();
    await expect(this.deleteDialog).toContainText(webhook.url);
    return this.deleteDialog.getByRole('button', { name: 'Delete Webhook' });
  }

  /** Delete the webhook, typing DELETE to confirm. */
  async deleteWebhook(webhook: WebhookData): Promise<void> {
    const deleteButton = await this.startDelete(webhook);
    await this.deleteDialog.getByRole('textbox', { name: 'Confirm' }).fill('DELETE');
    const deleted = waitForApiResponse(
      this.page,
      'DELETE',
      new RegExp(`^${ENDPOINTS.webhookEndpoints}/[^/]+$`),
    );
    await deleteButton.click();
    expect((await deleted).ok(), 'the server should delete the webhook').toBe(true);
    await expect(this.deleteDialog).toBeHidden();
  }

  private async clickAction(
    webhook: WebhookData,
    name: 'Edit' | 'Delete' | 'Reveal signing secret',
  ): Promise<void> {
    await collapseSetupGuide(this.page);
    // .first(): the app nests a second, identical button inside each one.
    await this.card(webhook).getByRole('button', { name, exact: true }).first().click();
  }

  private async fillDialog(dialog: Locator, webhook: WebhookData): Promise<void> {
    await dialog.getByRole('textbox', { name: 'Endpoint URL' }).fill(webhook.url);
    await dialog.getByRole('textbox', { name: 'Description (optional)' }).fill(webhook.description);
  }

  private async openTab(): Promise<void> {
    const loaded = waitForApiResponse(this.page, 'GET', ENDPOINTS.webhookEndpoints);
    await this.tab.click();
    expect((await loaded).ok(), 'the webhooks should load').toBe(true);
    await expect(this.panel).toBeVisible();
  }
}
