import { test, expect } from '../../../fixtures/test';
import { BILLING_TABS, type BillingTab } from '../../../pages/clinic/BillingPage';

// QA Workspace keeps its money in its EMR (see billing-emr.spec.ts); recording money through Replyn
// is tested in the workspace without an EMR (tests/clinic/no-emr/billing-no-emr.spec.ts).
test.describe('Clinic → Billing', { tag: ['@clinic', '@billing'] }, () => {
  test(
    'should open Billing from the Clinic menu, with a tab for each view',
    { tag: '@smoke' },
    async ({ page, billingPage }) => {
      await test.step('go to Clinic → Billing', () => billingPage.openFromSidebar());

      await test.step('the address is /clinics/billing and Owes money is selected', async () => {
        await expect(page).toHaveURL(/\/clinics\/billing/);
        await expect(billingPage.tab('Owes money')).toHaveAttribute('aria-selected', 'true');
      });
      for (const [tab, view] of Object.entries(BILLING_TABS) as [BillingTab, string][]) {
        await test.step(`${tab}: the address gets view=${view} and a grid is shown`, async () => {
          await billingPage.openTab(tab);
          await expect(page).toHaveURL((url) => url.searchParams.get('view') === view);
          await expect(billingPage.grid).toBeVisible();
        });
      }
    },
  );
});
