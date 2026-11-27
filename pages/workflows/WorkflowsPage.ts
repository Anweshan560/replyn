import { expect, type Locator, type Page } from '@playwright/test';
import { waitForApiResponse, waitForListResponse } from '../../utils/network';
import { ENDPOINTS } from '../../api/ResourceApi';

/** Renamed 2026-11-27: Active → Live, Paused → Off. */
export type WorkflowStatusTab = 'All' | 'Live' | 'Off' | 'Archived';

/** The numbers at the top of the page. */
export type WorkflowTile = 'Live' | 'Runs · 7 days' | 'Success rate' | 'Failed';

/** The filter each status tab sends; null means the parameter is left out. */
const STATUS_TAB_QUERY: Record<WorkflowStatusTab, Record<string, string | null>> = {
  All: { isActive: null, archived: null },
  Live: { isActive: 'true', archived: null },
  Off: { isActive: 'false', archived: null },
  Archived: { archived: 'true' },
};

/** Trigger filter labels and the `triggerType` the page sends for them (those the tests use). */
export const TRIGGER_TYPES = {
  // Renamed 2026-11-27 (were "Manual trigger" and "Contact created").
  'Started by hand': 'manual_trigger',
  'New contact': 'contact_created',
} as const;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Workflows: the numbers at the top, the list with its search, status tabs and trigger filter,
 * and each row's Live switch, Duplicate, View activities and Archive. The canvas editor is
 * tested by hand.
 */
export class WorkflowsPage {
  readonly heading: Locator;
  readonly createButton: Locator;
  readonly searchBox: Locator;
  readonly triggerFilter: Locator;
  private readonly main: Locator;

  constructor(private readonly page: Page) {
    this.main = page.getByRole('main');
    this.heading = page.getByRole('heading', { name: 'Workflows' });
    this.createButton = page.getByRole('button', { name: 'Create Workflow' });
    this.searchBox = page.getByRole('searchbox', { name: 'Search workflows' });
    this.triggerFilter = page.getByRole('button', { name: /Trigger filter/ });
  }

  /** Go from the dashboard to Workflows through the menu, as a user would. */
  async openFromDashboard(): Promise<void> {
    await this.page.goto('/dashboard');
    await this.page.getByRole('link', { name: 'Workflows', exact: true }).click();
    await expect(this.page).toHaveURL('/workflows');
    await expect(this.statusTab('All')).toBeChecked();
  }

  /**
   * One of the tiles at the top, e.g. Live "8" "of 16". Since 2026-11-27 each is a label (term)
   * and its number (definition); the tile is the box around both.
   */
  tile(label: WorkflowTile): Locator {
    return this.main
      .getByRole('term')
      .filter({ hasText: new RegExp(`^${escapeRegExp(label)}$`) })
      .locator('xpath=ancestor::*[@data-slot="kpi"][1]');
  }

  /** The number on a tile, e.g. "8" for Live. */
  tileValue(label: WorkflowTile): Locator {
    return this.tile(label).getByRole('definition');
  }

  statusTab(tab: WorkflowStatusTab): Locator {
    return this.page
      .getByRole('radiogroup', { name: 'Workflow status' })
      .getByRole('radio', { name: tab, exact: true });
  }

  /** The row of a workflow that is not archived. Its accessible name starts with the workflow's name. */
  rowFor(name: string): Locator {
    return this.page.getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}( |$)`) });
  }

  /** The row of an archived workflow, in the Archived tab. These rows can only be restored. */
  archivedRowFor(name: string): Locator {
    return this.main
      .locator('div')
      .filter({ has: this.page.getByText(name, { exact: true }) })
      .filter({ has: this.page.getByRole('button', { name: 'Restore' }) })
      .last();
  }

  /** The Live switch of a row: "Pause workflow" while it runs, "Activate workflow" while paused. */
  liveSwitch(name: string, action: 'Pause' | 'Activate'): Locator {
    return this.rowFor(name)
      .getByRole('button', { name: `${action} workflow` })
      .first();
  }

  /** Type into the search box; waits for the list the page asks for with `?search=<text>`. */
  async search(text: string): Promise<void> {
    const listed = waitForListResponse(this.page, ENDPOINTS.workflows, { search: text });
    await this.searchBox.fill(text);
    await listed;
  }

  /**
   * Pick a status tab; waits for the list the page asks for with that tab's filter, so this fails
   * if the page stops sending it.
   */
  async showTab(tab: WorkflowStatusTab): Promise<void> {
    const listed = waitForListResponse(this.page, ENDPOINTS.workflows, STATUS_TAB_QUERY[tab]);
    await this.statusTab(tab).click();
    await listed;
  }

  /** Pick a trigger in the "All triggers" filter; waits for the list asked for with `?triggerType=`. */
  async filterByTrigger(trigger: keyof typeof TRIGGER_TYPES): Promise<void> {
    // The filter's button has no width since 2026-11-27; its visible box (a group) takes the click.
    await this.page.getByRole('group').filter({ has: this.triggerFilter }).last().click();
    const listed = waitForListResponse(this.page, ENDPOINTS.workflows, {
      triggerType: TRIGGER_TYPES[trigger],
    });
    await this.page.getByRole('option', { name: trigger, exact: true }).click();
    await listed;
  }

  /**
   * Flip a row's Live switch and confirm. `action` is what the switch offers: Activate when the
   * workflow is paused, Pause when it runs. Returns the server's answer.
   */
  async setLive(name: string, action: 'Pause' | 'Activate'): Promise<number> {
    await this.liveSwitch(name, action).click();
    const confirm = this.page.getByRole('dialog', { name: `${action} workflow` });
    await expect(confirm).toBeVisible();
    const path = new RegExp(
      `^${ENDPOINTS.workflows}/[^/]+/${action === 'Pause' ? 'deactivate' : 'activate'}$`,
    );
    const answered = waitForApiResponse(this.page, 'POST', path);
    await confirm.getByRole('button', { name: action, exact: true }).click();
    return (await answered).status();
  }

  /** Archive a workflow from its row, after reading and accepting the confirmation. */
  async archive(name: string): Promise<Locator> {
    await this.rowFor(name).getByRole('button', { name: 'Archive workflow' }).first().click();
    const confirm = this.page.getByRole('alertdialog', { name: 'Archive workflow?' });
    await expect(confirm).toBeVisible();
    const archived = waitForApiResponse(this.page, 'DELETE', new RegExp(`^${ENDPOINTS.workflows}/[^/]+$`));
    await confirm.getByRole('button', { name: 'Archive', exact: true }).click();
    expect((await archived).status(), 'the server should archive the workflow').toBe(200);
    return confirm;
  }

  /** Restore an archived workflow from the Archived tab. */
  async restore(name: string): Promise<void> {
    const restored = waitForApiResponse(
      this.page,
      'POST',
      new RegExp(`^${ENDPOINTS.workflows}/[^/]+/restore$`),
    );
    await this.archivedRowFor(name).getByRole('button', { name: 'Restore' }).click();
    expect((await restored).status(), 'the server should restore the workflow').toBe(201);
  }

  /**
   * A message, e.g. "Workflow restored" (a toast) or "Couldn't update" (shown inside the Live
   * switch's confirmation).
   */
  toast(title: string): Locator {
    return this.page.getByRole('alertdialog').or(this.page.getByRole('dialog')).filter({ hasText: title });
  }

  /**
   * Duplicate a workflow: the "Copy workflow" dialog suggests "Copy of <name>"; save it as
   * `copyName`. Returns the dialog's suggested name and the copy's id from the server's answer.
   */
  async duplicate(name: string, copyName: string): Promise<{ suggestedName: string; id: string }> {
    await this.rowFor(name).getByRole('button', { name: 'Duplicate workflow' }).first().click();
    const dialog = this.page.getByRole('dialog', { name: 'Copy workflow' });
    const nameBox = dialog.getByRole('textbox', { name: 'Name' });
    await expect(nameBox).not.toHaveValue('');
    const suggestedName = await nameBox.inputValue();
    await nameBox.fill(copyName);
    const copied = waitForApiResponse(this.page, 'POST', new RegExp(`^${ENDPOINTS.workflows}(/|$)`));
    await dialog.getByRole('button', { name: 'Copy workflow' }).click();
    const response = await copied;
    expect(response.status(), 'the server should save the copy').toBe(201);
    await expect(dialog).toBeHidden();
    return { suggestedName, id: (await response.json()).data.id };
  }
}
