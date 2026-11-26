import { test, expect } from '../../../fixtures/test';
import { ENDPOINTS } from '../../../api/ResourceApi';
import { env } from '../../../config/env';
import { buildPatient } from '../../../utils/testData';
import { bookThroughApi, createDoctorAndTreatment, waitForEmrLink } from '../bookingSetup';

/** What Replyn answers when asked to record money in a workspace whose EMR keeps the money. */
const EMR_KEEPS_MONEY = 'This workspace records money in its EMR. Add it there, then sync it here.';

/** 11:00 yesterday: a visit that has happened. */
function yesterday(): Date {
  const day = new Date();
  day.setDate(day.getDate() - 1);
  day.setHours(11, 0, 0, 0);
  return day;
}

/** A row of the Needs review queue. */
type ReviewItem = {
  kind: string;
  appointmentId: string | null;
  contactId: string;
  treatmentName: string | null;
  doctorName: string | null;
  duplicateOfCode: string | null;
};

/**
 * Billing in EMR mode. QA Workspace is connected to ClinicSoft (an EMR), so money is recorded in
 * the EMR and synced into Replyn: Replyn refuses payments and advances, shows the synced invoices
 * and receipts, and flags visits the EMR has no invoice for. The tests that record money through
 * Replyn itself (billing.api.spec.ts, billing.spec.ts) need a workspace without an EMR.
 */
test.describe('Billing API in EMR mode', { tag: ['@clinic', '@billing'] }, () => {
  test('should refuse an advance with 409, saying to add it in the EMR', async ({
    billingApi,
    contactsApi,
    cleanup,
  }) => {
    const contact = await test.step('create a patient', () => contactsApi.createRecord(buildPatient()));
    cleanup.add(`patient ${contact.id}`, () => contactsApi.deleteIfExists(contact.id));

    const response = await test.step('POST an advance', () =>
      billingApi.addAdvance(contact.id, { amount: 100, advanceDate: new Date().toISOString().slice(0, 10) }));

    await test.step('responds 409 "records money in its EMR", and the patient has no advance', async () => {
      expect(response.status()).toBe(409);
      expect((await response.json()).message).toBe(EMR_KEEPS_MONEY);
      const billing = await billingApi.contactBillingRecord(contact.id);
      expect(billing.advances).toEqual([]);
      expect(billing.summary.advances).toBe('0.00');
    });
  });

  test("should sync a visit's billing from the EMR on request", async ({
    request,
    apiHeaders,
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const visit = await test.step('book a visit (Replyn sends it to the EMR)', () =>
      bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, buildPatient(), yesterday()));
    const billingUrl = `${env.apiUrl}${ENDPOINTS.appointments}/${visit.id}/billing`;
    // Until the EMR has the visit, its billing status is "not_linked".
    await waitForEmrLink(appointmentsApi, visit.id);

    await test.step('once linked, before a sync: billing is "local", with no counts, and never checked', async () => {
      const response = await request.get(billingUrl, { headers: await apiHeaders() });
      expect(response.status()).toBe(200);
      const { data } = await response.json();
      expect(data).toMatchObject({ status: 'local', counts: null });
      expect(data.integrationName).toEqual(expect.any(String));
      expect(data.appointment.billingCheckedAt).toBeNull();
    });

    const synced = await test.step('POST billing/sync ("Refresh billing")', async () =>
      request.post(`${billingUrl}/sync`, { headers: await apiHeaders() }));

    await test.step('responds 201 "synced" with what it brought in, and the visit records the check', async () => {
      expect(synced.status()).toBe(201);
      const { data } = await synced.json();
      expect(data.status).toBe('synced');
      expect(data.counts).toEqual({
        invoices: expect.any(Number),
        receipts: expect.any(Number),
        advances: expect.any(Number),
        contactsCreated: expect.any(Number),
        skipped: expect.any(Number),
      });
      expect(data.appointment.billingCheckedAt).toEqual(expect.any(String));
      const stored = (await (await appointmentsApi.get(visit.id)).json()).data;
      expect(stored.billingCheckedAt).toBe(data.appointment.billingCheckedAt);
    });
  });

  test("should answer no_mrn when syncing a patient the EMR doesn't know yet", async ({
    request,
    apiHeaders,
    contactsApi,
    cleanup,
  }) => {
    const contact = await test.step('create a patient (no EMR record number)', () =>
      contactsApi.createRecord(buildPatient()));
    cleanup.add(`patient ${contact.id}`, () => contactsApi.deleteIfExists(contact.id));

    const response = await test.step("POST the patient's billing/sync", async () =>
      request.post(`${env.apiUrl}${ENDPOINTS.clinicContacts}/${contact.id}/billing/sync`, {
        headers: await apiHeaders(),
      }));

    await test.step('responds 201 with status no_mrn and nothing synced', async () => {
      expect(response.status()).toBe(201);
      expect((await response.json()).data).toMatchObject({ status: 'no_mrn', mrn: null, counts: null });
    });
  });

  test('should flag an attended visit the EMR has no invoice for in Needs review', async ({
    appointmentsApi,
    billingApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const visit = await test.step('book a visit yesterday', () =>
      bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, buildPatient(), yesterday()));
    const reviewItem = async () => {
      const { result }: { result: ReviewItem[] } = (
        await (await billingApi.reviewQueue({ page: 1, limit: 100 })).json()
      ).data;
      return result.find((item) => item.appointmentId === visit.id);
    };

    await test.step('while it is still unconfirmed it is not in the queue', async () => {
      expect(await reviewItem()).toBeUndefined();
    });
    await test.step('mark it attended', async () => {
      expect((await appointmentsApi.update(visit.id, { status: 'completed' })).ok()).toBe(true);
    });
    await test.step('now it is in the queue as an unbilled visit, naming the treatment and doctor', async () => {
      await expect.poll(reviewItem, { timeout: 15_000 }).toMatchObject({
        kind: 'unbilled_visit',
        contactId: visit.contactId,
        treatmentName: setup.treatment.name,
        doctorName: setup.doctor.name,
      });
    });
  });

  test('should show EMR documents with their EMR reference, and tab counts that match each list', async ({
    billingApi,
  }) => {
    const [ledger, review] = await test.step('GET the ledger and the review queue', () =>
      Promise.all([
        billingApi.ledger({ page: 1, limit: 100 }).then((r) => r.json()),
        billingApi.reviewQueue({ page: 1, limit: 100 }).then((r) => r.json()),
      ]));

    await test.step('every document synced from the EMR has an EMR reference next to its own code', () => {
      const fromEmr = ledger.data.result.filter((row: { source: string }) => row.source === 'crm');
      for (const row of fromEmr) {
        expect(row.externalCode, row.code).toEqual(expect.any(String));
        expect(row.code, row.id).toMatch(/^(INV|REC|ADV)-\d+$/);
      }
    });
    await test.step('the ledger totals are numbers as text, e.g. "31500.00"', () => {
      expect(ledger.data.summary).toEqual({
        invoiced: expect.stringMatching(/^\d+\.\d{2}$/),
        collected: expect.stringMatching(/^\d+\.\d{2}$/),
        advances: expect.stringMatching(/^\d+\.\d{2}$/),
      });
    });
    await test.step('a held invoice in Needs review names the invoice it duplicates', () => {
      for (const item of review.data.result as ReviewItem[]) {
        if (item.kind === 'held_invoice')
          expect(item.duplicateOfCode, JSON.stringify(item)).toMatch(/^INV-\d+$/);
      }
    });
    // Other tests add to these lists at the same time, so compare counts read together, and retry.
    await test.step("each tab's count matches the size of its list", async () => {
      await expect(async () => {
        const [summary, owes, credit, all, queue] = await Promise.all([
          billingApi.patients({ page: 1, limit: 1 }).then(async (r) => (await r.json()).data.summary.counts),
          billingApi
            .patients({ view: 'owes', page: 1, limit: 1 })
            .then(async (r) => (await r.json()).data.meta.count),
          billingApi
            .patients({ view: 'credit', page: 1, limit: 1 })
            .then(async (r) => (await r.json()).data.meta.count),
          billingApi
            .patients({ view: 'all', page: 1, limit: 1 })
            .then(async (r) => (await r.json()).data.meta.count),
          billingApi.reviewQueue({ page: 1, limit: 1 }).then(async (r) => (await r.json()).data.meta.count),
        ]);
        expect(summary).toEqual({ owes, credit, all, review: queue });
      }).toPass({ timeout: 30_000 });
    });
  });
});
