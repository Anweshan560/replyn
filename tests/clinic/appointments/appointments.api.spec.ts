import { test, expect } from '../../../fixtures/test';
import { toAppointmentPayload, type Appointment } from '../../../api/AppointmentsApi';
import { ENDPOINTS } from '../../../api/ResourceApi';
import { env } from '../../../config/env';
import { measureResponseTimes, median } from '../../../utils/timing';
import { buildPatient, nextClinicDay, nextClosedDay, toDateParam } from '../../../utils/testData';
import {
  bookThroughApi,
  cleanupBooking,
  cleanupStrayContacts,
  createDoctorAndTreatment,
} from '../bookingSetup';
import { knownBug } from '../../../utils/knownBug';

/** An id in the right format that no record has. */
const MISSING_ID = '00000000-0000-7000-8000-000000000000';

test.describe('Appointments API', { tag: ['@clinic', '@appointments'] }, () => {
  test('should book a new patient and return every field that was sent', async ({
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const patient = buildPatient();
    const payload = {
      ...toAppointmentPayload(
        { doctorId: setup.doctor.id, treatmentId: setup.treatment.id, patient },
        nextClinicDay(),
      ),
      notes: 'Booked by the API test',
    };

    const response = await test.step('POST a new appointment', () => appointmentsApi.create(payload));
    const body = await response.json();
    if (body.data?.id) cleanupBooking({ appointmentsApi, contactsApi }, cleanup, body.data);

    await test.step('responds 201 with every field, an id, and a contact for the patient', () => {
      expect(response.status()).toBe(201);
      const { startDate: _start, endDate: _end, ...fields } = payload;
      expect(body.data).toMatchObject({ ...fields, patients: [patient] });
      expect(new Date(body.data.startDate).getTime()).toBe(new Date(payload.startDate!).getTime());
      expect(body.data.id).toEqual(expect.any(String));
      expect(body.data.contactId).toEqual(expect.any(String));
    });
    await test.step("the patient's new contact has their name and phone", async () => {
      expect((await (await contactsApi.get(body.data.contactId)).json()).data).toMatchObject(patient);
    });
  });

  test('should book an existing contact without creating another', async ({
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const patient = buildPatient();
    const contact = await test.step('create the contact first', () => contactsApi.createRecord(patient));
    cleanup.add(`contact ${contact.id}`, () => contactsApi.deleteIfExists(contact.id));

    const appointment = await test.step('book them by contactId', () =>
      bookThroughApi(
        { appointmentsApi, contactsApi },
        cleanup,
        setup,
        { ...patient, contactId: contact.id },
        nextClinicDay(),
      ));

    await test.step('the appointment points at that contact, and no second contact was made', async () => {
      expect(appointment.contactId).toBe(contact.id);
      expect((await contactsApi.searchRecords({ search: patient.lastName })).meta.count).toBe(1);
    });
  });

  test('should return an appointment by its id', async ({
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const created = await test.step('book an appointment', () =>
      bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, buildPatient(), nextClinicDay()));

    const response = await test.step('GET it by id', () => appointmentsApi.get(created.id));

    await test.step('responds 200 with the same appointment', async () => {
      expect(response.status()).toBe(200);
      expect((await response.json()).data).toMatchObject({
        id: created.id,
        doctorId: setup.doctor.id,
        treatmentId: setup.treatment.id,
        contactId: created.contactId,
        startDate: created.startDate,
      });
    });
  });

  test('should filter the list by doctor, contact and dates', async ({
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const firstDay = nextClinicDay(10);
    // The next open day after the first one.
    const secondDay = new Date(firstDay);
    do secondDay.setDate(secondDay.getDate() + 1);
    while (secondDay.getDay() === 0 || secondDay.getDay() === 6);
    const [first, second] = await test.step('book two appointments on different days', async () => [
      await bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, buildPatient(), firstDay),
      await bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, buildPatient(), secondDay),
    ]);
    const ids = (appointments: Appointment[]) => appointments.map((appointment) => appointment.id).sort();

    await test.step('by doctor: exactly the two', async () => {
      expect(ids(await appointmentsApi.listRecordsWhere({ doctorIds: setup.doctor.id }))).toEqual(
        [first.id, second.id].sort(),
      );
    });
    await test.step('by contact: only that patient', async () => {
      expect(ids(await appointmentsApi.listRecordsWhere({ contactId: first.contactId }))).toEqual([first.id]);
    });
    await test.step('by dates: only the one on the first day', async () => {
      const dayStart = new Date(firstDay);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);
      const onFirstDay = await appointmentsApi.listRecordsWhere({
        doctorIds: setup.doctor.id,
        startDate: dayStart.toISOString(),
        endDate: dayEnd.toISOString(),
      });
      expect(ids(onFirstDay), `appointments of ${toDateParam(firstDay)}`).toEqual([first.id]);
    });
  });

  test('should update the status and notes', async ({
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const created = await test.step('book an appointment', () =>
      bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, buildPatient(), nextClinicDay()));
    const changes = { status: 'confirmed', notes: 'Confirmed by phone' } as const;

    const response = await test.step('PATCH the status and notes', () =>
      appointmentsApi.update(created.id, changes));

    await test.step('responds 200, and GET returns the new values', async () => {
      expect(response.status()).toBe(200);
      expect((await (await appointmentsApi.get(created.id)).json()).data).toMatchObject(changes);
    });
  });

  test('should reject an unknown status with 422 listing the allowed ones', async ({
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const created = await test.step('book an appointment', () =>
      bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, buildPatient(), nextClinicDay()));

    const response = await test.step('PATCH the status "maybe"', () =>
      appointmentsApi.update(created.id, { status: 'maybe' as never }));

    await test.step('responds 422 naming the allowed statuses, and the status is unchanged', async () => {
      expect(response.status()).toBe(422);
      expect((await response.json()).message).toEqual({
        status:
          'status must be one of the following values: pending, confirmed, cancelled, completed, no_show',
      });
      expect((await (await appointmentsApi.get(created.id)).json()).data.status).toBe('pending');
    });
  });

  test('should delete an appointment so it can no longer be found', async ({
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const created = await test.step('book an appointment', () =>
      bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, buildPatient(), nextClinicDay()));

    const response = await test.step('DELETE it', () => appointmentsApi.delete(created.id));

    await test.step('responds 200', () => expect(response.status()).toBe(200));
    await test.step('GET by id now responds 404 "Appointment not found"', async () => {
      const getAfterDelete = await appointmentsApi.get(created.id);
      expect(getAfterDelete.status()).toBe(404);
      expect((await getAfterDelete.json()).message).toBe('Appointment not found');
    });
    await test.step("the doctor's list no longer contains it", async () => {
      expect(await appointmentsApi.listRecordsWhere({ doctorIds: setup.doctor.id })).toEqual([]);
    });
  });

  test('should answer 404 "Appointment not found" for an unknown id', async ({ appointmentsApi }) => {
    const response = await appointmentsApi.get(MISSING_ID);

    expect(response.status()).toBe(404);
    expect((await response.json()).message).toBe('Appointment not found');
  });

  test.describe('validation', () => {
    test('should reject an empty booking with 422 naming the required fields', async ({
      appointmentsApi,
    }) => {
      const response = await appointmentsApi.create({});

      expect(response.status()).toBe(422);
      expect((await response.json()).message).toEqual({
        doctorId: 'doctorId must be a UUID',
        startDate: 'startDate must be a valid ISO 8601 date string',
        endDate: 'endDate must be a valid ISO 8601 date string',
        patients: 'patients must be an array',
      });
    });

    test('should reject a patient without last name and phone with 422', async ({
      appointmentsApi,
      doctorsApi,
      treatmentsApi,
      cleanup,
    }) => {
      const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
      const payload = toAppointmentPayload(
        { doctorId: setup.doctor.id, treatmentId: setup.treatment.id, patient: buildPatient() },
        nextClinicDay(),
      );

      const response = await appointmentsApi.create({
        ...payload,
        patients: [{ firstName: 'Only' } as never],
      });

      expect(response.status()).toBe(422);
      expect((await response.json()).message).toEqual({
        'patients.0.lastName': 'lastName must be a string',
        'patients.0.phone': 'phone must be a string',
      });
    });

    test('should reject an end time before the start with 400', async ({
      appointmentsApi,
      contactsApi,
      doctorsApi,
      treatmentsApi,
      cleanup,
    }) => {
      const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
      const patient = buildPatient();
      cleanupStrayContacts(contactsApi, cleanup, patient);
      const start = nextClinicDay();
      const payload = toAppointmentPayload(
        { doctorId: setup.doctor.id, treatmentId: setup.treatment.id, patient },
        start,
        -30,
      );

      const response = await appointmentsApi.create(payload);

      expect(response.status()).toBe(400);
      expect((await response.json()).message).toBe('startDate must be before endDate');
    });

    test('should reject an unknown doctor with 404 "Doctor not found"', async ({
      appointmentsApi,
      contactsApi,
      doctorsApi,
      treatmentsApi,
      cleanup,
    }) => {
      const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
      const patient = buildPatient();
      cleanupStrayContacts(contactsApi, cleanup, patient);
      const payload = toAppointmentPayload(
        { doctorId: MISSING_ID, treatmentId: setup.treatment.id, patient },
        nextClinicDay(),
      );

      const response = await appointmentsApi.create(payload);

      expect(response.status()).toBe(404);
      expect((await response.json()).message).toBe('Doctor not found');
    });

    test('should reject a booking on a day the clinic is closed with 400', async ({
      appointmentsApi,
      contactsApi,
      doctorsApi,
      treatmentsApi,
      cleanup,
    }) => {
      const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
      const patient = buildPatient();
      cleanupStrayContacts(contactsApi, cleanup, patient);
      const payload = toAppointmentPayload(
        { doctorId: setup.doctor.id, treatmentId: setup.treatment.id, patient },
        nextClosedDay(),
      );

      const response = await appointmentsApi.create(payload);

      expect(response.status()).toBe(400);
      expect((await response.json()).message).toBe('Clinic is closed on this day');
    });

    test('should not leave a contact behind when a booking is rejected', async ({
      appointmentsApi,
      contactsApi,
      doctorsApi,
      treatmentsApi,
      cleanup,
    }) => {
      knownBug('rejected-booking-creates-contact');
      const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
      const patient = buildPatient();
      const payload = toAppointmentPayload(
        { doctorId: MISSING_ID, treatmentId: setup.treatment.id, patient },
        nextClinicDay(),
      );

      const response = await test.step('book with an unknown doctor', () => appointmentsApi.create(payload));
      const leftover = await contactsApi.searchRecords({ search: patient.lastName });
      for (const contact of leftover.result) {
        cleanup.add(`contact ${contact.id} left by the rejected booking`, () =>
          contactsApi.deleteIfExists(contact.id),
        );
      }

      await test.step('the booking is rejected, and no contact was created', () => {
        expect(response.status()).toBe(404);
        expect(leftover.meta.count).toBe(0);
      });
    });

    test("should reject a treatment the doctor doesn't offer", async ({
      appointmentsApi,
      contactsApi,
      doctorsApi,
      treatmentsApi,
      cleanup,
    }) => {
      knownBug('booking-accepts-treatment-of-other-doctor');
      const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
      const other = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
      const payload = toAppointmentPayload(
        { doctorId: setup.doctor.id, treatmentId: other.treatment.id, patient: buildPatient() },
        nextClinicDay(),
      );

      const response = await appointmentsApi.create(payload);
      const body = await response.json();
      if (body.data?.id) cleanupBooking({ appointmentsApi, contactsApi }, cleanup, body.data);

      expect(response.status()).toBeGreaterThanOrEqual(400);
    });
  });

  test.describe('recording the visit', () => {
    test('should mark the visit attended and paid, creating an invoice and a receipt', async ({
      appointmentsApi,
      billingApi,
      contactsApi,
      doctorsApi,
      treatmentsApi,
      cleanup,
    }) => {
      const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
      const created = await test.step('book an appointment', () =>
        bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, buildPatient(), nextClinicDay()));

      const response = await test.step('POST the outcome: showed up, paid AED 250, all done', () =>
        appointmentsApi.recordOutcome(created.id, {
          attendance: 'showed_up',
          isPaid: true,
          payment: { amount: 250 },
          consultationAnswer: 'all_done',
        }));

      await test.step('responds 201: attended, worth AED 250, outcome "all_done"', async () => {
        expect(response.status()).toBe(201);
        expect((await response.json()).data).toMatchObject({
          status: 'completed',
          value: '250.00',
          outcome: 'all_done',
        });
      });
      await test.step("the patient's billing has a paid invoice and a cleared receipt for the visit", async () => {
        const billing = await billingApi.contactBillingRecord(created.contactId);
        expect(billing.invoices).toEqual([
          expect.objectContaining({ appointmentId: created.id, total: '250.00', status: 'paid' }),
        ]);
        expect(billing.receipts).toEqual([
          expect.objectContaining({ appointmentId: created.id, amount: '250.00', status: 'cleared' }),
        ]);
        expect(billing.summary).toMatchObject({ invoiced: '250.00', direct: '250.00', outstanding: '0.00' });
      });
    });

    test('should mark a no-show, which needs to say what happens next', async ({
      appointmentsApi,
      contactsApi,
      doctorsApi,
      treatmentsApi,
      cleanup,
    }) => {
      const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
      const created = await test.step('book an appointment', () =>
        bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, buildPatient(), nextClinicDay()));

      await test.step('without noShowNext: 400 "A no-show needs a noShowNext"', async () => {
        const response = await appointmentsApi.recordOutcome(created.id, { attendance: 'no_show' });
        expect(response.status()).toBe(400);
        expect((await response.json()).message).toBe('A no-show needs a noShowNext');
      });
      // "wont_come" needs nothing more; "rescheduled" needs new dates, "will_tell_later" a deadline.
      await test.step('with noShowNext "wont_come": 201 and the status is no_show', async () => {
        const response = await appointmentsApi.recordOutcome(created.id, {
          attendance: 'no_show',
          noShowNext: 'wont_come',
        });
        expect(response.status()).toBe(201);
        expect((await response.json()).data.status).toBe('no_show');
      });
    });

    test('should reject an unknown attendance with 422', async ({
      appointmentsApi,
      contactsApi,
      doctorsApi,
      treatmentsApi,
      cleanup,
    }) => {
      const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
      const created = await test.step('book an appointment', () =>
        bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, buildPatient(), nextClinicDay()));

      const response = await appointmentsApi.recordOutcome(created.id, { attendance: 'late' as never });

      expect(response.status()).toBe(422);
      expect((await response.json()).message).toEqual({
        attendance: 'attendance must be one of the following values: showed_up, no_show',
      });
    });
  });

  test('should reject requests without a login token with 401', async ({ request, apiHeaders }) => {
    const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

    await test.step('list without a token responds 401', async () => {
      const response = await request.get(`${env.apiUrl}${ENDPOINTS.appointments}`, {
        headers: headersWithoutToken,
      });
      expect(response.status()).toBe(401);
    });
    await test.step('book without a token responds 401', async () => {
      const response = await request.post(`${env.apiUrl}${ENDPOINTS.appointments}`, {
        headers: headersWithoutToken,
        data: {},
      });
      expect(response.status()).toBe(401);
    });
  });

  test('should answer list requests within the response-time budget', async ({ appointmentsApi }) => {
    const durations = await test.step('GET the list 5 times in a row', () =>
      measureResponseTimes(() => appointmentsApi.list(), 5));

    await test.step(`the median response time is under ${env.apiResponseBudgetMs} ms`, () => {
      expect(median(durations), `response times (ms): ${durations.join(', ')}`).toBeLessThan(
        env.apiResponseBudgetMs,
      );
    });
  });
});
