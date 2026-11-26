import { test, expect } from '../../../fixtures/test';
import type { AppointmentFilters } from '../../../api/AppointmentsApi';
import { buildPatient, nextClinicDay } from '../../../utils/testData';
import { bookThroughApi, createDoctorAndTreatment } from '../bookingSetup';

/** The whole of `day`, as the calendar asks for it. */
function wholeDay(day: Date): Pick<AppointmentFilters, 'startDate' | 'endDate'> {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

/** 10:00 yesterday: a visit that has happened, so it waits for its result. */
function yesterdayMorning(): Date {
  const day = new Date();
  day.setDate(day.getDate() - 1);
  day.setHours(10, 0, 0, 0);
  return day;
}

/**
 * The filters of GET /v1/clinics/appointments behind the Appointments page: the status tabs,
 * "Booked by", the Doctors list, and the Catch up queues.
 */
test.describe('Appointments filters API', { tag: ['@clinic', '@appointments'] }, () => {
  test('should list only the statuses asked for', async ({
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const day = nextClinicDay(10, 0, 4);
    const [unconfirmed, confirmed, cancelled] =
      await test.step('book three appointments, then confirm one and cancel one', async () => {
        const booked = [];
        for (const hour of [10, 11, 12]) {
          const start = new Date(day);
          start.setHours(hour);
          booked.push(
            await bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, buildPatient(), start),
          );
        }
        expect((await appointmentsApi.update(booked[1].id, { status: 'confirmed' })).ok()).toBe(true);
        expect((await appointmentsApi.update(booked[2].id, { status: 'cancelled' })).ok()).toBe(true);
        return booked;
      });
    const list = (statuses: string) =>
      appointmentsApi.listRecordsWhere({ doctorIds: setup.doctor.id, ...wholeDay(day), statuses });
    const ids = (records: { id: string }[]) => records.map((record) => record.id).sort();

    await test.step('statuses=confirmed lists only the confirmed one', async () => {
      expect(ids(await list('confirmed'))).toEqual([confirmed.id]);
    });
    await test.step('statuses=pending,cancelled lists the other two', async () => {
      expect(ids(await list('pending,cancelled'))).toEqual(ids([unconfirmed, cancelled]));
    });
    await test.step('statuses=completed,no_show lists none', async () => {
      expect(await list('completed,no_show')).toEqual([]);
    });
  });

  test('should list by who booked: user for the team, never ai or crm', async ({
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const day = nextClinicDay(10, 0, 4);
    const booked = await test.step('book an appointment as a team member (through the API)', () =>
      bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, buildPatient(), day));
    const list = (bookedBy: string) =>
      appointmentsApi.listRecordsWhere({ doctorIds: setup.doctor.id, ...wholeDay(day), bookedBy });

    await test.step('bookedBy=user lists it, marked as booked by "user"', async () => {
      const records = await list('user');
      expect(records.map((record) => record.id)).toEqual([booked.id]);
      expect(records[0]).toMatchObject({ bookedBy: 'user' });
    });
    await test.step('bookedBy=ai,crm leaves it out', async () => {
      expect(await list('ai,crm')).toEqual([]);
    });
  });

  test("should list only the chosen doctors' appointments", async ({
    appointmentsApi,
    contactsApi,
    doctorsApi,
    treatmentsApi,
    cleanup,
  }) => {
    const first = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const second = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
    const day = nextClinicDay(10, 0, 4);
    const [withFirst, withSecond] = await test.step('book one appointment with each doctor', async () => [
      await bookThroughApi({ appointmentsApi, contactsApi }, cleanup, first, buildPatient(), day),
      await bookThroughApi({ appointmentsApi, contactsApi }, cleanup, second, buildPatient(), day),
    ]);
    const list = async (doctorIds: string) =>
      (await appointmentsApi.listRecordsWhere({ doctorIds, ...wholeDay(day) }))
        .map((record) => record.id)
        .sort();

    await test.step('one doctor: only their appointment', async () => {
      expect(await list(first.doctor.id)).toEqual([withFirst.id]);
    });
    await test.step('both doctors: both appointments', async () => {
      expect(await list(`${first.doctor.id},${second.doctor.id}`)).toEqual(
        [withFirst.id, withSecond.id].sort(),
      );
    });
  });

  test.describe('Catch up queues', () => {
    test('should put a past visit with no result in Needs an answer, and leave out an upcoming one', async ({
      appointmentsApi,
      contactsApi,
      doctorsApi,
      treatmentsApi,
      cleanup,
    }) => {
      const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
      const [past, upcoming] = await test.step('book a visit yesterday and one next week', async () => [
        await bookThroughApi(
          { appointmentsApi, contactsApi },
          cleanup,
          setup,
          buildPatient(),
          yesterdayMorning(),
        ),
        await bookThroughApi(
          { appointmentsApi, contactsApi },
          cleanup,
          setup,
          buildPatient(),
          nextClinicDay(10, 0, 7),
        ),
      ]);

      const queue = await test.step("GET Needs an answer for the test's doctor", () =>
        appointmentsApi.queueRecords({ needsAnswer: 'true' }, { doctorIds: setup.doctor.id }));

      await test.step('lists only the past visit, flagged needsAnswer, with a count of 1', () => {
        expect(queue.result.map((record) => record.id)).toEqual([past.id]);
        expect(queue.result[0]).toMatchObject({ needsAnswer: true, answer: null });
        expect(queue.meta.count).toBe(1);
        expect(queue.result.map((record) => record.id)).not.toContain(upcoming.id);
      });
    });

    test('should list only matching visits in each queue', async ({ appointmentsApi }) => {
      const [needsAnswer, notRebooked, notSynced] =
        await test.step('GET the first page of three queues', () =>
          Promise.all([
            appointmentsApi.queueRecords({ needsAnswer: 'true' }),
            appointmentsApi.queueRecords({ notRebooked: 'true' }),
            appointmentsApi.queueRecords({ crmStatus: 'not-synced' }),
          ]));

      await test.step('Needs an answer: every visit is in the past and has no answer', () => {
        for (const visit of needsAnswer.result) {
          expect(visit, visit.id).toMatchObject({ needsAnswer: true, answer: null });
          expect(new Date(visit.startDate).getTime(), visit.id).toBeLessThan(Date.now());
        }
      });
      await test.step('Not rebooked: every visit was a no-show that still needs a new booking', () => {
        for (const visit of notRebooked.result) {
          expect(visit, visit.id).toMatchObject({ status: 'no_show', needsRebook: true });
        }
      });
      await test.step('Not in the EMR: no visit has an EMR id yet', () => {
        for (const visit of notSynced.result) {
          expect((visit as { externalId?: string | null }).externalId ?? null, visit.id).toBeNull();
        }
      });
    });

    test('should page a queue: at most `limit` visits, and a next page while more are left', async ({
      appointmentsApi,
      contactsApi,
      doctorsApi,
      treatmentsApi,
      cleanup,
    }) => {
      const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
      const booked = await test.step('book three visits yesterday', async () => {
        const visits = [];
        for (const hour of [9, 10, 11]) {
          const start = yesterdayMorning();
          start.setHours(hour);
          visits.push(
            await bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, buildPatient(), start),
          );
        }
        return visits;
      });
      const pageOf = (page: number) =>
        appointmentsApi.queueRecords({ needsAnswer: 'true' }, { doctorIds: setup.doctor.id, limit: 2, page });

      const [first, second] = await test.step('GET pages 1 and 2 with limit=2', () =>
        Promise.all([pageOf(1), pageOf(2)]));

      await test.step('page 1 has 2 visits and points to page 2; page 2 has the last one', () => {
        expect(first.result).toHaveLength(2);
        expect(first.meta).toMatchObject({ count: 3, currentPage: 1, nextPage: 2, previousPage: null });
        expect(second.result).toHaveLength(1);
        expect(second.meta).toMatchObject({ count: 3, currentPage: 2, nextPage: null, previousPage: 1 });
        const seen = [...first.result, ...second.result].map((visit) => visit.id).sort();
        expect(seen).toEqual(booked.map((visit) => visit.id).sort());
      });
    });

    test('should show the same numbers on the queues as each queue lists', async ({ appointmentsApi }) => {
      // Other tests book visits at the same time, so compare counts read together, and retry.
      await expect(async () => {
        const [counts, needsAnswer, notRebooked, missingDetails, notSynced] = await Promise.all([
          appointmentsApi.queueCounts(),
          appointmentsApi.queueRecords({ needsAnswer: 'true' }, { limit: 1 }),
          appointmentsApi.queueRecords({ notRebooked: 'true' }, { limit: 1 }),
          appointmentsApi.queueRecords({ missingDetails: 'true' }, { limit: 1 }),
          appointmentsApi.queueRecords({ crmStatus: 'not-synced' }, { limit: 1 }),
        ]);
        expect({
          needsAnswer: counts.needsAnswer,
          notRebooked: counts.notRebooked,
          missingDetails: counts.missingDetails,
          crmPushFailed: counts.crmPushFailed,
        }).toEqual({
          needsAnswer: needsAnswer.meta.count,
          notRebooked: notRebooked.meta.count,
          missingDetails: missingDetails.meta.count,
          crmPushFailed: notSynced.meta.count,
        });
      }).toPass({ timeout: 30_000 });
    });
  });

  test.describe('validation', () => {
    const day = wholeDay(nextClinicDay());
    for (const { name, filters, message } of [
      {
        name: 'an unknown status',
        filters: { statuses: 'maybe' },
        message: {
          statuses:
            'each value in statuses must be one of the following values: pending, confirmed, cancelled, completed, no_show',
        },
      },
      {
        name: 'an unknown booking source',
        filters: { bookedBy: 'robot' },
        message: { bookedBy: 'each value in bookedBy must be one of the following values: user, crm, ai' },
      },
      {
        name: 'a doctor id that is not a UUID',
        filters: { doctorIds: 'not-an-id' },
        message: { doctorIds: 'each value in doctorIds must be a UUID' },
      },
    ]) {
      test(`should reject ${name} with 422 saying what is allowed`, async ({ appointmentsApi }) => {
        const response = await test.step(`GET with ${JSON.stringify(filters)}`, () =>
          appointmentsApi.listWhere({ ...day, ...filters }));

        await test.step('responds 422 with the rule', async () => {
          expect(response.status()).toBe(422);
          expect((await response.json()).message).toEqual(message);
        });
      });
    }
  });
});
