import { test, expect } from '../../../fixtures/test';
import { ENDPOINTS } from '../../../api/ResourceApi';
import { BILLING_TABS } from '../../../pages/clinic/BillingPage';
import { waitForApiResponse } from '../../../utils/network';
import { buildPatient } from '../../../utils/testData';
import { bookThroughApi, createDoctorAndTreatment } from '../bookingSetup';

const fullName = (patient: { firstName: string; lastName: string }) =>
  `${patient.firstName} ${patient.lastName}`;

/** 11:00 yesterday: a visit that has happened. */
function yesterday(): Date {
  const day = new Date();
  day.setDate(day.getDate() - 1);
  day.setHours(11, 0, 0, 0);
  return day;
}

/** "Nov 25, 2026", as Billing shows dates. */
function shortDate(day: Date): string {
  return day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Billing in EMR mode: QA Workspace is connected to ClinicSoft, so money is recorded in the EMR
 * and synced into Replyn. Each test books its own visit with its own doctor (through the API).
 */
test.describe('Clinic → Billing in EMR mode', { tag: ['@clinic', '@billing'] }, () => {
  test("should tell the user to record an attended visit's payment in the EMR, and refresh from it", async ({
    appointmentsPage,
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const visit =
      await test.step('book a visit yesterday and mark it attended (through the API)', async () => {
        const booked = await bookThroughApi(
          { appointmentsApi, contactsApi },
          cleanup,
          setup,
          buildPatient(),
          yesterday(),
        );
        expect((await appointmentsApi.update(booked.id, { status: 'completed' })).ok()).toBe(true);
        return booked;
      });
    await appointmentsPage.open(yesterday(), 'Day', setup.doctor.id);

    await appointmentsPage.openAppointment(setup.treatment.name);

    const panel = appointmentsPage.panel;
    await test.step("the panel shows the visit's EMR number and a Sync from the EMR button", async () => {
      const externalId = (await (await appointmentsApi.get(visit.id)).json()).data.externalId;
      expect(externalId, 'Replyn should have sent the visit to the EMR').toEqual(expect.any(String));
      await expect(panel.emrVisit).toHaveText(`Visit ${externalId}`);
      await expect(panel.syncFromEmrButton).toBeVisible();
    });
    await test.step('Payment says the EMR has nothing for the visit and to record it there', async () => {
      await expect(panel.paymentText('The visit is done, the EMR has nothing for it')).toBeVisible();
      await expect(panel.paymentText('Record the payment in the EMR, then refresh here.')).toBeVisible();
      await expect(panel.recordPaymentButton).toBeHidden();
    });
    await test.step('Refresh billing asks the EMR again, and the message stays', async () => {
      await panel.refreshBilling(visit.id);
      await expect(panel.paymentText('The visit is done, the EMR has nothing for it')).toBeVisible();
    });
  });

  test('should list an attended visit with no EMR invoice under Needs review as Not billed', async ({
    billingPage,
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const patient = buildPatient();
    await test.step('book a visit yesterday and mark it attended (through the API)', async () => {
      const booked = await bookThroughApi(
        { appointmentsApi, contactsApi },
        cleanup,
        setup,
        patient,
        yesterday(),
      );
      expect((await appointmentsApi.update(booked.id, { status: 'completed' })).ok()).toBe(true);
    });

    await billingPage.open('Needs review');

    await test.step('the patient has a "Not billed" row saying why', async () => {
      const row = billingPage.rowsFor(fullName(patient));
      await expect(row).toHaveCount(1);
      await expect(row.getByRole('gridcell').first()).toHaveText('Not billed');
      await expect(row).toContainText(
        `${setup.treatment.name} · ${setup.doctor.name} on ${shortDate(yesterday())} was completed, no invoice was recorded`,
      );
    });
  });

  test('should count each tab as the server does, and show EMR references in Documents', async ({
    page,
    billingPage,
  }) => {
    const patientsLoaded = waitForApiResponse(page, 'GET', `${ENDPOINTS.billing}/patients`);
    await billingPage.open('Owes money');
    const { counts } = (await (await patientsLoaded).json()).data.summary;

    await test.step('Owes money, Needs review, Credit on account and All patients show the counts', async () => {
      await expect(billingPage.tab('Owes money')).toHaveAccessibleName(`Owes money ${counts.owes}`);
      await expect(billingPage.tab('Needs review')).toHaveAccessibleName(`Needs review ${counts.review}`);
      await expect(billingPage.tab('Credit on account')).toHaveAccessibleName(
        `Credit on account ${counts.credit}`,
      );
      await expect(billingPage.tab('All patients')).toHaveAccessibleName(`All patients ${counts.all}`);
    });

    const ledgerLoaded = waitForApiResponse(page, 'GET', ENDPOINTS.billing);
    await billingPage.openTab('Documents');
    const firstFromEmr = (await (await ledgerLoaded).json()).data.result.find(
      (row: { source: string }) => row.source === 'crm',
    );
    test.skip(!firstFromEmr, 'No document synced from the EMR yet');

    await test.step("a synced document's row shows its EMR reference above Replyn's own code", async () => {
      await expect(page).toHaveURL((url) => url.searchParams.get('view') === BILLING_TABS.Documents);
      const reference = billingPage.grid.getByRole('gridcell', {
        name: `${firstFromEmr.externalCode} ${firstFromEmr.code}`,
      });
      await expect(reference.first()).toBeVisible();
    });
  });
});
