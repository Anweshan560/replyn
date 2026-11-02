import { test, expect } from '../../../fixtures/test';
import { APPOINTMENT_STATUSES, type AppointmentStatusLabel } from '../../../api/AppointmentsApi';
import { fullName } from '../../../api/ContactsApi';
import { ENDPOINTS } from '../../../api/ResourceApi';
import { recordApiCalls } from '../../../utils/network';
import { buildPatient, nextClinicDay, toDateParam } from '../../../utils/testData';
import { bookThroughApi, cleanupBooking, createDoctorAndTreatment } from '../bookingSetup';
import { knownBug } from '../../../utils/knownBug';

// Every test uses its own doctor and treatment, and books on the next weekday (the clinic is
// closed at weekends), so it never touches the real calendar.
test.describe('Clinic → Appointments', { tag: ['@clinic', '@appointments'] }, () => {
  test(
    'should open Appointments from the sidebar on today, with a column per doctor',
    { tag: '@smoke' },
    async ({ page, appointmentsPage, doctorsApi, treatmentsApi, cleanup }) => {
      const { doctor } = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
      // The heading's name is e.g. "Friday October 30 2026".
      const today = new Date()
        .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        .replace(/,/g, '');

      await test.step('click Clinic in the main sidebar', () => appointmentsPage.openFromSidebar());

      await test.step("the calendar shows today in Day view, with the new doctor's column", async () => {
        await expect(page).toHaveURL(/\/appointments/);
        // Check the heading's name: its visible text runs the words together ("FridayOctober 30").
        await expect(appointmentsPage.dateHeading).toHaveAccessibleName(today);
        await expect(appointmentsPage.doctorColumn(doctor.name)).toBeVisible();
        await expect(appointmentsPage.newAppointmentButton).toBeVisible();
      });
    },
  );

  test('should book a new patient when user fills in the New appointment dialog', async ({
    appointmentsPage,
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const patient = buildPatient();
    const day = nextClinicDay();
    const notes = `Booked by the test for ${fullName(patient)}`;
    const dialog = appointmentsPage.dialog;

    await test.step('open the calendar on the booking day and press New appointment', async () => {
      await appointmentsPage.open(day);
      await dialog.open();
    });
    const created =
      await test.step('fill in the patient, doctor, treatment, day and notes, and create', async () => {
        await dialog.fill({
          patient,
          doctor: setup.doctor.name,
          treatment: setup.treatment.name,
          day,
          notes,
        });
        return dialog.submit();
      });
    cleanupBooking({ appointmentsApi, contactsApi }, cleanup, created);

    await test.step('the dialog closes and the appointment shows on the calendar', async () => {
      await expect(dialog.root).toBeHidden();
      await expect(appointmentsPage.card(setup.treatment.name)).toBeVisible();
    });
    await test.step('the server stored it as unconfirmed, with every value', async () => {
      const stored = (await (await appointmentsApi.get(created.id)).json()).data;
      expect(stored).toMatchObject({
        doctorId: setup.doctor.id,
        treatmentId: setup.treatment.id,
        status: 'pending',
        notes,
        patients: [patient],
      });
      expect(new Date(stored.startDate).toDateString()).toBe(day.toDateString());
    });
    await test.step('the booking created a contact for the patient', async () => {
      const contact = (await (await contactsApi.get(created.contactId)).json()).data;
      expect(contact).toMatchObject(patient);
    });
  });

  test('should not book when the patient is left empty', async ({ page, appointmentsPage }) => {
    const createCalls = recordApiCalls(page, 'POST', ENDPOINTS.appointments);
    const dialog = appointmentsPage.dialog;

    await test.step('open New appointment and press Create without a patient', async () => {
      await appointmentsPage.open(nextClinicDay());
      await dialog.open();
      await dialog.createButton.click();
    });

    await test.step('first name, last name and phone each say they are required', async () => {
      for (const message of ['First name is required', 'Last name is required', 'Phone is required']) {
        await expect(dialog.error(message)).toBeVisible();
      }
      await expect(dialog.firstNameInput).toHaveAttribute('aria-invalid', 'true');
      await expect(dialog.root).toBeVisible();
    });
    await test.step('nothing is sent to the server', () => {
      expect(createCalls, 'no create-appointment request should be sent').toEqual([]);
    });
  });

  for (const button of ['Cancel', 'Close'] as const) {
    test(`should book nothing when user presses ${button}`, async ({ page, appointmentsPage }) => {
      const createCalls = recordApiCalls(page, 'POST', ENDPOINTS.appointments);
      const dialog = appointmentsPage.dialog;

      await test.step('open New appointment and type a patient', async () => {
        await appointmentsPage.open(nextClinicDay());
        await dialog.open();
        const patient = buildPatient();
        await dialog.firstNameInput.fill(patient.firstName);
        await dialog.lastNameInput.fill(patient.lastName);
      });
      await test.step(`press ${button}: the dialog closes`, async () => {
        await (button === 'Cancel' ? dialog.cancelButton : dialog.closeButton).click();
        await expect(dialog.root).toBeHidden();
      });
      await test.step('nothing was sent to the server', () => {
        expect(createCalls, 'no create-appointment request should be sent').toEqual([]);
      });
    });
  }

  test("should show the appointment's details in its panel", async ({
    appointmentsPage,
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const patient = buildPatient();
    const day = nextClinicDay();
    await test.step('book an appointment (through the API)', () =>
      bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, patient, day));

    await test.step('open the calendar on that day and click the appointment', async () => {
      await appointmentsPage.open(day);
      await appointmentsPage.openAppointment(setup.treatment.name);
    });

    await test.step('the panel shows the patient, phone, doctor, treatment and status', async () => {
      const panel = appointmentsPage.panel;
      await expect(panel.root.getByRole('button', { name: fullName(patient), exact: true })).toBeVisible();
      await expect(panel.root).toContainText(patient.phone);
      await expect(panel.root.getByRole('button', { name: /Doctor$/ })).toContainText(setup.doctor.name);
      await expect(panel.root.getByRole('button', { name: /Treatment$/ })).toContainText(
        setup.treatment.name,
      );
      await expect(panel.statusButton('Unconfirmed')).toBeVisible();
    });
  });

  for (const next of [
    'Confirmed',
    'Attended',
    'Cancelled',
    'No show',
  ] as const satisfies AppointmentStatusLabel[]) {
    test(`should save the status when user changes it to ${next}`, async ({
      appointmentsPage,
      appointmentsApi,
      contactsApi,
      doctorsApi,
      treatmentsApi,
      cleanup,
    }) => {
      const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
      const day = nextClinicDay();
      const appointment = await test.step('book an appointment (through the API)', () =>
        bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, buildPatient(), day));

      await test.step('open it on the calendar', async () => {
        await appointmentsPage.open(day);
        await appointmentsPage.openAppointment(setup.treatment.name);
      });
      // Cancelled asks to confirm, with an optional reason.
      const reason = next === 'Cancelled' ? 'Patient asked to move to next month' : undefined;
      await test.step(`change the status from Unconfirmed to ${next}`, () =>
        appointmentsPage.panel.changeStatus(appointment.id, 'Unconfirmed', next, reason));

      await test.step(`the server stored "${APPOINTMENT_STATUSES[next]}"`, async () => {
        const stored = (await (await appointmentsApi.get(appointment.id)).json()).data;
        expect(stored.status).toBe(APPOINTMENT_STATUSES[next]);
        if (reason) expect(stored.cancellationReason).toBe(reason);
      });
    });
  }

  test('should save the notes when user edits them', async ({
    appointmentsPage,
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const day = nextClinicDay();
    const patient = buildPatient();
    const appointment = await test.step('book an appointment (through the API)', () =>
      bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, patient, day));
    const notes = `Prefers a morning slot - ${fullName(patient)}`;

    await test.step('open it on the calendar', async () => {
      await appointmentsPage.open(day);
      await appointmentsPage.openAppointment(setup.treatment.name);
    });
    await test.step('type new notes and press Save', () =>
      appointmentsPage.panel.saveNotes(appointment.id, notes));

    await test.step('the server stored the notes, and they are shown after a reload', async () => {
      expect((await (await appointmentsApi.get(appointment.id)).json()).data.notes).toBe(notes);
      await appointmentsPage.open(day);
      await appointmentsPage.openAppointment(setup.treatment.name);
      await expect(appointmentsPage.panel.notesInput).toHaveValue(notes);
    });
  });

  test('should remove the appointment when user deletes it', async ({
    appointmentsPage,
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const day = nextClinicDay();
    const patient = buildPatient();
    const appointment = await test.step('book an appointment (through the API)', () =>
      bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, patient, day));

    await test.step('open it on the calendar', async () => {
      await appointmentsPage.open(day);
      await appointmentsPage.openAppointment(setup.treatment.name);
    });
    await test.step('More actions → Delete appointment, confirming the dialog names the patient', () =>
      appointmentsPage.panel.delete(appointment.id, fullName(patient)));

    await test.step('it is gone from the server, and from the calendar after a reload', async () => {
      expect((await appointmentsApi.get(appointment.id)).status()).toBe(404);
      // See the next test: the calendar only drops it on reload.
      await appointmentsPage.open(day);
      await expect(appointmentsPage.card(setup.treatment.name)).toBeHidden();
    });
  });

  test('should take a deleted appointment off the calendar straight away', async ({
    appointmentsPage,
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    knownBug('deleted-appointment-stays-on-calendar');
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const day = nextClinicDay();
    const patient = buildPatient();
    const appointment = await test.step('book an appointment (through the API)', () =>
      bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, patient, day));

    await test.step('open it on the calendar and delete it', async () => {
      await appointmentsPage.open(day);
      await appointmentsPage.openAppointment(setup.treatment.name);
      await appointmentsPage.panel.delete(appointment.id, fullName(patient));
    });
    await test.step('its card disappears without a reload', async () => {
      await expect(appointmentsPage.card(setup.treatment.name)).toBeHidden({ timeout: 5_000 });
    });
  });

  test('should show the appointment in Day, Week and Month views of its doctor', async ({
    page,
    appointmentsPage,
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const day = nextClinicDay();
    await test.step('book an appointment (through the API)', () =>
      bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, buildPatient(), day));

    await test.step('with every doctor shown, only Day view is offered', async () => {
      // The workspace always has its own "doct1" besides the test's doctor, so several are shown.
      await appointmentsPage.open(day);
      await expect(appointmentsPage.card(setup.treatment.name)).toBeVisible();
      await expect(appointmentsPage.viewButton('Week')).toBeHidden();
    });
    await test.step("showing only the test's doctor offers Day, Week and Month", async () => {
      await appointmentsPage.open(day, 'Day', setup.doctor.id);
      await expect(page).toHaveURL((url) => url.searchParams.get('doctor') === setup.doctor.id);
      for (const view of ['Day', 'Week', 'Month'] as const) {
        await expect(appointmentsPage.viewButton(view)).toBeVisible();
      }
      await expect(appointmentsPage.card(setup.treatment.name)).toBeVisible();
    });
    await test.step('Week view: the address has calendar=week and the appointment shows', async () => {
      await appointmentsPage.switchView('Week');
      await expect(page).toHaveURL((url) => url.searchParams.get('calendar') === 'week');
      await expect(appointmentsPage.dateHeading).toHaveAccessibleName(/^Week of /);
      await expect(appointmentsPage.card(setup.treatment.name)).toBeVisible();
    });
    await test.step('Month view: the address has calendar=month and the appointment shows', async () => {
      await appointmentsPage.switchView('Month');
      await expect(page).toHaveURL((url) => url.searchParams.get('calendar') === 'month');
      await expect(appointmentsPage.card(setup.treatment.name)).toBeVisible();
    });
    await test.step('Today brings the calendar back to today', async () => {
      await appointmentsPage.switchView('Day');
      await appointmentsPage.todayButton.click();
      await expect(page).toHaveURL((url) => url.searchParams.get('date') === toDateParam(new Date()));
    });
  });
});
