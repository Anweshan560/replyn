/**
 * Setup shared by the Appointments and Billing tests. Every test books with its own doctor and
 * treatment (unique names), so its appointments are easy to find and never clash with other tests
 * or the workspace's real calendar.
 */
import { test, expect } from '../../fixtures/test';
import type { Cleanup } from '../../fixtures/test';
import {
  toAppointmentPayload,
  type Appointment,
  type AppointmentPatient,
  type AppointmentsApi,
} from '../../api/AppointmentsApi';
import type { ContactsApi } from '../../api/ContactsApi';
import { toDoctorPayload, type Doctor, type DoctorsApi } from '../../api/DoctorsApi';
import { toTreatmentPayload, type Treatment, type TreatmentsApi } from '../../api/TreatmentsApi';
import { buildDoctor, buildTreatment } from '../../utils/testData';

export type DoctorAndTreatment = { doctor: Doctor; treatment: Treatment };

/** Create a treatment and a doctor who offers it (through the API), deleted after the test. */
export async function createDoctorAndTreatment(
  apis: { doctorsApi: DoctorsApi; treatmentsApi: TreatmentsApi },
  cleanup: Cleanup,
): Promise<DoctorAndTreatment> {
  return test.step('create a doctor and a treatment they offer (through the API)', async () => {
    const treatment = await apis.treatmentsApi.createRecord(toTreatmentPayload(buildTreatment()));
    cleanup.add(`treatment "${treatment.name}"`, () => apis.treatmentsApi.deleteIfExists(treatment.id));
    const doctor = await apis.doctorsApi.createRecord({
      ...toDoctorPayload(buildDoctor()),
      treatmentIds: [treatment.id],
    });
    cleanup.add(`doctor "${doctor.name}"`, () => apis.doctorsApi.deleteIfExists(doctor.id));
    return { doctor, treatment };
  });
}

/**
 * Remove an appointment and the contact its booking created for the patient. Deleting the contact
 * also removes the patient's invoices, receipts and advances (billing has no delete of its own).
 */
export function cleanupBooking(
  apis: { appointmentsApi: AppointmentsApi; contactsApi: ContactsApi },
  cleanup: Cleanup,
  appointment: Pick<Appointment, 'id' | 'contactId'>,
): void {
  cleanup.add(`appointment ${appointment.id} and its patient`, async () => {
    await apis.appointmentsApi.deleteIfExists(appointment.id);
    await apis.contactsApi.deleteIfExists(appointment.contactId);
  });
}

/** Book `patient` (new, or an existing contact) with the test's doctor and treatment at `start`. */
export async function bookThroughApi(
  apis: { appointmentsApi: AppointmentsApi; contactsApi: ContactsApi },
  cleanup: Cleanup,
  setup: DoctorAndTreatment,
  patient: AppointmentPatient,
  start: Date,
): Promise<Appointment> {
  const appointment = await apis.appointmentsApi.createRecord(
    toAppointmentPayload({ doctorId: setup.doctor.id, treatmentId: setup.treatment.id, patient }, start),
  );
  cleanupBooking(apis, cleanup, appointment);
  return appointment;
}

/**
 * After a booking the API should reject: delete any contact made for `patient` anyway. A rejected
 * booking still creates the new patient's contact (known API bug, see appointments.api.spec.ts).
 */
export function cleanupStrayContacts(
  contactsApi: ContactsApi,
  cleanup: Cleanup,
  patient: { lastName: string },
): void {
  cleanup.add(`contacts left by a rejected booking for "${patient.lastName}"`, async () => {
    const { result } = await contactsApi.searchRecords({ search: patient.lastName });
    for (const contact of result) await contactsApi.deleteIfExists(contact.id);
  });
}

/**
 * Wait until Replyn has sent the appointment to the workspace's EMR and stored the EMR's visit
 * number (externalId), which happens in the background after booking. Returns that number.
 */
export async function waitForEmrLink(
  appointmentsApi: AppointmentsApi,
  appointmentId: string,
): Promise<string> {
  return test.step('wait for the EMR to receive the visit', async () => {
    let externalId: string | null = null;
    await expect
      .poll(
        async () => {
          externalId = (await (await appointmentsApi.get(appointmentId)).json()).data.externalId;
          return externalId;
        },
        { timeout: 30_000, message: 'the EMR should get the visit' },
      )
      .toEqual(expect.any(String));
    return externalId!;
  });
}
