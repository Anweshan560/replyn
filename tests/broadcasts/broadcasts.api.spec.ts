import { test, expect } from '../../fixtures/test';
import { BROADCAST_STATUSES } from '../../api/BroadcastsApi';
import { ENDPOINTS } from '../../api/ResourceApi';
import { env } from '../../config/env';
import { knownBug } from '../../utils/knownBug';

// Read only: never create or send a broadcast. The one POST sends an incomplete body that must be
// refused; if the API ever accepts it, the test fails and says so (nothing can be sent: there is
// no channel, segment or template).
test.describe('Broadcasts API', { tag: ['@broadcasts'] }, () => {
  test('should list broadcasts a page at a time', async ({ broadcastsApi }) => {
    const response = await test.step('GET page 1, 10 per page (as the page asks)', () =>
      broadcastsApi.list());
    await test.step('responds 200 with a result list and its page info', async () => {
      expect(response.status()).toBe(200);
      const { result, meta } = (await response.json()).data;
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeLessThanOrEqual(10);
      expect(meta).toMatchObject({ count: expect.any(Number), currentPage: 1 });
      expect(meta.count).toBeGreaterThanOrEqual(result.length);
    });
  });

  for (const status of BROADCAST_STATUSES) {
    test(`should list only ${status} broadcasts when filtered by that status`, async ({ broadcastsApi }) => {
      const response = await test.step(`GET ?statuses=${status}`, () =>
        broadcastsApi.list({ statuses: status }));
      await test.step(`responds 200 and every broadcast listed is ${status}`, async () => {
        expect(response.status()).toBe(200);
        const { result } = (await response.json()).data;
        for (const broadcast of result) expect(broadcast.status).toBe(status);
      });
    });
  }

  test('should find nothing for a search that matches no broadcast', async ({ broadcastsApi }) => {
    const response = await broadcastsApi.list({ search: 'qa000000 no such broadcast' });
    expect(response.status()).toBe(200);
    expect((await response.json()).data).toMatchObject({ result: [], meta: { count: 0 } });
  });

  test('should answer 404 for a broadcast that does not exist', async ({ broadcastsApi }) => {
    const response = await broadcastsApi.get('00000000-0000-0000-0000-000000000000');
    expect(response.status()).toBe(404);
    expect((await response.json()).message).toBe('Broadcast not found');
  });

  test('should refuse a broadcast without a name, segment, channel or template', async ({
    broadcastsApi,
  }) => {
    const response = await test.step('POST an empty body', () => broadcastsApi.createInvalid({}));
    const body = await response.json();

    await test.step('responds 422 and creates nothing', async () => {
      expect(body.data?.id, 'the API created a broadcast from an empty body').toBeUndefined();
      expect(response.status()).toBe(422);
      expect(Object.keys(body.message)).toEqual(expect.arrayContaining(['name']));
    });
  });

  test('should report the same channel count as the channels it returns', async ({ channelsApi }) => {
    knownBug('channels-count-mismatch');
    const response = await test.step('GET /v1/channels (one page of up to 100)', () => channelsApi.list());
    await test.step('meta.count equals the number of channels returned', async () => {
      expect(response.status()).toBe(200);
      const { result, meta } = (await response.json()).data;
      expect(meta.nextPage).toBeNull();
      expect(meta.count).toBe(result.length);
    });
  });

  test('should list the segments a broadcast can target, all in this workspace', async ({
    segmentsApi,
    workspaceId,
  }) => {
    const segments = await segmentsApi.listRecords();
    expect(segments.length).toBeGreaterThan(0);
    for (const segment of segments as unknown as { name: string; workspaceId: string }[]) {
      expect(segment.workspaceId, segment.name).toBe(workspaceId);
    }
  });

  test('should reject a request without a login token with 401', async ({ request, apiHeaders }) => {
    const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

    const response = await test.step('GET the list without a login token', () =>
      request.get(`${env.apiUrl}${ENDPOINTS.broadcasts}`, { headers: headersWithoutToken }));
    await test.step('responds 401', () => expect(response.status()).toBe(401));
  });
});
