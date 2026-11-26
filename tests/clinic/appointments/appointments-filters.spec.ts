import { test, expect } from '../../../fixtures/test';
import { APPOINTMENT_STATUSES } from '../../../api/AppointmentsApi';
import { ENDPOINTS } from '../../../api/ResourceApi';
import { waitForListResponse } from '../../../utils/network';
import { buildPatient, nextClinicDay } from '../../../utils/testData';
import { bookThroughApi, createDoctorAndTreatment } from '../bookingSetup';

const fullName = (patient: { firstName: string; lastName: string }) =>
  `${patient.firstName} ${patient.lastName}`;

/**
 * The filters of Clinic → Appointments: status tabs, the Doctors list, "Booked by", "Hide doctors
 * with no bookings" and the Catch up queues. Each test books with its own doctors (through the
 * API) on a day ahead, so the list shows only its own appointments.
 */
test.describe('Clinic → Appointments filters', { tag: ['@clinic', '@appointments'] }, () => {
  test('should show only the chosen status, with a count on each tab', async ({
    page,
    appointmentsPage,
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const day = nextClinicDay(10, 0, 5);
    const unconfirmed = buildPatient();
    const confirmed = buildPatient();
    await test.step('book two appointments and confirm one (through the API)', async () => {
      await bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, unconfirmed, day);
      const later = new Date(day);
      later.setHours(11);
      const booked = await bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, confirmed, later);
      expect((await appointmentsApi.update(booked.id, { status: 'confirmed' })).ok()).toBe(true);
    });

    // The tabs count the whole day for every doctor (the page asks for it without doctorIds or
    // statuses), so other tests' bookings that day count too: read the numbers from that answer.
    const countsLoaded = waitForListResponse(page, ENDPOINTS.appointments, {
      doctorIds: null,
      statuses: null,
    });
    await appointmentsPage.openList(day, [setup.doctor.id]);
    const dayAppointments: { status: string }[] = (await (await countsLoaded).json()).data;

    await test.step("the tabs count the day's appointments by status", async () => {
      const count = (status?: string) =>
        dayAppointments.filter((appointment) => !status || appointment.status === status).length;
      await expect(appointmentsPage.statusTab('All')).toHaveAccessibleName(`All ${count()}`);
      for (const label of ['Unconfirmed', 'Confirmed'] as const) {
        const expected = count(APPOINTMENT_STATUSES[label]);
        expect(expected, `${label} should count this test's booking`).toBeGreaterThanOrEqual(1);
        await expect(appointmentsPage.statusTab(label)).toHaveAccessibleName(`${label} ${expected}`);
      }
    });
    await test.step('Confirmed shows only the confirmed patient and goes in the address', async () => {
      await appointmentsPage.filterByStatus('Confirmed');
      await expect(appointmentsPage.statusTab('Confirmed')).toHaveAttribute('aria-selected', 'true');
      await expect(appointmentsPage.listRow(fullName(confirmed))).toBeVisible();
      await expect(appointmentsPage.listRow(fullName(unconfirmed))).toHaveCount(0);
      await expect(page).toHaveURL(/[?&]status=confirmed/);
    });
    await test.step('Attended shows none', async () => {
      await appointmentsPage.filterByStatus('Attended');
      await expect(appointmentsPage.emptyListRow).toBeVisible();
    });
    await test.step('All shows both again', async () => {
      await appointmentsPage.filterByStatus('All');
      await expect(appointmentsPage.listRow(fullName(confirmed))).toBeVisible();
      await expect(appointmentsPage.listRow(fullName(unconfirmed))).toBeVisible();
    });
  });

  test('should hide and bring back a doctor by clicking them in the Doctors list', async ({
    page,
    appointmentsPage,
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const first = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const second = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const day = nextClinicDay(10, 0, 5);
    const firstPatient = buildPatient();
    const secondPatient = buildPatient();
    await test.step('book one appointment with each doctor (through the API)', async () => {
      await bookThroughApi({ appointmentsApi, contactsApi }, cleanup, first, firstPatient, day);
      await bookThroughApi({ appointmentsApi, contactsApi }, cleanup, second, secondPatient, day);
    });
    await appointmentsPage.openList(day, [first.doctor.id, second.doctor.id]);
    await test.step('both patients are listed, and each doctor shows a count of 1', async () => {
      await expect(appointmentsPage.listRow(fullName(firstPatient))).toBeVisible();
      await expect(appointmentsPage.listRow(fullName(secondPatient))).toBeVisible();
      await expect(appointmentsPage.doctorFilter(first.doctor.name)).toHaveAccessibleName(/ 1$/);
    });

    // Each doctor in the list is a toggle: clicking one that is shown hides them.
    await test.step('click the first doctor: their patient goes, only the second doctor stays in the address', async () => {
      await appointmentsPage.toggleDoctor(first.doctor.name, second.doctor.id);
      await expect(appointmentsPage.listRow(fullName(firstPatient))).toHaveCount(0);
      await expect(appointmentsPage.listRow(fullName(secondPatient))).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`[?&]doctor=${second.doctor.id}(&|$)`));
    });
    await test.step('click them again: their patient is back', async () => {
      await appointmentsPage.toggleDoctor(first.doctor.name, new RegExp(first.doctor.id));
      await expect(appointmentsPage.listRow(fullName(firstPatient))).toBeVisible();
      await expect(appointmentsPage.listRow(fullName(secondPatient))).toBeVisible();
    });
  });

  test('should hide appointments the team booked when Team is unticked in Booked by', async ({
    page,
    appointmentsPage,
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const day = nextClinicDay(10, 0, 5);
    const patient = buildPatient();
    await test.step('book an appointment as a team member (through the API)', () =>
      bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, patient, day));
    await appointmentsPage.openList(day, [setup.doctor.id]);
    await expect(appointmentsPage.listRow(fullName(patient))).toBeVisible();

    await appointmentsPage.hideBookedBy('Team', 'ai,crm');

    await test.step('the appointment is gone, and the choice goes in the address', async () => {
      await expect(appointmentsPage.emptyListRow).toBeVisible();
      await expect(appointmentsPage.listRow(fullName(patient))).toHaveCount(0);
      await expect(page).toHaveURL(/[?&]bookedBy=ai%2Ccrm/);
    });
  });

  test('should hide the calendar column of a doctor with no bookings when asked', async ({
    page,
    appointmentsPage,
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const busy = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const free = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const day = nextClinicDay(10, 0, 5);
    await test.step('book an appointment with only one of the two doctors (through the API)', () =>
      bookThroughApi({ appointmentsApi, contactsApi }, cleanup, busy, buildPatient(), day));
    await appointmentsPage.open(day, 'Day', `${busy.doctor.id},${free.doctor.id}`);
    await test.step('the calendar has a column for each doctor', async () => {
      await expect(appointmentsPage.doctorColumn(busy.doctor.name)).toBeVisible();
      await expect(appointmentsPage.doctorColumn(free.doctor.name)).toBeVisible();
    });

    await appointmentsPage.hideEmptyDoctors();

    await test.step("the free doctor's column goes; the busy doctor's stays", async () => {
      await expect(appointmentsPage.doctorColumn(free.doctor.name)).toHaveCount(0);
      await expect(appointmentsPage.doctorColumn(busy.doctor.name)).toBeVisible();
    });
  });

  test('should list a past visit with no result under Catch up → Needs an answer', async ({
    page,
    appointmentsPage,
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const patient = buildPatient();
    await test.step('book a visit for yesterday (through the API)', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(10, 0, 0, 0);
      return bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, patient, yesterday);
    });
    await appointmentsPage.open(nextClinicDay());

    await appointmentsPage.openCatchUpQueue('Needs an answer');

    await test.step('the queue goes in the address and finds the patient by name', async () => {
      await expect(page).toHaveURL(/[?&]queue=unresolved/);
      await appointmentsPage.queueSearchBox.fill(patient.lastName);
      await expect(appointmentsPage.listRow(fullName(patient))).toBeVisible();
      await expect(appointmentsPage.listGrid.getByRole('row')).toHaveCount(2); // header + the patient
    });
    await test.step('Back to the schedule leaves the queue', async () => {
      await page.getByRole('button', { name: 'Back to the schedule' }).click();
      await expect(page).not.toHaveURL(/[?&]queue=/);
    });
  });
});
