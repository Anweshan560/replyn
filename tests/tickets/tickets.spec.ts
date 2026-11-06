import { test, expect } from '../../fixtures/test';
import { toTicketPayload } from '../../api/TicketsApi';
import { TICKET_COLUMNS } from '../../pages/tickets/TicketsPage';
import { buildTicket } from '../../utils/testData';

test.describe('Tickets', { tag: ['@tickets'] }, () => {
  test('should show the board with a column for each status', { tag: '@smoke' }, async ({ ticketsPage }) => {
    await ticketsPage.open();

    for (const column of TICKET_COLUMNS) {
      await expect(ticketsPage.columnHeading(column)).toBeVisible();
    }
    await expect(ticketsPage.createButton).toBeVisible();
    await expect(ticketsPage.filterButton).toBeVisible();
  });

  test('should create a ticket from the dialog', async ({ ticketsPage, ticketsApi, cleanup }) => {
    const ticket = buildTicket();
    // Added first, so the ticket is removed however the test ends.
    cleanup.add(`ticket "${ticket.name}"`, async () => {
      const saved = (await ticketsApi.listRecords()).find((record) => record.name === ticket.name);
      if (saved) await ticketsApi.deleteIfExists(saved.id);
    });
    await ticketsPage.open();

    await test.step('fill in the dialog and create the ticket', async () => {
      await ticketsPage.createButton.click();
      await ticketsPage.nameInput.fill(ticket.name);
      await ticketsPage.descriptionInput.fill(ticket.description);
      await ticketsPage.createDialog.getByRole('button', { name: 'Create Ticket' }).click();
      await expect(ticketsPage.createDialog).toBeHidden();
    });

    await test.step('the card is in Pending, and the API has the ticket', async () => {
      await expect(ticketsPage.column('Pending').getByText(ticket.name)).toBeVisible();
      const saved = (await ticketsApi.listRecords()).find((record) => record.name === ticket.name);
      expect(saved).toMatchObject({ description: ticket.description, status: 'pending' });
    });
  });

  test('should require a name of at most 200 characters', async ({ ticketsPage }) => {
    await ticketsPage.open();
    await ticketsPage.createButton.click();
    const submit = ticketsPage.createDialog.getByRole('button', { name: 'Create Ticket' });

    await test.step('an empty name is refused', async () => {
      await submit.click();
      await expect(ticketsPage.createDialog.getByText('Name is required')).toBeVisible();
    });
    await test.step('201 characters are refused', async () => {
      await ticketsPage.nameInput.fill('x'.repeat(201));
      await submit.click();
      await expect(ticketsPage.createDialog.getByText('Name is too long')).toBeVisible();
    });
    await test.step('Cancel closes the dialog', async () => {
      await ticketsPage.createDialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(ticketsPage.createDialog).toBeHidden();
    });
  });

  test("should start a card from a column with that column's status", async ({ ticketsPage }) => {
    await ticketsPage.open();

    await ticketsPage.column('In Progress').getByRole('button', { name: 'Add a card' }).click();

    await expect(ticketsPage.createDialog.getByRole('button', { name: /Status/ })).toContainText(
      'In Progress',
    );
  });

  test('should open a ticket from its card and from a direct link', async ({
    page,
    ticketsPage,
    ticketsApi,
    cleanup,
  }) => {
    const created = await ticketsApi.createRecord(toTicketPayload(buildTicket()));
    cleanup.add(`ticket ${created.id}`, () => ticketsApi.deleteIfExists(created.id));
    await ticketsPage.open();

    await test.step('clicking the card opens the ticket and puts its id in the URL', async () => {
      await ticketsPage.openCard(created.name);
      await expect(ticketsPage.details.getByRole('heading', { name: created.name })).toBeVisible();
      await expect(ticketsPage.details.getByText(created.description!)).toBeVisible();
      await expect(page).toHaveURL(`/tickets?ticketId=${created.id}`);
    });
    await test.step('reloading that URL opens it again', async () => {
      await page.reload();
      // The dialog opens only once the whole app and the ticket list have loaded again.
      await expect(ticketsPage.details.getByRole('heading', { name: created.name })).toBeVisible({
        timeout: 30_000,
      });
    });
  });

  test('should move a ticket to another column by changing its status', async ({
    page,
    ticketsPage,
    ticketsApi,
    cleanup,
  }) => {
    const created = await ticketsApi.createRecord(toTicketPayload(buildTicket()));
    cleanup.add(`ticket ${created.id}`, () => ticketsApi.deleteIfExists(created.id));
    await ticketsPage.open();

    await ticketsPage.openCard(created.name);
    await ticketsPage.setStatus('Resolved');

    await test.step('the API has the new status', async () => {
      await expect.poll(async () => (await ticketsApi.getRecord(created.id)).status).toBe('resolved');
    });
    await test.step('the card is in Resolved after a reload', async () => {
      await page.goto('/tickets');
      await expect(ticketsPage.column('Resolved').getByText(created.name)).toBeVisible();
      await expect(ticketsPage.column('Pending').getByText(created.name)).toBeHidden();
    });
  });

  test('should add a comment to a ticket', async ({ page, ticketsPage, ticketsApi, cleanup }) => {
    const created = await ticketsApi.createRecord(toTicketPayload(buildTicket()));
    cleanup.add(`ticket ${created.id}`, () => ticketsApi.deleteIfExists(created.id));
    const text = `Comment on ${created.name}`;
    await ticketsPage.open();
    await ticketsPage.openCard(created.name);

    await test.step('write a comment and send it', async () => {
      await ticketsPage.commentInput.fill(text);
      await page.keyboard.press('Enter');
      await expect(ticketsPage.details.getByText(text)).toBeVisible();
    });
    await test.step('the API has it', async () => {
      expect((await ticketsApi.getRecord(created.id)).comments).toContainEqual(
        expect.objectContaining({ text }),
      );
    });
  });

  test('should delete a ticket only after confirming', async ({ ticketsPage, ticketsApi, cleanup }) => {
    const created = await ticketsApi.createRecord(toTicketPayload(buildTicket()));
    // Safety net only: does nothing if the test deleted it as expected.
    cleanup.add(`ticket ${created.id}`, () => ticketsApi.deleteIfExists(created.id));
    await ticketsPage.open();
    await ticketsPage.openCard(created.name);
    const deleteButton = ticketsPage.details.getByRole('button', { name: 'Delete ticket' });

    await test.step('Cancel keeps the ticket', async () => {
      await deleteButton.click();
      await expect(ticketsPage.deleteDialog.getByText(`Delete "${created.name}"?`)).toBeVisible();
      await ticketsPage.deleteDialog.getByRole('button', { name: 'Cancel' }).click();
      expect((await ticketsApi.get(created.id)).status()).toBe(200);
    });
    await test.step('Delete removes it from the board and the API', async () => {
      await deleteButton.click();
      await ticketsPage.deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(ticketsPage.card(created.name)).toBeHidden();
      await expect.poll(async () => (await ticketsApi.get(created.id)).status()).toBe(404);
    });
  });
});
