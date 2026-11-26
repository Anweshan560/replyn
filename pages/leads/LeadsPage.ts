import { expect, type Locator, type Page } from '@playwright/test';
import { LEAD_ENDPOINTS } from '../../api/LeadsApi';
import { waitForApiResponse } from '../../utils/network';

/**
 * Leads: the list, and the panel that opens on a lead (?lead=<id>). The panel's "Open lead"
 * section has a stage bar: the current stage is a plain button, every other one is "Move to …".
 * Moving opens a "Move <first name>" dialog that asks for whatever the new stage needs (a Lost
 * reason, a follow-up date) before Save.
 */
export class LeadsPage {
  readonly panel: Locator;
  readonly stageBar: Locator;
  readonly moveDialog: Locator;
  readonly saveMoveButton: Locator;

  constructor(private readonly page: Page) {
    this.panel = page.getByRole('dialog').filter({ has: page.getByRole('region', { name: 'Open lead' }) });
    this.stageBar = this.panel
      .getByRole('region', { name: 'Open lead' })
      .getByRole('group', { name: 'Stages' });
    this.moveDialog = page.getByRole('dialog', { name: /^Move / });
    this.saveMoveButton = this.moveDialog.getByRole('button', { name: 'Save' });
  }

  /** Open a lead's panel straight from its address. */
  async openLead(leadId: string): Promise<void> {
    await this.page.goto(`/leads?lead=${leadId}`);
    // The panel loads the contact first ("Loading contact"), which can take a while.
    await expect(this.stageBar).toBeVisible({ timeout: 30_000 });
  }

  /** The stage bar's button for a stage the lead is not in. */
  moveToButton(stage: string): Locator {
    return this.stageBar.getByRole('button', { name: `Move to ${stage}`, exact: true });
  }

  /** The stage bar's button for the stage the lead is in (it has no "Move to"). */
  currentStageButton(stage: string): Locator {
    return this.stageBar.getByRole('button', { name: stage, exact: true });
  }

  /** Click "Move to <stage>" in the stage bar: the Move dialog opens with that stage picked. */
  async startMove(stage: string): Promise<void> {
    await this.moveToButton(stage).click();
    await expect(this.moveDialog).toBeVisible();
  }

  /** In the Move dialog, pick another stage by its label (its radio sits under the label). */
  async pickStage(stage: string): Promise<void> {
    await this.moveDialog.getByText(stage, { exact: true }).click();
  }

  /** In the Move dialog, pick an answer in one of the stage's lists, e.g. Lost reason → Price. */
  async pickAnswer(question: string, answer: string): Promise<void> {
    await this.moveDialog
      .getByRole('grid', { name: question })
      .getByRole('gridcell', { name: answer, exact: true })
      .click();
  }

  /** Press Save in the Move dialog and wait for the move to be saved. */
  async saveMove(leadId: string): Promise<void> {
    const saved = waitForApiResponse(this.page, 'POST', `${LEAD_ENDPOINTS.leads}/${leadId}/move`);
    await this.saveMoveButton.click();
    expect((await saved).status(), 'the server should save the move').toBe(201);
    await expect(this.moveDialog).toBeHidden();
  }

  /** A line in the panel's "Activity on this lead", e.g. "New → Trying to contact". */
  activity(text: string | RegExp): Locator {
    return this.panel
      .getByRole('region', { name: 'Activity on this lead' })
      .getByRole('paragraph')
      .filter({ hasText: text });
  }
}

/**
 * Settings → Lead stages: the stages in three groups (Not started, Open, Closed). Each stage is a
 * button whose name holds its name, description, how leads get there ("By hand", or "<event>,
 * moves here by itself") and how many leads it has.
 */
export class LeadStagesSettingsPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    const loaded = waitForApiResponse(this.page, 'GET', LEAD_ENDPOINTS.stages);
    await this.page.goto('/settings/lead-stages');
    expect((await loaded).ok(), 'the lead stages should load').toBe(true);
  }

  /** A group heading with its lead count beside it. */
  group(name: 'Not started' | 'Open' | 'Closed'): Locator {
    return this.page.getByRole('main').getByRole('heading', { name, level: 3 });
  }

  /** A stage's card. */
  stage(name: string): Locator {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.page.getByRole('main').getByRole('button', { name: new RegExp(`^${escaped} `) });
  }
}
