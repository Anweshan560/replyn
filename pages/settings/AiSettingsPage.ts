import { expect, type Locator, type Page } from '@playwright/test';
import { SettingsNavigation } from './SettingsNavigation';
import { waitForApiResponse } from '../../utils/network';

/**
 * Settings → AI → General: the workspace's master AI switch, and the features under it. Flipping
 * the master switch saves at once. The features stay locked while it is off; Echo replies also
 * need Echo set up, so the tests never turn on anything that would answer real conversations.
 */
export class AiSettingsPage {
  readonly navigation: SettingsNavigation;
  /** Named after what it does next: "Turn AI on" while off, "Turn AI off" while on. */
  readonly masterSwitch: Locator;
  readonly lockedHint: Locator;

  constructor(
    private readonly page: Page,
    private readonly workspaceId: string,
  ) {
    this.navigation = new SettingsNavigation(page);
    const main = page.getByRole('main');
    this.masterSwitch = main.getByRole('switch', { name: /^Turn AI (on|off)$/ });
    this.lockedHint = main.getByText("Turn on AI first. Nothing below runs while it's off.");
  }

  async openFromDashboard(): Promise<void> {
    await this.navigation.openFromDashboard('AI', 'General');
    await expect(this.page).toHaveURL('/settings/ai');
  }

  /** Open the page directly and wait until the workspace has loaded. */
  async open(): Promise<void> {
    const loaded = waitForApiResponse(this.page, 'GET', `/v1/workspaces/${this.workspaceId}`);
    await this.page.goto('/settings/ai');
    expect((await loaded).ok(), 'the workspace should load').toBe(true);
    await expect(this.masterSwitch).toBeVisible();
  }

  /** Flip the master switch and wait for the server to save it. */
  async setAiEnabled(on: boolean): Promise<void> {
    if ((await this.masterSwitch.isChecked()) === on) return;
    const saved = waitForApiResponse(this.page, 'PATCH', `/v1/workspaces/${this.workspaceId}`);
    // The real switch input sits under the app's styled track; its On/Off label takes the clicks.
    await this.page
      .getByRole('main')
      .getByText(on ? 'Off' : 'On', { exact: true })
      .first()
      .click();
    expect((await saved).ok(), 'the server should save the AI switch').toBe(true);
    await expect(this.masterSwitch).toBeChecked({ checked: on });
  }
}
