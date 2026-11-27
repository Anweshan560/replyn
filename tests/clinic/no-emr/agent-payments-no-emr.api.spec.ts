import { test, expect } from '../../../fixtures/test';
import type { Invoice } from '../../../api/AppointmentsApi';
import { BillingApi } from '../../../api/AppointmentsApi';
import type { HeadersProvider } from '../../../api/ResourceApi';
import { ENDPOINTS } from '../../../api/ResourceApi';
import { env } from '../../../config/env';
import { buildPatient, buildPaymentAmount } from '../../../utils/testData';
import { bookThroughApi, createDoctorAndTreatment } from '../bookingSetup';

const yesterday = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

/**
 * The built-in Agent role's Payments default (Settings → Roles → Agent): "Record" is ticked, "And
 * fix or delete one they recorded, until the end of that day", but not "Edit or delete anyone's".
 * Payments can only be recorded in the workspace without an EMR, so the Agent must be a member of
 * it too (with the Agent role); until then the test is skipped.
 */
test.describe('Roles: the Agent role on payments', { tag: ['@roles', '@permissions', '@billing'] }, () => {
  test('should let an Agent correct a payment they recorded today, but not one someone else recorded', async ({
    request,
    workspaceId,
    appointmentsApi,
    billingApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    agent,
    cleanup,
  }) => {
    // The Agent's session opens QA Workspace; send their calls to this workspace instead.
    const agentHeaders: HeadersProvider = async () => ({
      ...(await agent.headers()),
      'x-workspace-id': workspaceId,
    });
    const membership = await request.get(`${env.apiUrl}${ENDPOINTS.billing}`, {
      headers: await agentHeaders(),
    });
    test.skip(
      membership.status() === 403,
      `The Agent account is not a member of the workspace "${env.noEmrWorkspace.trim()}"`,
    );

    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const attendedVisit = async () => {
      const visit = await bookThroughApi(
        { appointmentsApi, contactsApi },
        cleanup,
        setup,
        buildPatient(),
        yesterday(),
      );
      expect((await appointmentsApi.update(visit.id, { status: 'completed' })).ok()).toBe(true);
      return visit;
    };
    const amount = buildPaymentAmount();
    const record = async (api: BillingApi, appointmentId: string): Promise<Invoice> => {
      const response = await api.recordInvoice({ appointmentId, total: amount });
      expect(response.status()).toBe(201);
      return (await response.json()).data;
    };
    const asAgent = async (method: 'PATCH' | 'DELETE', invoiceId: string) =>
      request.fetch(`${env.apiUrl}${ENDPOINTS.invoices}/${invoiceId}`, {
        method,
        headers: await agentHeaders(),
        data:
          method === 'PATCH'
            ? { confirmDuplicate: false, total: amount, externalCode: '', notes: 'qa agent fix' }
            : undefined,
      });

    const adminInvoice = await test.step('the admin records a payment', async () =>
      record(billingApi, (await attendedVisit()).id));
    const agentInvoice = await test.step('the Agent records a payment: responds 201', async () =>
      record(new BillingApi(request, agentHeaders), (await attendedVisit()).id));

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
