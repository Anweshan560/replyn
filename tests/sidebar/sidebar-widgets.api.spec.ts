import { test, expect } from '../../fixtures/test';
import type { AvailabilityRecord, NotificationRecord } from '../../api/SidebarApi';
import { ENDPOINTS } from '../../api/ResourceApi';
import { env } from '../../config/env';

// Read only: marking notifications read or changing availability would change the shared
// account's real state.
test.describe('Sidebar widgets API', { tag: ['@sidebar'] }, () => {
  test('should list notifications newest first, no more than asked for', async ({ sidebarApi }) => {
    const response = await test.step('GET the feed, 5 at most', () => sidebarApi.notifications(5));
    await test.step('responds 200 with up to 5 complete notifications, newest first', async () => {
      expect(response.status()).toBe(200);
      const notifications: NotificationRecord[] = (await response.json()).data.result;
      expect(notifications.length).toBeLessThanOrEqual(5);
      for (const notification of notifications) {
        expect(notification).toMatchObject({
          id: expect.any(String),
          type: expect.any(String),
          title: expect.any(String),
          occurredAt: expect.any(String),
        });
      }
      const times = notifications.map((notification) => new Date(notification.occurredAt).getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });
  });

  test('should count as unread exactly the unread notifications in the feed', async ({ sidebarApi }) => {
    const count: number = (await (await sidebarApi.unreadCount()).json()).data.count;
    const feed = (await (await sidebarApi.notifications(100)).json()).data;
    test.skip(feed.meta?.nextPage, 'more than 100 notifications: the feed does not hold them all');

    const unread = (feed.result as NotificationRecord[]).filter(
      (notification) => notification.readAt === null,
    );
    expect(count, 'the number on the bell').toBe(unread.length);
  });

  test('should report the AI credit balance as a number', async ({ sidebarApi }) => {
    const response = await sidebarApi.creditBalance();
    expect(response.status()).toBe(200);
    const { balance, lowBalanceThreshold } = (await response.json()).data;
    expect(Number.isFinite(Number(balance)), `balance "${balance}"`).toBe(true);
    expect(Number(balance)).toBeGreaterThanOrEqual(0);
    expect(lowBalanceThreshold).toEqual(expect.any(Number));
  });

  test('should list the credit activity', async ({ sidebarApi }) => {
    const response = await sidebarApi.creditTransactions();
    expect(response.status()).toBe(200);
    expect(Array.isArray((await response.json()).data)).toBe(true);
  });

  test('should report whether each workspace member is online, including me', async ({ sidebarApi }) => {
    const me = (await (await sidebarApi.me()).json()).data;
    const response = await sidebarApi.availability();

    expect(response.status()).toBe(200);
    const members: AvailabilityRecord[] = (await response.json()).data;
    expect(members.map((member) => member.userId)).toContain(me.id);
    for (const member of members) expect(['online', 'offline', 'away', 'busy']).toContain(member.status);
  });

  for (const [name, path] of [
    ['notifications', ENDPOINTS.notificationsFeed],
    ['credit balance', `${ENDPOINTS.credits}/balance`],
    ['availability', ENDPOINTS.availability],
  ] as const) {
    test(`should reject the ${name} without a login token with 401`, async ({ request, apiHeaders }) => {
      const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();
      const response = await request.get(`${env.apiUrl}${path}`, { headers: headersWithoutToken });
      expect(response.status()).toBe(401);
    });
  }
});
