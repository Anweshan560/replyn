import { test, expect } from '../../../fixtures/test';
import { toContactPayload } from '../../../api/ContactsApi';
import { REPORTS } from '../../../pages/reports/ReportsPage';
import { runOnlyOnItsOwn } from '../../exclusive';
import { buildContact, buildPatient, buildPaymentAmount, toDateParam } from '../../../utils/testData';

// Each test reads a number on the page, adds known data, and checks the number moved by exactly
// that much. Pages show this week by default, which always includes now. Other tests add and
// remove contacts and payments, so these run on their own.
test.describe('Report and dashboard numbers', { tag: ['@reports', '@report-numbers'] }, () => {
  runOnlyOnItsOwn();

  test("should show a new contact on the dashboard's New leads tile", async ({
    dashboardPage,
    contactsApi,
    cleanup,
  }) => {
    await test.step('open the dashboard', () => dashboardPage.open());
    const before = await test.step('read New leads', () => dashboardPage.count('New leads'));

    await test.step('create a contact (through the API)', async () => {
      const contact = await contactsApi.createRecord(toContactPayload(buildContact()));
      cleanup.add(`contact ${contact.id}`, () => contactsApi.deleteIfExists(contact.id));
    });

    await test.step('after a reload, New leads is one higher', async () => {
      await expect
        .poll(async () => {
          await dashboardPage.open();
          return dashboardPage.count('New leads');
        })
        .toBe(before + 1);
    });
  });

  test("should show a new advance on the dashboard's New advances tile", async ({
    dashboardPage,
    billingApi,
    contactsApi,
    cleanup,
  }) => {
    const amount = buildPaymentAmount();
    await test.step('open the dashboard', () => dashboardPage.open());
    const before = await test.step('read New advances', () => dashboardPage.amount('New advances'));

    await test.step(`record an advance of ${amount} (through the API)`, async () => {
      const patient = await contactsApi.createRecord(buildPatient());
      cleanup.add(`patient ${patient.id}`, () => contactsApi.deleteIfExists(patient.id));
      expect(
        (await billingApi.addAdvance(patient.id, { amount, advanceDate: toDateParam(new Date()) })).status(),
      ).toBe(201);
    });

    await test.step(`after a reload, New advances is ${amount} higher`, async () => {
      await expect
        .poll(async () => {
          await dashboardPage.open();
          return dashboardPage.amount('New advances');
        })
        .toBe(before + amount);
    });
  });

  test('should count new contacts on the Contacts report', async ({
    page,
    reportsPage,
    contactsApi,
    cleanup,
  }) => {
    const contactsReport = REPORTS.find((report) => report.path === '/reports/contacts')!;
    const contactsAdded = page
      .getByRole('main')
      .getByRole('button', { name: / of \d+ total contacts$/ })
      .getByRole('heading');
    const readAdded = async () => Number(await contactsAdded.innerText());

    await test.step('open Reports → Contacts', async () => {
      await reportsPage.openFromDashboard();
      await reportsPage.openReport(contactsReport);
    });
    const before = await test.step('read Contacts added', readAdded);

    await test.step('create two contacts (through the API)', async () => {
      for (let i = 0; i < 2; i++) {
        const contact = await contactsApi.createRecord(toContactPayload(buildContact()));
        cleanup.add(`contact ${contact.id}`, () => contactsApi.deleteIfExists(contact.id));
      }
    });

    await test.step('after a reload, Contacts added is two higher', async () => {
      await expect
        .poll(async () => {
          await reportsPage.openFromDashboard();
          await reportsPage.openReport(contactsReport);
          return readAdded();
        })
        .toBe(before + 2);
    });
  });
});
