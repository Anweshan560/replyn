import { test, expect, type Cleanup } from '../../../fixtures/test';
import type { Appointment, AppointmentsApi, Invoice, LedgerRow } from '../../../api/AppointmentsApi';
import { fullName, type ContactsApi } from '../../../api/ContactsApi';
import type { DoctorsApi } from '../../../api/DoctorsApi';
import type { TreatmentsApi } from '../../../api/TreatmentsApi';
import { ENDPOINTS } from '../../../api/ResourceApi';
import { env } from '../../../config/env';
import { buildPatient, buildPaymentAmount, toDateParam } from '../../../utils/testData';
import { bookThroughApi, createDoctorAndTreatment } from '../bookingSetup';

const MISSING_ID = '00000000-0000-7000-8000-000000000000';
const today = () => toDateParam(new Date());
const yesterday = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

/** A patient's rows in a billing patients list (Owes money, Credit on account, All patients). */
type PatientRow = { contactId: string; contactName: string; balance: string; outstanding: string };

/**
 * Billing in the workspace without an EMR (env.noEmrWorkspace): Replyn records the money itself.
 * A visit's payment is an invoice (POST /v1/clinics/invoices, "Add payment" in the visit panel),
 * which comes with a cleared receipt; an advance is money paid ahead of visits. Each test makes its
 * own doctor, treatment and patient. Deleting the patient's contact also removes their invoices,
 * receipts and advances, so the cleanup leaves the workspace's billing as it was.
 */
test.describe('Billing API without an EMR', { tag: ['@clinic', '@billing'] }, () => {
  /** Book a visit yesterday and mark it attended, as the clinic does before taking the payment. */
  async function attendedVisit({
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }: {
    appointmentsApi: AppointmentsApi;
    contactsApi: ContactsApi;
    doctorsApi: DoctorsApi;
    treatmentsApi: TreatmentsApi;
    cleanup: Cleanup;
  }): Promise<Appointment> {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    return test.step('book a visit yesterday and mark it attended', async () => {
      const booked = await bookThroughApi(
        { appointmentsApi, contactsApi },
        cleanup,
        setup,
        buildPatient(),
        yesterday(),
      );
      expect((await appointmentsApi.update(booked.id, { status: 'completed' })).ok()).toBe(true);
      return booked;
    });
  }

  test.describe("a visit's payment", () => {
    test('should record it as a paid invoice with a cleared receipt', async ({
      appointmentsApi,
      billingApi,
      contactsApi,
      doctorsApi,
      treatmentsApi,
      cleanup,
    }) => {
      const visit = await attendedVisit({ appointmentsApi, contactsApi, doctorsApi, treatmentsApi, cleanup });
      const amount = buildPaymentAmount();

      const response = await test.step(`POST an invoice of ${amount} for the visit`, () =>
        billingApi.recordInvoice({ appointmentId: visit.id, total: amount, notes: 'qa payment' }));

      await test.step('responds 201 with a paid invoice, made by hand, with an INV code', async () => {
        expect(response.status()).toBe(201);
        expect((await response.json()).data).toMatchObject({
          appointmentId: visit.id,
          contactId: visit.contactId,
          total: amount.toFixed(2),
          status: 'paid',
          source: 'manual',
          notes: 'qa payment',
          invoiceDate: today(),
          code: expect.stringMatching(/^INV-\d+$/),
        });
      });
      await test.step("the patient's billing has the invoice, a cleared receipt for it, and owes nothing", async () => {
        const invoice: Invoice = (await response.json()).data;
        const billing = await billingApi.contactBillingRecord(visit.contactId);
        expect(billing.invoices).toEqual([expect.objectContaining({ id: invoice.id, status: 'paid' })]);
        expect(billing.receipts).toEqual([
          expect.objectContaining({
            invoiceId: invoice.id,
            appointmentId: visit.id,
            amount: amount.toFixed(2),
            status: 'cleared',
          }),
        ]);
        expect(billing.summary).toMatchObject({
          invoiced: amount.toFixed(2),
          direct: amount.toFixed(2),
          outstanding: '0.00',
        });
      });
    });

    test('should refuse a second invoice for the same amount with 409 duplicate_invoice', async ({
      appointmentsApi,
      billingApi,
      contactsApi,
      doctorsApi,
      treatmentsApi,
      cleanup,
    }) => {
      const visit = await attendedVisit({ appointmentsApi, contactsApi, doctorsApi, treatmentsApi, cleanup });
      const first = await test.step('record a payment of 150', async () => {
        const response = await billingApi.recordInvoice({ appointmentId: visit.id, total: 150 });
        expect(response.status()).toBe(201);
        return (await response.json()).data as Invoice;
      });

      const response = await test.step('POST another invoice of 150 for the same visit', () =>
        billingApi.recordInvoice({ appointmentId: visit.id, total: 150 }));

      await test.step('responds 409 duplicate_invoice, naming the first invoice', async () => {
        expect(response.status()).toBe(409);
        const body = await response.json();
        expect(body).toMatchObject({
          code: 'duplicate_invoice',
          message:
            'This appointment already has an invoice for a similar amount. Somebody may have just added it.',
        });
        expect(body.duplicates.map((invoice: Invoice) => invoice.id)).toEqual([first.id]);
      });
      await test.step('the patient still has one invoice', async () => {
        expect((await billingApi.contactBillingRecord(visit.contactId)).invoices).toHaveLength(1);
      });
    });

    test('should delete an invoice together with its receipt', async ({
      appointmentsApi,
      billingApi,
      contactsApi,
      doctorsApi,
      treatmentsApi,
      cleanup,
    }) => {
      const visit = await attendedVisit({ appointmentsApi, contactsApi, doctorsApi, treatmentsApi, cleanup });
      const invoice = await test.step('record a payment of 80', async () => {
        const response = await billingApi.recordInvoice({ appointmentId: visit.id, total: 80 });
        expect(response.status()).toBe(201);
        return (await response.json()).data as Invoice;
      });

      const response = await test.step('DELETE the invoice', () => billingApi.deleteInvoice(invoice.id));

      await test.step('responds 200, and the patient has no invoice, receipt or amount billed', async () => {
        expect(response.status()).toBe(200);
        const billing = await billingApi.contactBillingRecord(visit.contactId);
        expect(billing.invoices).toEqual([]);
        expect(billing.receipts).toEqual([]);
        expect(billing.summary).toMatchObject({ invoiced: '0.00', direct: '0.00' });
      });
    });

    test('should reject a negative amount with 422', async ({
      appointmentsApi,
      billingApi,
      contactsApi,
      doctorsApi,
      treatmentsApi,
      cleanup,
    }) => {
      const visit = await attendedVisit({ appointmentsApi, contactsApi, doctorsApi, treatmentsApi, cleanup });

      const response = await billingApi.recordInvoice({ appointmentId: visit.id, total: -5 });

      expect(response.status()).toBe(422);
      expect((await response.json()).message).toEqual({ total: 'total must not be less than 0' });
      expect((await billingApi.contactBillingRecord(visit.contactId)).invoices).toEqual([]);
    });

    test('should reject an invoice without a visit or an amount with 422', async ({ billingApi }) => {
      const response = await billingApi.recordInvoice({});

      // Note: the message for a missing total is misleading ("must not be greater than
      // 9999999999.99"), so only the field is checked for it.
      expect(response.status()).toBe(422);
      const { message } = await response.json();
      expect(message).toMatchObject({ appointmentId: 'appointmentId must be a UUID' });
      expect(message).toHaveProperty('total');
    });

    test('should answer 404 "Appointment not found" for an unknown visit', async ({ billingApi }) => {
      const response = await billingApi.recordInvoice({ appointmentId: MISSING_ID, total: 5 });

      expect(response.status()).toBe(404);
      expect((await response.json()).message).toBe('Appointment not found');
    });
  });

  test.describe('advances', () => {
    test("should add an advance to the patient's account", async ({ billingApi, contactsApi, cleanup }) => {
      const contact = await test.step('create a patient', () => contactsApi.createRecord(buildPatient()));
      cleanup.add(`patient ${contact.id}`, () => contactsApi.deleteIfExists(contact.id));
      const amount = buildPaymentAmount();
      const payload = { amount, advanceDate: today(), notes: 'Package of 5 sessions' };

      const response = await test.step('POST an advance', () => billingApi.addAdvance(contact.id, payload));

      await test.step('responds 201 with the advance, cleared, and an ADV code', async () => {
        expect(response.status()).toBe(201);
        expect((await response.json()).data).toMatchObject({
          contactId: contact.id,
          amount: amount.toFixed(2),
          advanceDate: payload.advanceDate,
          notes: payload.notes,
          status: 'cleared',
          code: expect.stringMatching(/^ADV-\d+$/),
        });
      });
      await test.step('the patient now has that much on account', async () => {
        const billing = await billingApi.contactBillingRecord(contact.id);
        expect(billing.summary).toMatchObject({ advances: amount.toFixed(2), balance: amount.toFixed(2) });
        expect(billing.advances).toHaveLength(1);
      });
    });

    test('should answer 404 "No such contact" for an unknown patient', async ({ billingApi }) => {
      const response = await billingApi.addAdvance(MISSING_ID, { amount: 10, advanceDate: today() });

      expect(response.status()).toBe(404);
      expect((await response.json()).message).toBe('No such contact');
    });
  });

  test.describe('lists', () => {
    test('should list a patient with an advance under credit and all, but not under owes', async ({
      billingApi,
      contactsApi,
      cleanup,
    }) => {
      const patient = buildPatient();
      const contact = await contactsApi.createRecord(patient);
      cleanup.add(`patient ${contact.id}`, () => contactsApi.deleteIfExists(contact.id));
      await test.step('give them an advance of 300', async () => {
        expect(
          (await billingApi.addAdvance(contact.id, { amount: 300, advanceDate: today() })).status(),
        ).toBe(201);
      });
      const find = async (view: string): Promise<PatientRow | undefined> => {
        const response = await billingApi.patients({ view, search: fullName(patient), page: 1, limit: 25 });
        expect(response.status()).toBe(200);
        return ((await response.json()).data.result as PatientRow[]).find(
          (row) => row.contactId === contact.id,
        );
      };

      await test.step('view=credit lists them with a balance of 300.00', async () => {
        expect(await find('credit')).toMatchObject({ contactName: fullName(patient), balance: '300.00' });
      });
      await test.step('view=all lists them', async () => {
        expect(await find('all')).toBeDefined();
      });
      await test.step('view=owes does not (they owe nothing)', async () => {
        expect(await find('owes')).toBeUndefined();
      });
    });

    test("should show a paid visit's invoice and receipt in the ledger", async ({
      appointmentsApi,
      billingApi,
      contactsApi,
      doctorsApi,
      treatmentsApi,
      cleanup,
    }) => {
      const visit = await attendedVisit({ appointmentsApi, contactsApi, doctorsApi, treatmentsApi, cleanup });
      const amount = buildPaymentAmount();
      await test.step(`record a payment of ${amount}`, async () => {
        expect((await billingApi.recordInvoice({ appointmentId: visit.id, total: amount })).status()).toBe(
          201,
        );
      });

      const rows = await test.step('GET the ledger', async () => {
        const response = await billingApi.ledger({ page: 1, limit: 100 });
        expect(response.status()).toBe(200);
        return ((await response.json()).data.result as LedgerRow[]).filter(
          (row) => row.appointmentId === visit.id,
        );
      });

      await test.step('it holds the paid invoice and the cleared receipt, both for the full amount', () => {
        expect(rows.map((row) => [row.kind, row.status, row.amount]).sort()).toEqual([
          ['invoice', 'paid', amount.toFixed(2)],
          ['receipt', 'cleared', amount.toFixed(2)],
        ]);
      });
    });
  });

  test("should remove a patient's billing records with their contact", async ({
    appointmentsApi,
    billingApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const visit = await attendedVisit({ appointmentsApi, contactsApi, doctorsApi, treatmentsApi, cleanup });
    await test.step('record a payment and add an advance', async () => {
      expect((await billingApi.recordInvoice({ appointmentId: visit.id, total: 200 })).status()).toBe(201);
      expect(
        (await billingApi.addAdvance(visit.contactId, { amount: 50, advanceDate: today() })).status(),
      ).toBe(201);
    });

    await test.step('delete the appointment, then the contact', async () => {
      expect((await appointmentsApi.delete(visit.id)).ok()).toBe(true);
      expect((await contactsApi.delete(visit.contactId)).ok()).toBe(true);
    });

    await test.step('the ledger no longer holds anything for that patient', async () => {
      const rows: LedgerRow[] = (await (await billingApi.ledger({ page: 1, limit: 100 })).json()).data.result;
      expect(rows.filter((row) => row.contactId === visit.contactId)).toEqual([]);
    });
  });

  test('should reject recording a payment without a login token with 401', async ({
    request,
    apiHeaders,
  }) => {
    const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

    const response = await request.post(`${env.apiUrl}${ENDPOINTS.invoices}`, {
      headers: headersWithoutToken,
      data: { appointmentId: MISSING_ID, total: 5 },
    });

    expect(response.status()).toBe(401);
  });
});
