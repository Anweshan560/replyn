import { test, expect } from '../../../fixtures/test';
import { SLA_CLOCKS, defaultSlaClock, type SlaClock } from '../../../api/WorkspaceApi';
import { runOnlyOnItsOwn } from '../../exclusive';
import { env } from '../../../config/env';
import { knownBug } from '../../../utils/knownBug';

/** All six clocks off, except `changes` applied to First reply. */
function clocksWithFirstReply(changes: Partial<SlaClock>): SlaClock[] {
  return SLA_CLOCKS.map((clock) => ({
    ...defaultSlaClock(clock),
    ...(clock === 'first_reply' ? changes : {}),
  }));
}

// SLA clocks time real conversations, so these tests run on their own and put the clocks back.
test.describe('SLAs API', { tag: ['@settings', '@sla'] }, () => {
  runOnlyOnItsOwn();

  test.beforeEach(async ({ slasApi, cleanup }) => {
    cleanup.add('restore the SLA clocks', await slasApi.rememberCurrent());
  });

  for (const [value, unit, seconds] of [
    [30, 'minutes', 1_800],
    [4, 'hours', 14_400],
    [2, 'days', 172_800],
  ] as const) {
    test(`should store a ${value} ${unit} target as ${seconds} seconds`, async ({ slasApi }) => {
      const response = await test.step(`PUT the clocks with First reply on, ${value} ${unit}`, () =>
        slasApi.save(clocksWithFirstReply({ enabled: true, durationValue: value, durationUnit: unit })));

      await test.step(`responds 200, and First reply is on with ${seconds} seconds`, async () => {
        expect(response.status()).toBe(200);
        expect((await slasApi.clocks()).find((clock) => clock.clock === 'first_reply')).toMatchObject({
          enabled: true,
          durationValue: value,
          durationUnit: unit,
          durationSeconds: seconds,
        });
      });
    });
  }

  test('should store all six clocks in one request', async ({ slasApi }) => {
    const response = await test.step('PUT all six clocks', () => slasApi.save(clocksWithFirstReply({})));

    await test.step('responds 200 with one record per clock', async () => {
      expect(response.status()).toBe(200);
      expect((await slasApi.clocks()).map((clock) => clock.clock).sort()).toEqual([...SLA_CLOCKS].sort());
    });
  });

  test('should store who is reminded and when', async ({ slasApi }) => {
    const reminder = { notifyOnReminder: true, reminderPercent: 50, reminderAudience: 'assignee' };

    const response = await test.step('PUT First reply with a reminder at 50% of the time', () =>
      slasApi.save(clocksWithFirstReply({ enabled: true, ...reminder })));

    await test.step('responds 200 and stores the reminder', async () => {
      expect(response.status()).toBe(200);
      expect((await slasApi.clocks()).find((clock) => clock.clock === 'first_reply')).toMatchObject(reminder);
    });
  });

  test('should reject an empty list of clocks with a clear 422', async ({ slasApi }) => {
    knownBug('misleading-required-field-messages');
    const response = await test.step('PUT an empty list', () => slasApi.save([]));

    await test.step('responds 422 saying clocks are required', async () => {
      expect(response.status()).toBe(422);
      expect(JSON.stringify((await response.json()).message)).not.toContain('no more than 6');
    });
  });

  test('should reject a request without a login token with 401', async ({ request, slasApi, apiHeaders }) => {
    const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

    const response = await test.step('GET the clocks without a login token', () =>
      request.get(`${env.apiUrl}${slasApi.path}`, { headers: headersWithoutToken }));

    await test.step('responds 401', () => expect(response.status()).toBe(401));
  });
});
