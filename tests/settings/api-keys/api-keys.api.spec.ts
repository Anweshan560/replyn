import { test, expect } from '../../../fixtures/test';
import { describeSettingsTableApi } from '../settingsTableSuite';
import { API_KEYS } from '../settingsTables';
import { toApiKeyPayload } from '../../../api/DeveloperApi';
import { buildApiKey } from '../../../utils/testData';
import { knownBug } from '../../../utils/knownBug';

// The endpoint's create, list, get, update, delete, validation and auth; shared steps in settingsTableSuite.ts.
describeSettingsTableApi(API_KEYS);

test.describe('API Keys API: the key itself', { tag: API_KEYS.tags }, () => {
  test('should return a new secret key when a key is created', async ({ apiKeysApi, cleanup }) => {
    const response = await test.step('POST a new key', () =>
      apiKeysApi.create(toApiKeyPayload(buildApiKey())));
    const body = await response.json();
    if (body.data?.id) cleanup.add('API key', () => apiKeysApi.deleteIfExists(body.data.id));

    await test.step('responds 201 with an sk_ key, never used yet', () => {
      expect(response.status()).toBe(201);
      // Check the shape without printing the value: it is a real credential.
      expect(/^sk_\w{20,}$/.test(body.data.key), 'the key should be sk_ and a long random part').toBe(true);
      expect(body.data.lastUsedAt).toBeNull();
    });
  });

  test('should keep the key itself when the key is renamed', async ({ apiKeysApi, cleanup }) => {
    const created = await test.step('create a key', () =>
      apiKeysApi.createRecord(toApiKeyPayload(buildApiKey())));
    cleanup.add(`API key ${created.name}`, () => apiKeysApi.deleteIfExists(created.id));

    const response = await test.step('rename it', () =>
      apiKeysApi.update(created.id, toApiKeyPayload(buildApiKey())));

    await test.step('responds 200 with the same key as before', async () => {
      expect(response.status()).toBe(200);
      expect((await response.json()).data.key === created.key, 'renaming must not change the key').toBe(true);
    });
  });

  test('should not return the full key once it has been created', async ({ apiKeysApi, cleanup }) => {
    knownBug('api-keys-returned-in-full');
    const created = await test.step('create a key', () =>
      apiKeysApi.createRecord(toApiKeyPayload(buildApiKey())));
    cleanup.add(`API key ${created.name}`, () => apiKeysApi.deleteIfExists(created.id));

    const listed = await test.step('find it in the list', async () =>
      (await apiKeysApi.listRecords()).find((apiKey) => apiKey.id === created.id));

    await test.step('the list does not contain the secret key', () => {
      // Compare without printing either value: they are real credentials.
      expect(listed?.key === created.key, 'the list should not contain the full key').toBe(false);
    });
  });
});
