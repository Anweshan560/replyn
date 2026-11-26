import { expect, type Locator, type Page } from '@playwright/test';
import { SettingsNavigation } from './SettingsNavigation';
import { ENDPOINTS } from '../../api/ResourceApi';
import { waitForApiResponse } from '../../utils/network';
import { collapseSetupGuide } from '../setupGuide';

/**
 * Settings → Inbox → Lifecycle: the pipeline's stages, then the lost stages. Names are edited in
 * place and new stages added at the end of a group; both collect in an "Unsaved lifecycle stages"
 * bar until Save changes. Deleting a stage (from its Stage actions menu) is immediate.
 */
export class LifecycleStagesPage {
  readonly navigation: SettingsNavigation;
  readonly stageNames: Locator;
  readonly unsavedBar: Locator;

  constructor(private readonly page: Page) {
    this.navigation = new SettingsNavigation(page);
    this.stageNames = page.getByRole('main').getByRole('textbox', { name: 'Stage name' });
    this.unsavedBar = page.getByRole('toolbar', { name: 'Unsaved lifecycle stages' });
  }

  async openFromDashboard(): Promise<void> {
    await this.navigation.openFromDashboard('Contacts', 'Lifecycle');
    await expect(this.page).toHaveURL('/settings/lifecycle');
  }

  /** Open the page directly and wait until the stages have loaded. */
  async open(): Promise<void> {
    const loaded = waitForApiResponse(this.page, 'GET', ENDPOINTS.lifecycles);
    await this.page.goto('/settings/lifecycle');
    expect((await loaded).ok(), 'the stages should load').toBe(true);
    await expect(this.stageNames.first()).not.toHaveValue('');
  }

  /** Every stage name, in page order: the pipeline first, then the lost stages. */
  async names(): Promise<string[]> {
    return this.stageNames.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  }

  /** Add a stage at the end of the pipeline and name it; it is only stored once saved. */
  async addPipelineStage(name: string): Promise<void> {
    const before = await this.stageNames.count();
    // The first Add stage button belongs to the pipeline, the second to the lost stages.
    await this.page.getByRole('main').getByRole('button', { name: 'Add stage' }).first().click();
    await expect(this.stageNames).toHaveCount(before + 1);
    const empty = await this.indexOf('');
    await this.stageNames.nth(empty).fill(name);
  }

  /** Rename the stage `current`; it is only stored once saved. */
  async renameStage(current: string, name: string): Promise<void> {
    await this.stageNames.nth(await this.indexOf(current)).fill(name);
  }

  /** Press Save changes in the "Unsaved lifecycle stages" bar and wait for the server. */
  async save(): Promise<void> {
    const saved = waitForApiResponse(this.page, 'PUT', ENDPOINTS.lifecycles);
    await this.unsavedBar.getByRole('button', { name: 'Save changes' }).click();
    expect((await saved).ok(), 'the server should save the stages').toBe(true);
    await expect(this.unsavedBar).toBeHidden();
  }

  /** Delete the stage from its Stage actions menu, confirming the dialog that names it. */
  async deleteStage(name: string): Promise<void> {
    await collapseSetupGuide(this.page);
    // Each stage has one Stage actions button, in the same order as the names.
    await this.page
      .getByRole('button', { name: 'Stage actions' })
      .nth(await this.indexOf(name))
      .click();
    await this.page
      .getByRole('menu', { name: 'Stage actions' })
      .getByRole('menuitem', { name: 'Delete' })
      .click();
    const dialog = this.page.getByRole('dialog', { name: `Delete Stage: ${name}?` });
    await expect(dialog).toContainText('permanently removes it and its data from Reports');
    const deleted = waitForApiResponse(this.page, 'DELETE', new RegExp(`^${ENDPOINTS.lifecycles}/[^/]+$`));
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    expect((await deleted).ok(), 'the server should delete the stage').toBe(true);
    await expect(dialog).toBeHidden();
  }

  /** Where the stage `name` is among the stage names. Throws if it isn't listed. */
  private async indexOf(name: string): Promise<number> {
    const index = (await this.names()).indexOf(name);
    if (index < 0) throw new Error(`No lifecycle stage named "${name}" on the page`);
    return index;
  }
}
