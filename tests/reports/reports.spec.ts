import { test, expect } from '../../fixtures/test';
import { REPORTS } from '../../pages/reports/ReportsPage';

// Every report opens from the Reports home and loads without errors. What the numbers mean is
// checked with seeded data in reports/numbers (exclusive: other tests change the counts).
test.describe('Reports', { tag: ['@reports'] }, () => {
  test(
    'should open Reports from the sidebar with a link to every report',
    { tag: '@smoke' },
    async ({ reportsPage }) => {
      await test.step('go to Reports from the sidebar', () => reportsPage.openFromDashboard());
      await test.step(`the home links to all ${REPORTS.length} reports`, async () => {
        for (const report of REPORTS) {
          await expect(reportsPage.reportLink(report), `${report.group} → ${report.title}`).toBeVisible();
        }
      });
    },
  );

  test('should narrow the list when user searches for a report', async ({ reportsPage }) => {
    await test.step('go to Reports', () => reportsPage.openFromDashboard());
    await test.step('search for "follow"', () => reportsPage.searchBox.fill('follow'));
    await test.step('Follow-ups is still listed, Cash in is not', async () => {
      await expect(
        reportsPage.reportLink(REPORTS.find((r) => r.path === '/reports/follow-ups')!),
      ).toBeVisible();
      await expect(
        reportsPage.reportLink(REPORTS.find((r) => r.path === '/reports/collections/cash-in')!),
      ).toHaveCount(0);
    });
  });

  for (const report of REPORTS) {
    test(`should load ${report.group} → ${report.title} without errors`, async ({ page, reportsPage }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await test.step('go to Reports', () => reportsPage.openFromDashboard());
      const answers = await test.step(`open ${report.title}`, () => reportsPage.openReport(report));

      await test.step(`the page is "${report.heading}", with a date range`, async () => {
        await expect(reportsPage.heading).toHaveText(report.heading);
        await expect(reportsPage.dateRangeButton).toBeVisible();
      });
      await test.step('every report request succeeded, and the page shows no error', async () => {
        const failed = answers
          .filter((answer) => !answer.ok())
          .map((answer) => `${answer.status()} ${answer.url()}`);
        expect(failed, 'report requests that failed').toEqual([]);
        await expect(reportsPage.errorPage).toHaveCount(0);
        expect(pageErrors, 'errors thrown by the page').toEqual([]);
      });
    });
  }
});
