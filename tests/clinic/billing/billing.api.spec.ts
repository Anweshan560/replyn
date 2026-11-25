import { test, expect } from '../../../fixtures/test';
import type { LedgerRow } from '../../../api/AppointmentsApi';
import { fullName } from '../../../api/ContactsApi';
import { ENDPOINTS } from '../../../api/ResourceApi';
import { env } from '../../../config/env';
import { buildPatient, buildPaymentAmount, nextClinicDay, toDateParam } from '../../../utils/testData';
import { bookThroughApi, createDoctorAndTreatment } from '../bookingSetup';

const MISSING_ID = '00000000-0000-7000-8000-000000000000';
const today = () => toDateParam(new Date());

/** A patient's rows in a billing patients list (Owes money, Credit on account, All patients). */
type PatientRow = { contactId: string; contactName: string; balance: string; outstanding: string };

// Each test creates its own patient. Deleting the contact also removes their invoices, receipts
// and advances, so the cleanup leaves the workspace's billing as it was.
test.describe('Billing API', { tag: ['@clinic', '@billing'] }, () => {
  test.describe('advances', () => {
    // Set aside 2026-11-25: the workspace now records money in its EMR ("Add it there, then sync it
    // here"), so Replyn refuses payments, advances and visit outcomes. Rewrite for EMR mode later.
    test.fixme("should add an advance to the patient's account", async ({
      billingApi,
      contactsApi,
      cleanup,
    }) => {
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

    test('should reject a negative amount with 422', async ({ billingApi, contactsApi, cleanup }) => {
      const contact = await contactsApi.createRecord(buildPatient());
      cleanup.add(`patient ${contact.id}`, () => contactsApi.deleteIfExists(contact.id));

      const response = await billingApi.addAdvance(contact.id, { amount: -50, advanceDate: today() });

      expect(response.status()).toBe(422);
      expect((await response.json()).message).toEqual({ amount: 'amount must be a positive number' });
      expect((await billingApi.contactBillingRecord(contact.id)).advances).toEqual([]);
    });

    test('should reject an advance without an amount with 422', async ({
      billingApi,
      contactsApi,
      cleanup,
    }) => {
      const contact = await contactsApi.createRecord(buildPatient());
      cleanup.add(`patient ${contact.id}`, () => contactsApi.deleteIfExists(contact.id));

      const response = await billingApi.addAdvance(contact.id, { advanceDate: today() });

      // Note: the message is misleading ("must not be greater than 9999999999.99") for a missing
      // amount, so only the field is checked here.
      expect(response.status()).toBe(422);
      expect((await response.json()).message).toHaveProperty('amount');
    });

    // Set aside 2026-11-25: the workspace now records money in its EMR ("Add it there, then sync it
    // here"), so Replyn refuses payments, advances and visit outcomes. Rewrite for EMR mode later.
    test.fixme('should answer 404 "No such contact" for an unknown patient', async ({ billingApi }) => {
      const response = await billingApi.addAdvance(MISSING_ID, { amount: 10, advanceDate: today() });

      expect(response.status()).toBe(404);
      expect((await response.json()).message).toBe('No such contact');
    });
  });

  test.describe('lists', () => {
    // Set aside 2026-11-25: the workspace now records money in its EMR ("Add it there, then sync it
    // here"), so Replyn refuses payments, advances and visit outcomes. Rewrite for EMR mode later.
    test.fixme('should list a patient with an advance under credit and all, but not under owes', async ({
      billingApi,
      contactsApi,
      cleanup,
    }) => {
      const patient = buildPatient();
      const contact = await contactsApi.createRecord(patient);
      cleanup.add(`patient ${contact.id}`, () => contactsApi.deleteIfExists(contact.id));
      await test.step('give them an advance of AED 300', async () => {
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

    // Set aside 2026-11-25: the workspace now records money in its EMR ("Add it there, then sync it
    // here"), so Replyn refuses payments, advances and visit outcomes. Rewrite for EMR mode later.
    test.fixme('should put an attended visit with no invoice in the review queue, and take it out once paid', async ({
      appointmentsApi,
      billingApi,
      contactsApi,
      doctorsApi,
      treatmentsApi,
      cleanup,
    }) => {
      const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
      const appointment = await test.step('book a visit and mark it attended', async () => {
        const booked = await bookThroughApi(
          { appointmentsApi, contactsApi },
          cleanup,
          setup,
          buildPatient(),
          nextClinicDay(),
        );
        expect((await appointmentsApi.update(booked.id, { status: 'completed' })).ok()).toBe(true);
        return booked;
      });
      const inQueue = async () => {
        const response = await billingApi.reviewQueue({ page: 1, limit: 100 });
        expect(response.status()).toBe(200);
        return JSON.stringify((await response.json()).data).includes(appointment.id);
      };

      await test.step('the review queue lists the visit', async () => {
        expect(await inQueue()).toBe(true);
      });
      await test.step('record the payment', async () => {
        const response = await appointmentsApi.recordOutcome(appointment.id, {
          attendance: 'showed_up',
          isPaid: true,
          payment: { amount: 150 },
          consultationAnswer: 'all_done',
        });
        expect(response.status()).toBe(201);
      });
      await test.step('the review queue no longer lists it', async () => {
        expect(await inQueue()).toBe(false);
      });
    });

    // Set aside 2026-11-25: the workspace now records money in its EMR ("Add it there, then sync it
    // here"), so Replyn refuses payments, advances and visit outcomes. Rewrite for EMR mode later.
    test.fixme("should show a paid visit's invoice and receipt in the ledger", async ({
      appointmentsApi,
      billingApi,
      contactsApi,
      doctorsApi,
      treatmentsApi,
      cleanup,
    }) => {
      const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
      const amount = buildPaymentAmount();
      const appointment = await test.step(`book a visit and record a payment of ${amount}`, async () => {
        const booked = await bookThroughApi(
          { appointmentsApi, contactsApi },
          cleanup,
          setup,
          buildPatient(),
          nextClinicDay(),
        );
        const response = await appointmentsApi.recordOutcome(booked.id, {
          attendance: 'showed_up',
          isPaid: true,
          payment: { amount },
          consultationAnswer: 'all_done',
        });
        expect(response.status()).toBe(201);
        return booked;
      });

      const rows = await test.step('GET the ledger', async () => {
        const response = await billingApi.ledger({ page: 1, limit: 100 });
        expect(response.status()).toBe(200);
        return ((await response.json()).data.result as LedgerRow[]).filter(
          (row) => row.appointmentId === appointment.id,
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
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const appointment = await test.step('book a paid visit and add an advance', async () => {
      const booked = await bookThroughApi(
        { appointmentsApi, contactsApi },
        cleanup,
        setup,
        buildPatient(),
        nextClinicDay(),
      );
      await appointmentsApi.recordOutcome(booked.id, {
        attendance: 'showed_up',
        isPaid: true,
        payment: { amount: 200 },
        consultationAnswer: 'all_done',
      });
      await billingApi.addAdvance(booked.contactId, { amount: 50, advanceDate: today() });
      return booked;
    });

    await test.step('delete the appointment, then the contact', async () => {
      expect((await appointmentsApi.delete(appointment.id)).ok()).toBe(true);
      expect((await contactsApi.delete(appointment.contactId)).ok()).toBe(true);
    });

    await test.step('the ledger no longer holds anything for that patient', async () => {
      const rows: LedgerRow[] = (await (await billingApi.ledger({ page: 1, limit: 100 })).json()).data.result;
      expect(rows.filter((row) => row.contactId === appointment.contactId)).toEqual([]);
    });
  });

  test('should reject requests without a login token with 401', async ({ request, apiHeaders }) => {
    const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

    for (const path of [ENDPOINTS.billing, `${ENDPOINTS.billing}/patients`, `${ENDPOINTS.billing}/review`]) {
      await test.step(`GET ${path} without a token responds 401`, async () => {
        const response = await request.get(`${env.apiUrl}${path}`, { headers: headersWithoutToken });
        expect(response.status()).toBe(401);
      });
    }
  });
});
