import { test, expect } from '../../../fixtures/test';
import { ENDPOINTS } from '../../../api/ResourceApi';
import { env } from '../../../config/env';
import { buildPatient, toDateParam } from '../../../utils/testData';

const today = () => toDateParam(new Date());

// Checks that hold in any workspace. QA Workspace keeps its money in its EMR, so recording money
// (payments, advances, the lists and ledger they fill) is tested in the workspace without an EMR:
// tests/clinic/no-emr/billing-no-emr.api.spec.ts. Each test creates its own patient.
test.describe('Billing API', { tag: ['@clinic', '@billing'] }, () => {
  test.describe('advances', () => {
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
