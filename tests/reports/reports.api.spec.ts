import { test, expect } from '../../fixtures/test';
import { aroundNow } from '../../api/ReportsApi';
import { env } from '../../config/env';
import { knownBug } from '../../utils/knownBug';

/** The endpoint behind each report's headline numbers, with any query it needs. */
const SUMMARIES: { report: string; params?: Record<string, string> }[] = [
  { report: 'conversations/summary' },
  { report: 'messages/summary' },
  { report: 'daily-tracker' },
  { report: 'daily-operations/summary' },
  { report: 'contacts/summary' },
  { report: 'leads/summary' },
  { report: 'leads/lost' },
  { report: 'campaigns/summary' },
  { report: 'broadcasts/summary' },
  { report: 'follow-ups/summary' },
  { report: 'appointments/summary', params: { basis: 'scheduled' } },
  { report: 'attendance/summary' },
  { report: 'doctors/collections' },
  { report: 'collections/summary' },
  { report: 'agents/team-workload', params: { agentRoleOnly: 'true' } },
  { report: 'dashboard/clinic' },
];

// Read-only: these tests never change data, so they run alongside everything else.
test.describe('Reports API', { tag: ['@reports'] }, () => {
  for (const { report, params } of SUMMARIES) {
    test(`should answer ${report} for a date range`, async ({ reportsApi }) => {
      const response = await test.step(`GET ${report} for the last and next day`, () =>
        reportsApi.get(report, aroundNow(), params));

      await test.step('responds 200 with data', async () => {
        expect(response.status()).toBe(200);
        expect((await response.json()).data).toBeDefined();
      });
    });
  }

  test('should count the contacts in a summary that adds up', async ({ reportsApi }) => {
    const summary = await test.step('GET the contacts summary', () =>
      reportsApi.contactsSummary(aroundNow()));

    await test.step('no count is negative, and new ones are never more than all of them', () => {
      expect(summary.total).toBeGreaterThanOrEqual(0);
      expect(summary.createdInRange).toBeGreaterThanOrEqual(0);
      expect(summary.createdInRange).toBeLessThanOrEqual(summary.total);
    });
  });

  test('should reject dates that are not dates with 422', async ({ reportsApi }) => {
    const response = await test.step('GET the contacts summary for startDate=nope, endDate=nope', async () =>
      reportsApi.get('contacts/summary', undefined, { startDate: 'nope', endDate: 'nope' }));

    await test.step('responds 422 naming both dates', async () => {
      expect(response.status()).toBe(422);
      expect((await response.json()).message).toEqual({
        startDate: 'startDate must be a valid ISO 8601 date string',
        endDate: 'endDate must be a valid ISO 8601 date string',
      });
    });
  });

  test('should reject a range that ends before it starts with 422', async ({ reportsApi }) => {
    knownBug('reports-range-end-before-start');
    const { start, end } = aroundNow();

    const response = await test.step('GET the contacts summary with start and end swapped', () =>
      reportsApi.get('contacts/summary', { start: end, end: start }));

    await test.step('responds 422', () => expect(response.status()).toBe(422));
  });

  test('should reject a request without a login token with 401', async ({ request, apiHeaders }) => {
    const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

    const response = await test.step('GET the contacts summary without a login token', () =>
      request.get(`${env.apiUrl}/v1/reports/contacts/summary`, { headers: headersWithoutToken }));

    await test.step('responds 401', () => expect(response.status()).toBe(401));
  });
});
