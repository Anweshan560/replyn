import { test, expect } from '../../../fixtures/test';
import { fullName } from '../../../api/ContactsApi';
import { BILLING_TABS, type BillingTab } from '../../../pages/clinic/BillingPage';
import { buildPatient, buildPaymentAmount, nextClinicDay } from '../../../utils/testData';
import { bookThroughApi, createDoctorAndTreatment } from '../bookingSetup';

/** "AED 1,022.00", as Billing shows money. */
function aed(amount: number): string {
  return `AED ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Billing totals cover the whole workspace and other tests add to them, so these tests check
// their own patient's rows, never the totals. Deleting the patient's contact removes their
// invoices, receipts and advances (see cleanupBooking).
test.describe('Clinic → Billing', { tag: ['@clinic', '@billing'] }, () => {
  test(
    'should open Billing from the Clinic menu, with a tab for each view',
    { tag: '@smoke' },
    async ({ page, billingPage }) => {
      await test.step('go to Clinic → Billing', () => billingPage.openFromSidebar());

      await test.step('the address is /clinics/billing and Owes money is selected', async () => {
        await expect(page).toHaveURL(/\/clinics\/billing/);
        await expect(billingPage.tab('Owes money')).toHaveAttribute('aria-selected', 'true');
      });
      for (const [tab, view] of Object.entries(BILLING_TABS) as [BillingTab, string][]) {
        await test.step(`${tab}: the address gets view=${view} and a grid is shown`, async () => {
          await billingPage.openTab(tab);
          await expect(page).toHaveURL((url) => url.searchParams.get('view') === view);
          await expect(billingPage.grid).toBeVisible();
        });
      }
    },
  );

  test('should list an attended visit with no invoice under Needs review', async ({
    billingPage,
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const patient = buildPatient();
    await test.step('book a visit and mark it attended, without a payment (through the API)', async () => {
      const appointment = await bookThroughApi(
        { appointmentsApi, contactsApi },
        cleanup,
        setup,
        patient,
        nextClinicDay(),
      );
      expect((await appointmentsApi.update(appointment.id, { status: 'completed' })).ok()).toBe(true);
    });

    await test.step('open Billing → Needs review', () => billingPage.open('Needs review'));

    await test.step('the patient is listed as "Not billed" for that treatment and doctor', async () => {
      const row = billingPage.rowsFor(fullName(patient));
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('Not billed');
      await expect(row).toContainText(`${setup.treatment.name} · ${setup.doctor.name}`);
    });
  });

  test('should record the payment of an attended visit as an invoice and a receipt', async ({
    appointmentsPage,
    billingPage,
    appointmentsApi,
    billingApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const patient = buildPatient();
    const day = nextClinicDay();
    const amount = buildPaymentAmount();
    const appointment = await test.step('book a visit and mark it attended (through the API)', async () => {
      const booked = await bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, patient, day);
      expect((await appointmentsApi.update(booked.id, { status: 'completed' })).ok()).toBe(true);
      return booked;
    });

    await test.step(`open the visit and record a payment of ${aed(amount)}, all done`, async () => {
      await appointmentsPage.open(day);
      await appointmentsPage.openAppointment(setup.treatment.name);
      await appointmentsPage.panel.recordPayment(appointment.id, amount);
    });

    const billing =
      await test.step('the server has a paid invoice and a cleared receipt for it', async () => {
        const record = await billingApi.contactBillingRecord(appointment.contactId);
        expect(record.invoices).toEqual([
          expect.objectContaining({
            appointmentId: appointment.id,
            total: amount.toFixed(2),
            status: 'paid',
          }),
        ]);
        expect(record.receipts).toEqual([
          expect.objectContaining({
            appointmentId: appointment.id,
            amount: amount.toFixed(2),
            status: 'cleared',
          }),
        ]);
        return record;
      });
    const [invoice, receipt] = [billing.invoices[0], billing.receipts[0]];
    await test.step('the visit panel shows both, and the outcome "All done"', async () => {
      const panel = appointmentsPage.panel;
      await expect(panel.document(invoice.code)).toContainText(aed(amount));
      await expect(panel.document(receipt.code)).toContainText(aed(amount));
      await expect(panel.root).toContainText('All done');
      await expect(panel.recordPaymentButton).toBeHidden();
    });
    await test.step('Billing → Documents lists the invoice and the receipt for the patient', async () => {
      await billingPage.open('Documents');
      const rows = billingPage.rowsFor(fullName(patient));
      await expect(rows).toHaveCount(2);
      await expect(rows.filter({ hasText: invoice.code })).toContainText('Invoice');
      await expect(rows.filter({ hasText: receipt.code })).toContainText('Receipt');
      for (const row of await rows.all()) await expect(row).toContainText(aed(amount));
    });
    await test.step('Needs review no longer lists the patient', async () => {
      await billingPage.openTab('Needs review');
      await expect(billingPage.rowsFor(fullName(patient))).toHaveCount(0);
    });
  });

  test("should hold an advance as credit on the patient's account", async ({
    contactsPage,
    billingPage,
    billingApi,
    contactsApi,
    cleanup,
  }) => {
    const patient = buildPatient();
    const name = fullName(patient);
    const amount = buildPaymentAmount();
    const note = `Package deposit for ${name}`;
    const contact = await test.step('create the patient (through the API)', () =>
      contactsApi.createRecord(patient));
    // Deleting the contact also removes the advance.
    cleanup.add(`patient "${name}" and their advance`, () => contactsApi.deleteIfExists(contact.id));

    const panel = await test.step('open the contact and add an advance on its Billing tab', async () => {
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
    await test.step('the Billing tab shows the advance and the money on account', async () => {
      await expect(panel.billingDocument(advance.code)).toContainText(aed(amount));
      await expect(panel.root).toContainText(`${aed(amount)} on account`);
    });
    await test.step('Billing → Credit on account lists the patient with that credit', async () => {
      await billingPage.open('Credit on account');
      await billingPage.searchBox.fill(name);
      const row = billingPage.rowsFor(name);
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(aed(amount));
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
            await billingApi.addAdvance(contact.id, {
              amount: 100,
              advanceDate: new Date().toISOString().slice(0, 10),
            })
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
