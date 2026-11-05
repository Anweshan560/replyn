import { test, expect } from '../../../fixtures/test';
import { editableFields, toOrganizationPayload } from '../../../api/OrganizationApi';
import { env } from '../../../config/env';
import { buildOrganizationProfile } from '../../../utils/testData';

// Runs only on its own, like organization.spec.ts, and restores the organization afterwards.
test.describe('Organization API', { tag: ['@settings', '@organization'] }, () => {
  test.skip(
    !env.runExclusiveTests,
    'Changes the whole organization, so it must run on its own: npm run test:exclusive',
  );

  test('should return the organization with its profile fields', async ({ organizationApi }) => {
    const response = await test.step('GET the organization', () => organizationApi.get());

    await test.step('responds 200 with every profile field', async () => {
      expect(response.status()).toBe(200);
      const { data } = await response.json();
      expect(data).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          phoneNumber: expect.stringMatching(/^\+\d+$/),
          region: expect.stringMatching(/^[A-Z]{2}$/),
          timezone: expect.any(String),
          type: expect.stringMatching(/^(clinic|ecommerce)$/),
          currency: expect.stringMatching(/^[A-Z]{3}$/),
        }),
      );
      // Optional: null until someone fills it in.
      expect(data).toHaveProperty('website');
    });
  });

  test('should update every editable field and return the new values', async ({
    organizationApi,
    cleanup,
  }) => {
    const original = await test.step('remember the current organization', () => organizationApi.current());
    cleanup.add('restore the organization', () => organizationApi.restore(original));
    const payload = toOrganizationPayload(buildOrganizationProfile(original));

    const response = await test.step('PATCH every editable field', () =>
      organizationApi.update(original.id, payload));

    await test.step('responds 200 with the new values', async () => {
      expect(response.status()).toBe(200);
      expect((await response.json()).data).toMatchObject(payload);
    });
    await test.step('GET returns the new values; id and currency are unchanged', async () => {
      const current = await organizationApi.current();
      expect(current).toMatchObject(payload);
      expect(current.id).toBe(original.id);
      expect(current.currency).toBe(original.currency);
    });
  });

  for (const { field, value, status, message } of [
    {
      field: 'type',
      value: 'not-a-type',
      status: 422,
      message: 'type must be one of the following values: clinic, ecommerce',
    },
    { field: 'website', value: 'not a url', status: 422, message: 'website must be a URL address' },
    { field: 'timezone', value: 'Not/AZone', status: 400, message: 'Unknown IANA timezone: Not/AZone' },
  ]) {
    test(`should reject an invalid ${field} with ${status} and change nothing`, async ({
      organizationApi,
      cleanup,
    }) => {
      const original = await test.step('remember the current organization', () => organizationApi.current());
      // Only matters if the server wrongly accepts the value.
      cleanup.add('restore the organization', () => organizationApi.restore(original));

      const response = await test.step(`PATCH ${field} = "${value}"`, () =>
        organizationApi.update(original.id, { [field]: value }));

      await test.step(`responds ${status} with "${message}"`, async () => {
        expect(response.status()).toBe(status);
        const body = await response.json();
        // Validation errors list messages per field; other errors have a single message.
        expect(typeof body.message === 'string' ? body.message : body.message[field]).toBe(message);
      });
      await test.step('the organization is unchanged', async () => {
        expect(editableFields(await organizationApi.current())).toEqual(editableFields(original));
      });
    });
  }

  test('should reject a request without a login token with 401', async ({ request, apiHeaders }) => {
    const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

    const response = await test.step('GET the organization without a login token', () =>
      request.get(`${env.apiUrl}/v1/organizations`, { headers: headersWithoutToken }));

    await test.step('responds 401', () => expect(response.status()).toBe(401));
  });
});
