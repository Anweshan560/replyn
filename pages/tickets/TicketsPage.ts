import { expect, type Locator, type Page } from '@playwright/test';

/** The board's columns, in the order the page shows them. */
export const TICKET_COLUMNS = ['Pending', 'In Progress', 'Pending Action', 'Resolved'] as const;
export type TicketColumn = (typeof TICKET_COLUMNS)[number];

/**
 * Tickets: a board with one column per status, the Create ticket dialog, and the dialog that opens
 * from a card. The sidebar links here only in e-commerce workspaces, so tests open it by URL.
 * Dragging cards between columns is not covered: the Status list in the dialog does the same job.
 */
export class TicketsPage {
  readonly heading: Locator;
  readonly board: Locator;
  readonly createButton: Locator;
  readonly filterButton: Locator;
  readonly createDialog: Locator;
  readonly nameInput: Locator;
  readonly descriptionInput: Locator;
  /** The open ticket's dialog. It has no name of its own, so it is found by its Delete button. */
  readonly details: Locator;
  readonly commentInput: Locator;
  readonly deleteDialog: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Tickets', exact: true });
    this.board = page.getByRole('main');
    this.createButton = page.getByRole('banner').getByRole('button', { name: 'Create Ticket' });
    // .first(): the button is nested in a second button with the same name.
    this.filterButton = page.getByRole('button', { name: 'Filter' }).first();
    this.createDialog = page.getByRole('dialog', { name: 'Create ticket' });
    this.nameInput = this.createDialog.getByRole('textbox', { name: 'Name' });
    this.descriptionInput = this.createDialog.getByRole('textbox', { name: 'Description' });
    this.details = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('button', { name: 'Delete ticket' }) });
    this.commentInput = this.details.getByRole('textbox', { name: 'Write a comment' });
    this.deleteDialog = page.getByRole('dialog', { name: 'Delete ticket' });
  }

  async open(): Promise<void> {
    await this.page.goto('/tickets');
    await expect(this.heading).toBeVisible();
  }

  columnHeading(name: TicketColumn): Locator {
    return this.board.getByRole('heading', { name, exact: true, level: 6 });
  }

  /** The column: the outermost element around its heading that holds no other column's heading. */
  column(name: TicketColumn): Locator {
    const others = TICKET_COLUMNS.filter((column) => column !== name).join('|');
    return this.board
      .locator('div')
      .filter({ has: this.page.getByRole('heading', { name, exact: true }) })
      .filter({ hasNot: this.page.getByRole('heading', { name: new RegExp(`^(${others})$`) }) })
      .first();
  }

  card(name: string): Locator {
    return this.board
      .getByRole('button')
      .filter({ has: this.page.getByRole('heading', { name, exact: true }) });
  }

  async openCard(name: string): Promise<void> {
    await this.card(name).click();
    await expect(this.details).toBeVisible();
  }

  async setStatus(name: TicketColumn): Promise<void> {
    await this.details.getByRole('button', { name: /Status/ }).click();
    await this.page
      .getByRole('listbox', { name: 'Status' })
      .getByRole('option', { name, exact: true })
      .click();
  }
}
