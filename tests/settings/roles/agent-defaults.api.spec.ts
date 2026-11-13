import { test, expect } from '../../../fixtures/test';
import type { LedgerRow } from '../../../api/AppointmentsApi';
import { CustomViewsApi, toCustomViewPayload } from '../../../api/CustomViewsApi';
import { AppointmentsApi } from '../../../api/AppointmentsApi';
import { ENDPOINTS } from '../../../api/ResourceApi';
import { env } from '../../../config/env';
import { buildPatient, buildPaymentAmount, buildSavedView, nextClinicDay } from '../../../utils/testData';
import { bookThroughApi, createDoctorAndTreatment } from '../../clinic/bookingSetup';

/**
 * The built-in Agent role's defaults (Settings → Roles → Agent) where the admin has to make
 * something first: a view shared with everyone, a payment someone else recorded. The admin works
 * through the usual fixtures, the Agent through `agent.headers`.
 */
test.describe('Roles: the Agent role on records others made', { tag: ['@roles', '@permissions'] }, () => {
  test('should show an Agent a view shared with everyone, but not let them change or delete it', async ({
    request,
    customViewsApi,
    agent,
    cleanup,
  }) => {
    const shared = await customViewsApi.createRecord(
      toCustomViewPayload({ ...buildSavedView(), share: 'Everyone' }),
    );
    cleanup.add(`view ${shared.name}`, () => customViewsApi.deleteIfExists(shared.id));
    const agentViews = new CustomViewsApi(request, agent.headers);
    const refusal = 'Only the creator can change this view';

    await test.step("the Agent's list has it", async () => {
      expect((await agentViews.listRecords()).map((view) => view.id)).toContain(shared.id);
    });
    await test.step('rename it: responds 403', async () => {
      const response = await agentViews.update(shared.id, { name: buildSavedView().name });
      expect(response.status()).toBe(403);
      expect((await response.json()).message).toBe(refusal);
    });
    await test.step('delete it: responds 403, and it is still there', async () => {
      const response = await agentViews.delete(shared.id);
      expect(response.status()).toBe(403);
      expect((await response.json()).message).toBe(refusal);
      expect((await customViewsApi.get(shared.id)).status()).toBe(200);
    });
  });

  test('should let an Agent correct a payment they recorded today, but not one someone else recorded', async ({
    request,
    appointmentsApi,
    billingApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    agent,
    cleanup,
  }) => {
    // Payments → "Record" (ticked): "And fix or delete one they recorded, until the end of that day".
    // "Edit or delete anyone's" is not ticked. Each patient is deleted afterwards, with their invoices.
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const book = () =>
      bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, buildPatient(), nextClinicDay());
    const agentAppointments = new AppointmentsApi(request, agent.headers);
    const amount = buildPaymentAmount();
    const paid = {
      attendance: 'showed_up',
      isPaid: true,
      payment: { amount },
      consultationAnswer: 'all_done',
    } as const;
    const invoiceFor = async (appointmentId: string) => {
      const rows = (await (await billingApi.ledger({ page: 1, limit: 100 })).json()).data
        .result as LedgerRow[];
      const invoice = rows.find((row) => row.appointmentId === appointmentId && row.kind === 'invoice');
      expect(invoice, `an invoice for appointment ${appointmentId}`).toBeDefined();
      return invoice!;
    };
    const asAgent = async (method: 'PATCH' | 'DELETE', invoiceId: string) =>
      request.fetch(`${env.apiUrl}${ENDPOINTS.invoices}/${invoiceId}`, {
        method,
        headers: await agent.headers(),
        data:
          method === 'PATCH'
            ? { confirmDuplicate: false, total: amount, externalCode: '', notes: 'qa agent fix' }
            : undefined,
      });

    const adminInvoice = await test.step('the admin records a payment', async () => {
      const visit = await book();
      expect((await appointmentsApi.recordOutcome(visit.id, paid)).status()).toBe(201);
      return invoiceFor(visit.id);
    });
    const agentInvoice = await test.step('the Agent records a payment: responds 201', async () => {
      const visit = await book();
      expect((await agentAppointments.recordOutcome(visit.id, paid)).status()).toBe(201);
      return invoiceFor(visit.id);
    });

    const refusal = 'You can change a payment you recorded today. Ask someone who can correct payments.';
    await test.step("change or delete the admin's: responds 403", async () => {
      for (const method of ['PATCH', 'DELETE'] as const) {
        const response = await asAgent(method, adminInvoice.id);
        expect(response.status(), method).toBe(403);
        expect((await response.json()).message, method).toBe(refusal);
      }
    });
    await test.step('change their own, then delete it: responds 200', async () => {
      expect((await asAgent('PATCH', agentInvoice.id)).status()).toBe(200);
      expect((await asAgent('DELETE', agentInvoice.id)).status()).toBe(200);
    });
  });
});
