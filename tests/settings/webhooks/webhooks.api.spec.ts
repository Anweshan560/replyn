import { test, expect } from '../../../fixtures/test';
import { toWebhookPayload } from '../../../api/DeveloperApi';
import { env } from '../../../config/env';
import { WEBHOOK_EVENT, buildWebhook } from '../../../utils/testData';
import { knownBug } from '../../../utils/knownBug';

// Webhooks point at example.com, so nothing is ever delivered anywhere real.
test.describe('Webhooks API', { tag: ['@settings', '@webhooks'] }, () => {
  test('should list the events a webhook can receive', async ({ webhooksApi }) => {
    const response = await test.step('GET the event types', () => webhooksApi.eventTypes());

    await test.step(`responds 200 and offers ${WEBHOOK_EVENT}, with a description`, async () => {
      expect(response.status()).toBe(200);
      expect((await response.json()).data).toEqual(
        expect.arrayContaining([
          { type: WEBHOOK_EVENT, description: expect.stringContaining('inbound message') },
        ]),
      );
    });
  });

  test('should create a webhook and return every field that was sent', async ({ webhooksApi, cleanup }) => {
    const payload = toWebhookPayload(buildWebhook());

    const response = await test.step('POST a new webhook', () => webhooksApi.create(payload));
    const body = await response.json();
    if (body.data?.id) cleanup.add(`webhook ${payload.url}`, () => webhooksApi.deleteIfExists(body.data.id));

    await test.step('responds 201 with every field, an ep_ id, and enabled', () => {
      expect(response.status()).toBe(201);
      expect(body.data).toMatchObject({ ...payload, id: expect.stringMatching(/^ep_/), disabled: false });
    });
    await test.step('the list contains it with the same fields', async () => {
      expect(await webhooksApi.findRecord(body.data.id)).toMatchObject(payload);
    });
  });

  test('should update the URL and description of a webhook', async ({ webhooksApi, cleanup }) => {
    const created = await test.step('create a webhook', () =>
      webhooksApi.createRecord(toWebhookPayload(buildWebhook())));
    cleanup.add(`webhook ${created.url}`, () => webhooksApi.deleteIfExists(created.id));
    const updated = toWebhookPayload(buildWebhook());

    const response = await test.step('PATCH every field', () => webhooksApi.update(created.id, updated));

    await test.step('responds 200, and the list shows the new values', async () => {
      expect(response.status()).toBe(200);
      expect(await webhooksApi.findRecord(created.id)).toMatchObject(updated);
    });
  });

  test('should give each webhook its own whsec_ signing secret', async ({ webhooksApi, cleanup }) => {
    const [first, second] = await test.step('create two webhooks', () =>
      Promise.all([1, 2].map(() => webhooksApi.createRecord(toWebhookPayload(buildWebhook())))));
    for (const webhook of [first, second])
      cleanup.add(`webhook ${webhook.url}`, () => webhooksApi.deleteIfExists(webhook.id));

    const secrets = await test.step('GET each signing secret', () =>
      Promise.all(
        [first, second].map(async (webhook) => {
          const response = await webhooksApi.signingSecret(webhook.id);
          expect(response.status()).toBe(200);
          return (await response.json()).data.key as string;
        }),
      ));

    await test.step('both start with whsec_ and they differ', () => {
      // Check without printing the values: they are real credentials.
      expect(
        secrets.every((secret) => secret.startsWith('whsec_')),
        'secrets should start with whsec_',
      ).toBe(true);
      expect(secrets[0] !== secrets[1], 'each webhook should have its own secret').toBe(true);
    });
  });

  test('should delete a webhook so it leaves the list', async ({ webhooksApi, cleanup }) => {
    const created = await test.step('create a webhook', () =>
      webhooksApi.createRecord(toWebhookPayload(buildWebhook())));
    cleanup.add(`webhook ${created.url}`, () => webhooksApi.deleteIfExists(created.id));

    const response = await test.step('DELETE it', () => webhooksApi.delete(created.id));

    await test.step('responds 204, and the list no longer contains it', async () => {
      expect(response.status()).toBe(204);
      expect(await webhooksApi.findRecord(created.id)).toBeUndefined();
    });
  });

  for (const [description, url] of [
    ['no URL', undefined],
    ['a URL that is not a web address', 'not-a-url'],
  ] as const) {
    test(`should reject a webhook with ${description} with 422`, async ({ webhooksApi, cleanup }) => {
      const response = await test.step(`POST a webhook with ${description}`, () =>
        webhooksApi.create({ url, filterTypes: [WEBHOOK_EVENT] }));
      const body = await response.json();
      if (body.data?.id) cleanup.add('webhook', () => webhooksApi.deleteIfExists(body.data.id));

      await test.step('responds 422 saying the URL must be a web address', () => {
        expect(response.status()).toBe(422);
        expect(body.message).toEqual({ url: 'url must be a URL address' });
      });
    });
  }

  test('should reject an unknown event with 422', async ({ webhooksApi, cleanup }) => {
    knownBug('webhook-unknown-event-500');
    const response = await test.step('POST a webhook for "contact.deleted"', () =>
      webhooksApi.create({ ...toWebhookPayload(buildWebhook()), filterTypes: ['contact.deleted'] }));
    const body = await response.json();
    if (body.data?.id) cleanup.add('webhook', () => webhooksApi.deleteIfExists(body.data.id));

    await test.step('responds 422', () => expect(response.status()).toBe(422));
  });

  test('should reject a request without a login token with 401', async ({
    request,
    webhooksApi,
    apiHeaders,
  }) => {
    const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

    const response = await test.step('GET the list without a login token', () =>
      request.get(`${env.apiUrl}${webhooksApi.path}`, { headers: headersWithoutToken }));

    await test.step('responds 401', () => expect(response.status()).toBe(401));
  });
});
