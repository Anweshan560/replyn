/**
 * Clients for Clinic → Appointments and Clinic → Billing: booking appointments, recording what
 * happened at the visit (attendance, payment, outcome), and the money records that creates.
 */
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { ENDPOINTS, ResourceApi, type HeadersProvider } from './ResourceApi';
import { env } from '../config/env';
import { sendTimed } from '../utils/timing';
import type { PatientData } from '../utils/testData';

// --- Appointments -----------------------------------------------------------------------------

/**
 * The statuses: what the status button shows, and what the API stores.
 * "Attended" is stored as "completed".
 */
export const APPOINTMENT_STATUSES = {
  Unconfirmed: 'pending',
  Confirmed: 'confirmed',
  Attended: 'completed',
  Cancelled: 'cancelled',
  'No show': 'no_show',
} as const;

export type AppointmentStatusLabel = keyof typeof APPOINTMENT_STATUSES;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[AppointmentStatusLabel];

/** One patient on an appointment. A new patient (no contactId) becomes a new contact. */
export type AppointmentPatient = PatientData & { contactId?: string };

/** Request body for POST /v1/clinics/appointments, as the New appointment dialog sends it. */
export type AppointmentPayload = {
  doctorId?: string;
  treatmentId?: string;
  /** An existing contact; leave out to book a new patient. */
  contactId?: string;
  patients?: AppointmentPatient[];
  /** ISO 8601. */
  startDate?: string;
  endDate?: string;
  status?: AppointmentStatus;
  notes?: string;
  bookingType?: 'service';
  /** The dialog's "Chargeable" switch. */
  isPaid?: boolean;
};

/** An appointment as the API returns it (only the fields the tests use). */
export type Appointment = {
  id: string;
  doctorId: string;
  treatmentId: string;
  /** The patient's contact, created by the booking when the patient was new. */
  contactId: string;
  startDate: string;
  endDate: string;
  status: AppointmentStatus;
  notes: string | null;
  /** The optional reason given when the appointment was cancelled. */
  cancellationReason: string | null;
  bookingType: string;
  isPaid: boolean;
  /** What came of the visit, e.g. "all_done", once recorded. */
  outcome: string | null;
  /** What was paid for the visit, e.g. "250.00", once recorded. */
  value: string | null;
  patients: PatientData[];
};

/** Filters of GET /v1/clinics/appointments, as the calendar and the contact panel use them. */
export type AppointmentFilters = {
  /** Comma-separated ids. */
  doctorIds?: string;
  contactId?: string;
  startDate?: string;
  endDate?: string;
  /** Comma-separated statuses, as the status tabs send them. */
  statuses?: string;
  /** Comma-separated sources: user (Team), ai (Novy), crm (EMR). */
  bookedBy?: string;
};

/**
 * The Catch up queues: each lists past visits that still need something, a page at a time.
 * Values are "true", except crmStatus ("not-synced": visits the EMR has not received).
 */
export type AppointmentQueue =
  | { needsAnswer: 'true' }
  | { notRebooked: 'true' }
  | { missingDetails: 'true' }
  | { crmStatus: 'not-synced' };

/** One page of a Catch up queue. */
export type AppointmentPage = {
  result: (Appointment & { needsAnswer: boolean; needsRebook?: boolean })[];
  meta: { count: number; currentPage: number; nextPage: number | null; previousPage: number | null };
};

/** GET /v1/clinics/appointments/blocked-counts: the numbers on the Catch up queues. */
export type QueueCounts = {
  needsAnswer: number;
  missingDetails: number;
  crmPushFailed: number;
  notRebooked: number;
  sessionsToBook: number;
};

/**
 * Request body for POST /v1/clinics/appointments/<id>/outcome: the "Record the payment" steps.
 * Saving it with a payment creates an invoice and a receipt for the visit.
 */
export type AppointmentOutcome = {
  attendance?: 'showed_up' | 'no_show';
  isPaid?: boolean;
  payment?: { amount: number };
  /** The last step for an attended visit, e.g. "all_done" ("All done"). */
  consultationAnswer?:
    | 'booked_service'
    | 'still_deciding'
    | 'nothing_booked'
    | 'not_interested'
    | 'stopped_responding'
    | 'all_done';
  /** Required for a no-show: what happens next. */
  noShowNext?: 'wont_come' | 'rescheduled' | 'will_tell_later';
};

export class AppointmentsApi extends ResourceApi<AppointmentPayload, Appointment> {
  constructor(request: APIRequestContext, headers: HeadersProvider) {
    super(request, headers, ENDPOINTS.appointments);
  }

  /** GET the appointments matching `filters`. */
  async listWhere(filters: AppointmentFilters): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request.get(this.url(), { headers, params: filters }));
  }

  /** The appointments matching `filters`, for test checks. */
  async listRecordsWhere(filters: AppointmentFilters): Promise<Appointment[]> {
    const response = await this.listWhere(filters);
    if (!response.ok()) throw new Error(`GET ${this.path} returned ${response.status()}`);
    return (await response.json()).data;
  }

  /** GET one page of a Catch up queue, optionally narrowed (e.g. to a doctor) by `filters`. */
  async queue(
    queue: AppointmentQueue,
    { page = 1, limit = 25, ...filters }: AppointmentFilters & { page?: number; limit?: number } = {},
  ): Promise<APIResponse> {
    const headers = await this.headers();
    const params = { ...queue, ...filters, paginated: 'true', page, limit };
    return sendTimed(() => this.request.get(this.url(), { headers, params }));
  }

  async queueRecords(
    queue: AppointmentQueue,
    options: AppointmentFilters & { page?: number; limit?: number } = {},
  ): Promise<AppointmentPage> {
    const response = await this.queue(queue, options);
    if (!response.ok()) throw new Error(`GET ${this.path} queue returned ${response.status()}`);
    return (await response.json()).data;
  }

  /** GET the counts shown on the Catch up queues. */
  async queueCounts(): Promise<QueueCounts> {
    const headers = await this.headers();
    const response = await sendTimed(() => this.request.get(this.url('blocked-counts'), { headers }));
    if (!response.ok()) throw new Error(`GET blocked-counts returned ${response.status()}`);
    return (await response.json()).data;
  }

  /** Record what happened at the visit. */
  async recordOutcome(id: string, outcome: AppointmentOutcome): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request.post(this.url(`${id}/outcome`), { headers, data: outcome }));
  }
}

/** The appointment body for `patient` with `doctorId` and `treatmentId`, from `start` for `minutes`. */
export function toAppointmentPayload(
  booking: { doctorId: string; treatmentId: string; patient: AppointmentPatient },
  start: Date,
  minutes = 30,
): AppointmentPayload {
  return {
    doctorId: booking.doctorId,
    treatmentId: booking.treatmentId,
    // Only for an existing contact; a new patient gets a contact made by the booking.
    ...(booking.patient.contactId ? { contactId: booking.patient.contactId } : {}),
    patients: [booking.patient],
    startDate: start.toISOString(),
    endDate: new Date(start.getTime() + minutes * 60_000).toISOString(),
    status: 'pending',
    bookingType: 'service',
    isPaid: true,
  };
}

// --- Billing ----------------------------------------------------------------------------------

/** An invoice, receipt or advance as a patient's billing lists it. */
export type BillingDocument = {
  id: string;
  code: string;
  appointmentId: string | null;
  contactId: string;
  status: string;
};

/** GET /v1/clinics/contacts/<id>/billing: one patient's money. Amounts are strings, e.g. "250.00". */
export type ContactBilling = {
  summary: {
    advances: string;
    direct: string;
    balance: string;
    invoiced: string;
    outstanding: string;
  };
  invoices: (BillingDocument & { total: string })[];
  receipts: (BillingDocument & { amount: string; invoiceId: string | null })[];
  advances: (BillingDocument & { amount: string; advanceDate: string; notes: string | null })[];
};

/** A row of the Documents tab (the billing ledger). */
export type LedgerRow = {
  id: string;
  kind: 'invoice' | 'receipt' | 'advance';
  code: string;
  contactId: string;
  contactName: string;
  appointmentId: string | null;
  amount: string;
  status: string;
};

/** Request body for POST /v1/clinics/contacts/<id>/advances. */
export type AdvancePayload = { amount?: number; advanceDate?: string; notes?: string };

/**
 * Billing has no delete of its own: a patient's invoices, receipts and advances go when their
 * contact is deleted. Tests clean up by deleting the contact.
 */
export class BillingApi {
  constructor(
    private readonly request: APIRequestContext,
    private readonly headers: HeadersProvider,
  ) {}

  /** GET one patient's billing summary and documents. */
  async contactBilling(contactId: string): Promise<APIResponse> {
    return this.get(`${ENDPOINTS.clinicContacts}/${contactId}/billing`);
  }

  async contactBillingRecord(contactId: string): Promise<ContactBilling> {
    const response = await this.contactBilling(contactId);
    if (!response.ok()) throw new Error(`GET billing of ${contactId} returned ${response.status()}`);
    return (await response.json()).data;
  }

  /** POST an advance (a deposit paid ahead of visits) for a patient. */
  async addAdvance(contactId: string, advance: AdvancePayload): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() =>
      this.request.post(`${env.apiUrl}${ENDPOINTS.clinicContacts}/${contactId}/advances`, {
        headers,
        data: advance,
      }),
    );
  }

  /** GET the ledger: every invoice, receipt and advance (the Documents tab). */
  async ledger(params: Record<string, string | number> = {}): Promise<APIResponse> {
    return this.get(ENDPOINTS.billing, params);
  }

  /** GET the patients list behind the Owes money, Credit on account and All patients tabs. */
  async patients(params: Record<string, string | number> = {}): Promise<APIResponse> {
    return this.get(`${ENDPOINTS.billing}/patients`, params);
  }

  /** GET the Needs review queue, e.g. attended visits with no invoice. */
  async reviewQueue(params: Record<string, string | number> = {}): Promise<APIResponse> {
    return this.get(`${ENDPOINTS.billing}/review`, params);
  }

  private async get(path: string, params: Record<string, string | number> = {}): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request.get(`${env.apiUrl}${path}`, { headers, params }));
  }
}
