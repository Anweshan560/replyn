import { test, expect } from '../../../fixtures/test';
import { fullName } from '../../../api/ContactsApi';
import { buildPatient, buildPaymentAmount, toDateParam } from '../../../utils/testData';
import { bookThroughApi, createDoctorAndTreatment } from '../bookingSetup';

/** "NPR 1,022.00", as Billing shows money in the organization's currency. */
function money(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const yesterday = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

/**
 * Billing in the workspace without an EMR (env.noEmrWorkspace), where Replyn records the money
 * itself. Billing totals cover the whole workspace, so these tests check their own patient's rows,
 * never the totals. Deleting the patient's contact removes their invoices, receipts and advances.
 */
test.describe('Clinic → Billing without an EMR', { tag: ['@clinic', '@billing'] }, () => {
  test("should record an attended visit's payment as an invoice and a receipt", async ({
    appointmentsPage,
    billingPage,
    appointmentsApi,
    billingApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
    organizationApi,
  }) => {
    const { currency } = await organizationApi.current();
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const patient = buildPatient();
    const day = yesterday();
    const amount = buildPaymentAmount();
    const visit =
      await test.step('book a visit yesterday and mark it attended (through the API)', async () => {
        const booked = await bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, patient, day);
        expect((await appointmentsApi.update(booked.id, { status: 'completed' })).ok()).toBe(true);
        return booked;
      });
    const panel = appointmentsPage.panel;

    await test.step('open the visit: Payment says the value is missing, with Add payment', async () => {
      await appointmentsPage.open(day, 'Day', setup.doctor.id);
      await appointmentsPage.openAppointment(setup.treatment.name);
      await expect(panel.root.getByText("The visit is done, the value isn't")).toBeVisible();
      await expect(panel.addPaymentButton).toBeVisible();
    });
    await test.step(`Add payment of ${money(currency, amount)}`, () => panel.addPayment(amount));

    const billing =
      await test.step('the server has a paid invoice and a cleared receipt for it', async () => {
        const record = await billingApi.contactBillingRecord(visit.contactId);
        expect(record.invoices).toEqual([
          expect.objectContaining({ appointmentId: visit.id, total: amount.toFixed(2), status: 'paid' }),
        ]);
        expect(record.receipts).toEqual([
          expect.objectContaining({ appointmentId: visit.id, amount: amount.toFixed(2), status: 'cleared' }),
        ]);
        return record;
      });
    const [invoice, receipt] = [billing.invoices[0], billing.receipts[0]];
    await test.step('the panel shows both, billed and collected in full, nothing outstanding', async () => {
      await expect(panel.root.getByText('1 invoice · 1 receipt')).toBeVisible();
      await expect(panel.document(invoice.code)).toContainText(money(currency, amount));
      await expect(panel.document(receipt.code)).toContainText(money(currency, amount));
      await expect(panel.root.getByText(money(currency, 0), { exact: true })).toBeVisible();
    });
    await test.step('Billing → Documents lists the invoice and the receipt for the patient', async () => {
      await billingPage.open('Documents');
      const rows = billingPage.rowsFor(fullName(patient));
      await expect(rows).toHaveCount(2);
      await expect(rows.filter({ hasText: invoice.code })).toContainText('Invoice');
      await expect(rows.filter({ hasText: receipt.code })).toContainText('Receipt');
      for (const row of await rows.all()) await expect(row).toContainText(money(currency, amount));
    });
  });

  test("should hold an advance as credit on the patient's account", async ({
    contactsPage,
    billingPage,
    billingApi,
    contactsApi,
    cleanup,
    organizationApi,
  }) => {
    const { currency } = await organizationApi.current();
    const patient = buildPatient();
    const name = fullName(patient);
    const amount = buildPaymentAmount();
    const note = `Package deposit for ${name}`;
    const contact = await test.step('create the patient (through the API)', () =>
      contactsApi.createRecord(patient));
    // Deleting the contact also removes the advance.
    cleanup.add(`patient "${name}" and their advance`, () => contactsApi.deleteIfExists(contact.id));

    const panel = await test.step('open the contact and add an advance on its Visits tab', async () => {
      await contactsPage.open();
      await contactsPage.search(name);
      const details = await contactsPage.openDetails(name);
      await details.addAdvance(contact.id, amount, note);
      return details;
    });

    const advance = await test.step('the server stored the advance and the balance', async () => {
      const billing = await billingApi.contactBillingRecord(contact.id);
      expect(billing.advances).toEqual([
        expect.objectContaining({ amount: amount.toFixed(2), notes: note, status: 'cleared' }),
      ]);
      expect(billing.summary).toMatchObject({ advances: amount.toFixed(2), balance: amount.toFixed(2) });
      return billing.advances[0];
    });
    await test.step('the contact panel shows the advance', async () => {
      await expect(panel.billingDocument(advance.code)).toContainText(money(currency, amount));
    });
    await test.step('Billing → Credit on account lists the patient with that credit', async () => {
      await billingPage.open('Credit on account');
      await billingPage.searchBox.fill(name);
      const row = billingPage.rowsFor(name);
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(money(currency, amount));
    });
    await test.step('Billing → Documents lists the advance with its note', async () => {
      await billingPage.openTab('Documents');
      const row = billingPage.rowsFor(name);
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(advance.code);
      await expect(row).toContainText(note);
    });
  });

  test('should find a patient by name in All patients', async ({
    billingPage,
    billingApi,
    contactsApi,
    cleanup,
  }) => {
    const [first, second] = [buildPatient(), buildPatient()];
    await test.step('create two patients, each with an advance (through the API)', async () => {
      for (const patient of [first, second]) {
        const contact = await contactsApi.createRecord(patient);
        cleanup.add(`patient "${fullName(patient)}"`, () => contactsApi.deleteIfExists(contact.id));
        expect(
          (
            await billingApi.addAdvance(contact.id, { amount: 100, advanceDate: toDateParam(new Date()) })
          ).status(),
        ).toBe(201);
      }
    });

    await test.step('open All patients and search for the first one', async () => {
      await billingPage.open('All patients');
      await billingPage.searchBox.fill(fullName(first));
    });

    await test.step('only the first patient is listed', async () => {
      await expect(billingPage.rowsFor(fullName(first))).toHaveCount(1);
      await expect(billingPage.rowsFor(fullName(second))).toHaveCount(0);
    });
  });
});
