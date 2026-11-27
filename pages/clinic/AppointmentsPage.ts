import { expect, type Locator, type Page } from '@playwright/test';
import { ENDPOINTS } from '../../api/ResourceApi';
import {
  APPOINTMENT_STATUSES,
  type Appointment,
  type AppointmentStatusLabel,
} from '../../api/AppointmentsApi';
import { waitForApiResponse, waitForListResponse } from '../../utils/network';
import { toDateParam, type PatientData } from '../../utils/testData';

export type CalendarView = 'Day' | 'Week' | 'Month';

/**
 * The Catch up queues of the side panel, and the API flag each one lists by (all "true"). The
 * fourth queue, "Not in the EMR", lists by crmStatus=not-synced instead.
 */
export const CATCH_UP_QUEUES = {
  'Needs an answer': 'needsAnswer',
  'Not rebooked': 'notRebooked',
  'Missing details': 'missingDetails',
} as const;

export type CatchUpQueue = keyof typeof CATCH_UP_QUEUES;

/** The statuses the All tab asks for, in the order the page sends them. */
const ALL_STATUSES_PARAM = Object.values(APPOINTMENT_STATUSES).join(',');

/** What the New appointment dialog is filled with; leave a field out to keep its default. */
export type NewAppointment = {
  patient: PatientData;
  /** Doctor and treatment names, as their dropdowns list them. */
  doctor: string;
  treatment: string;
  /** The day to book; the dialog's default start time is kept. */
  day: Date;
  notes?: string;
};

/**
 * Clinic → Appointments: the calendar (one column per doctor), the New appointment dialog, and
 * the panel that opens on an appointment.
 */
export class AppointmentsPage {
  readonly main: Locator;
  readonly todayButton: Locator;
  /** The day shown, in the side panel, e.g. "Wednesday, 25 November". */
  readonly dateHeading: Locator;
  readonly newAppointmentButton: Locator;
  readonly dialog: NewAppointmentDialog;
  readonly panel: AppointmentPanel;

  constructor(private readonly page: Page) {
    this.main = page.getByRole('main');
    // Since the 2026-11-25 redesign the date controls live in the side panel, outside main.
    this.todayButton = page.getByRole('button', { name: 'Go to today' });
    this.dateHeading = page.getByRole('heading', { level: 5 }).first();
    this.newAppointmentButton = page.getByRole('button', { name: 'New appointment' });
    this.dialog = new NewAppointmentDialog(page);
    this.panel = new AppointmentPanel(page);
  }

  /** Go to Clinic from the main sidebar: it opens on Appointments. */
  async openFromSidebar(): Promise<void> {
    await this.page.goto('/dashboard');
    const loaded = waitForApiResponse(this.page, 'GET', ENDPOINTS.appointments);
    await this.page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Clinic' })
      .click();
    await expect(this.page).toHaveURL(/\/appointments/);
    expect((await loaded).ok(), 'the appointments should load').toBe(true);
    await this.collapseSetupGuide();
  }

  /**
   * Open the calendar on `day` in `view`, and wait for its appointments. Pass `doctorId` to show
   * only that doctor, as ticking just them in the Filters panel does: Week and Month are only
   * offered while a single doctor is shown.
   */
  async open(day: Date, view: CalendarView = 'Day', doctorId?: string): Promise<void> {
    const params = new URLSearchParams({ date: toDateParam(day) });
    if (doctorId) params.set('doctor', doctorId);
    if (view !== 'Day') params.set('calendar', view.toLowerCase());
    const loaded = waitForApiResponse(this.page, 'GET', ENDPOINTS.appointments);
    await this.page.goto(`/appointments?${params}`);
    expect((await loaded).ok(), 'the appointments should load').toBe(true);
    await this.collapseSetupGuide();
  }

  /** The Day, Week or Month choice ("Range"); only shown while the calendar shows a single doctor. */
  viewButton(view: CalendarView): Locator {
    return this.page
      .getByRole('radiogroup', { name: 'Range' })
      .getByRole('radio', { name: view, exact: true });
  }

  /** Switch between Day, Week and Month. */
  async switchView(view: CalendarView): Promise<void> {
    // The radio's input sits under its drawn label, which takes the click.
    await this.viewButton(view).check({ force: true });
  }

  /** A doctor's column title in Day view. */
  doctorColumn(doctorName: string): Locator {
    return this.main.getByText(doctorName, { exact: true });
  }

  /**
   * An appointment on the calendar. Its button's name holds the treatment and the time, e.g.
   * "Botox 123456 6:00 - 6:30 PM" (in Week and Month views the time comes first); tests give every
   * treatment a unique name to find it by.
   */
  card(treatmentName: string): Locator {
    return this.main.getByRole('button', { name: new RegExp(escapeRegExp(treatmentName)) }).first();
  }

  /**
   * Click an appointment on the calendar, then Open in the summary that pops up, and wait for the
   * full appointment.
   */
  async openAppointment(treatmentName: string): Promise<void> {
    await this.card(treatmentName).click();
    await this.page.getByRole('dialog').getByRole('button', { name: 'Open', exact: true }).click();
    await expect(this.panel.root).toBeVisible();
  }

  // --- Filters ---------------------------------------------------------------------------------

  /**
   * Open the List view on `day`, showing only `doctorIds`, and wait for its appointments. Tests
   * pass their own doctors so the list holds only their bookings.
   */
  async openList(day: Date, doctorIds: string[]): Promise<void> {
    const doctors = doctorIds.join(',');
    const params = new URLSearchParams({ view: 'list', date: toDateParam(day), doctor: doctors });
    const loaded = waitForListResponse(this.page, ENDPOINTS.appointments, { doctorIds: doctors });
    await this.page.goto(`/appointments?${params}`);
    expect((await loaded).ok(), 'the appointments should load').toBe(true);
    await this.collapseSetupGuide();
  }

  /** The List view's table (the Catch up queues use the same one). */
  get listGrid(): Locator {
    return this.main.getByRole('grid', { name: 'Appointments' });
  }

  /** A row of the List view, found by the patient's name. */
  listRow(patientName: string): Locator {
    return this.listGrid.getByRole('row', { name: new RegExp(escapeRegExp(patientName)) });
  }

  /** The List view's row shown when nothing matches the filters. */
  get emptyListRow(): Locator {
    return this.listGrid.getByRole('row', { name: /^No appointments found/ });
  }

  /** A status tab above the list or calendar; its name ends with a count when it has any. */
  statusTab(label: 'All' | AppointmentStatusLabel): Locator {
    return this.page
      .getByRole('tablist', { name: 'Status' })
      .getByRole('tab', { name: new RegExp(`^${escapeRegExp(label)}( \\d+)?$`) });
  }

  /** Pick a status tab and wait for the list to reload with that status. */
  async filterByStatus(label: 'All' | AppointmentStatusLabel): Promise<void> {
    const statuses = label === 'All' ? ALL_STATUSES_PARAM : APPOINTMENT_STATUSES[label];
    const loaded = waitForListResponse(this.page, ENDPOINTS.appointments, { statuses });
    await this.statusTab(label).click();
    expect((await loaded).ok(), 'the filtered appointments should load').toBe(true);
  }

  /**
   * A doctor in the side panel's Doctors list. Its name is their initials, their name and, when
   * they have bookings that day, the count, e.g. "EK Dr. Erwin Kertzmann 1".
   */
  doctorFilter(doctorName: string): Locator {
    return this.page.getByRole('button', {
      name: new RegExp(`^[A-Z]{1,2} ${escapeRegExp(doctorName)}( \\d+)?$`),
    });
  }

  /**
   * Click a doctor in the side panel. Each one is a toggle: a doctor who is shown is hidden, one
   * who is hidden is shown again (from "All doctors", clicking one shows only them). Waits for
   * the reload asking for `expectedDoctorIds` (the ids left shown, comma-separated, or a pattern).
   */
  async toggleDoctor(doctorName: string, expectedDoctorIds: string | RegExp): Promise<void> {
    const loaded = this.page.waitForResponse((response) => {
      const url = new URL(response.url());
      if (url.pathname !== ENDPOINTS.appointments) return false;
      const doctorIds = url.searchParams.get('doctorIds') ?? '';
      return typeof expectedDoctorIds === 'string'
        ? doctorIds === expectedDoctorIds
        : expectedDoctorIds.test(doctorIds) && url.searchParams.has('statuses');
    });
    await this.doctorFilter(doctorName).click();
    expect((await loaded).ok(), "the doctors' appointments should load").toBe(true);
  }

  /** The "Booked by" choice: Team (people), Novy (the AI) and EMR (synced from the EMR). */
  get bookedByButton(): Locator {
    return this.page.getByRole('button', { name: /^Booked by/ });
  }

  /**
   * Untick one "Booked by" source and wait for the reload with the `remaining` ones (as the API
   * names them, e.g. "ai,crm"), then close the list.
   */
  async hideBookedBy(source: 'Team' | 'Novy' | 'EMR', remaining: string): Promise<void> {
    await this.bookedByButton.click();
    const loaded = waitForListResponse(this.page, ENDPOINTS.appointments, { bookedBy: remaining });
    await this.page
      .getByRole('listbox', { name: 'Booked by' })
      .getByRole('option', { name: new RegExp(`^${source}`) })
      .click();
    expect((await loaded).ok(), 'the filtered appointments should load').toBe(true);
    await this.page.keyboard.press('Escape');
  }

  /** "Hide doctors with no bookings" above the calendar. */
  get hideEmptyDoctorsSwitch(): Locator {
    return this.page.getByRole('switch', { name: 'Hide doctors with no bookings' });
  }

  /** Turn "Hide doctors with no bookings" on. */
  async hideEmptyDoctors(): Promise<void> {
    // The switch is a tiny box; its label next to it takes the click.
    await this.page.getByText('Hide doctors with no bookings', { exact: true }).click();
    await expect(this.hideEmptyDoctorsSwitch).toBeChecked();
  }

  /**
   * A Catch up queue in the side panel, e.g. "Needs an answer 79" (past visits with no recorded
   * result). Its name ends with the count when it has any.
   */
  catchUpQueue(name: CatchUpQueue): Locator {
    return this.page.getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}( \\d+)?$`) });
  }

  /** Open a Catch up queue and wait for its first page. */
  async openCatchUpQueue(name: CatchUpQueue): Promise<void> {
    const loaded = waitForListResponse(this.page, ENDPOINTS.appointments, {
      [CATCH_UP_QUEUES[name]]: 'true',
    });
    await this.catchUpQueue(name).click();
    expect((await loaded).ok(), 'the queue should load').toBe(true);
    await expect(this.page.getByRole('heading', { name, level: 5 })).toBeVisible();
  }

  /** The search box of an open Catch up queue. */
  get queueSearchBox(): Locator {
    return this.page.getByRole('searchbox', { name: 'Search patients' });
  }

  /** The setup guide floats over the bottom right of the page; fold it away when it is open. */
  private async collapseSetupGuide(): Promise<void> {
    const collapse = this.page.getByRole('button', { name: 'Collapse setup guide' });
    if (await collapse.isVisible()) await collapse.click();
  }
}

/** Appointments → New appointment. */
export class NewAppointmentDialog {
  readonly root: Locator;
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly phoneInput: Locator;
  readonly notesInput: Locator;
  readonly createButton: Locator;
  readonly cancelButton: Locator;
  readonly closeButton: Locator;

  constructor(private readonly page: Page) {
    this.root = page.getByRole('dialog', { name: 'New appointment' });
    this.firstNameInput = this.root.getByRole('textbox', { name: 'First name' });
    this.lastNameInput = this.root.getByRole('textbox', { name: 'Last name' });
    this.phoneInput = this.root.getByRole('textbox', { name: 'Phone' });
    this.notesInput = this.root.getByRole('textbox', { name: 'Notes' });
    this.createButton = this.root.getByRole('button', { name: 'Book appointment', exact: true });
    this.cancelButton = this.root.getByRole('button', { name: 'Cancel' });
    this.closeButton = this.root.getByRole('button', { name: 'Close' });
  }

  async open(): Promise<void> {
    await this.page.getByRole('button', { name: 'New appointment' }).click();
    await expect(this.root).toBeVisible();
  }

  /** The inline error under a field, e.g. "First name is required". */
  error(message: string): Locator {
    return this.root.getByText(message, { exact: true });
  }

  /** Fill in a new patient, the doctor, the treatment, the day and the notes. */
  async fill(appointment: NewAppointment): Promise<void> {
    await this.firstNameInput.fill(appointment.patient.firstName);
    await this.lastNameInput.fill(appointment.patient.lastName);
    // The phone field formats the number as it is typed, so type it key by key like a user.
    await this.phoneInput.pressSequentially(appointment.patient.phone);
    // Doctor first: the treatment list shows only the chosen doctor's treatments.
    await this.choose(/Doctor$/, appointment.doctor);
    await this.choose(/Treatment$/, appointment.treatment);
    await this.chooseDay(appointment.day);
    if (appointment.notes !== undefined) await this.notesInput.fill(appointment.notes);
  }

  /** Press Create and wait for the server; returns the new appointment. */
  async submit(): Promise<Appointment> {
    const created = waitForApiResponse(this.page, 'POST', ENDPOINTS.appointments);
    await this.createButton.click();
    const response = await created;
    expect(response.status(), 'the server should create the appointment').toBe(201);
    return (await response.json()).data;
  }

  /** Pick an option from one of the dialog's dropdowns, found by the end of its button's name. */
  private async choose(buttonName: RegExp, option: string): Promise<void> {
    await this.root.getByRole('button', { name: buttonName }).click();
    await this.page.getByRole('listbox').last().getByRole('option', { name: option }).click();
    await expect(this.root.getByRole('button', { name: buttonName })).toContainText(option);
  }

  /** Type `day` into the date field (month, day and year segments), as a keyboard user does. */
  private async chooseDay(day: Date): Promise<void> {
    const date = this.root.getByRole('group', { name: 'Date' });
    await date.getByRole('spinbutton', { name: /^month/ }).click();
    const pad = (n: number) => String(n).padStart(2, '0');
    await this.page.keyboard.type(`${pad(day.getMonth() + 1)}${pad(day.getDate())}${day.getFullYear()}`);
    await expect(date.getByRole('spinbutton', { name: /^day/ })).toHaveAttribute(
      'aria-valuenow',
      String(day.getDate()),
    );
  }
}

/** The panel that opens when an appointment is clicked on the calendar. */
export class AppointmentPanel {
  readonly root: Locator;
  readonly notesInput: Locator;
  readonly saveButton: Locator;
  readonly moreActionsButton: Locator;
  readonly addPaymentButton: Locator;
  readonly deleteDialog: Locator;
  readonly invoiceDialog: Locator;

  constructor(private readonly page: Page) {
    // Named after the patient since the 2026-11-25 redesign; the full view is the dialog with
    // More actions (the summary that pops up first has none).
    this.root = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('button', { name: 'More actions' }) })
      .last();
    this.notesInput = this.root.getByRole('textbox', { name: 'Notes' });
    this.saveButton = this.root.getByRole('button', { name: 'Save', exact: true });
    // .first(): the menu button is nested in a second button with the same name.
    this.moreActionsButton = this.root.getByRole('button', { name: 'More actions' }).first();
    // Only in a workspace without an EMR; one with an EMR says to record the payment there.
    this.addPaymentButton = this.root.getByRole('button', { name: 'Add payment' });
    this.deleteDialog = page.getByRole('dialog', { name: 'Delete appointment?' });
    this.invoiceDialog = page.getByRole('dialog', { name: 'Record an invoice' });
  }

  // --- EMR mode: the workspace records money in its EMR (ClinicSoft) -------------------------

  /** The visit's number in the EMR, e.g. "Visit 1473", under "EMR Added". */
  get emrVisit(): Locator {
    return this.root.getByRole('paragraph').filter({ hasText: /^Visit \d+$/ });
  }

  /** "Sync from the EMR": pulls the visit's details back from the EMR. */
  get syncFromEmrButton(): Locator {
    return this.root.getByRole('button', { name: 'Sync from the EMR' });
  }

  /** "Refresh billing" in the Payment section: asks the EMR for the visit's invoices. */
  get refreshBillingButton(): Locator {
    // .first(): the button is nested in a second button with the same name.
    return this.root.getByRole('button', { name: 'Refresh billing' }).first();
  }

  /** The Payment section's text, e.g. "The visit is done, the EMR has nothing for it". */
  paymentText(text: string): Locator {
    return this.root.getByRole('paragraph').filter({ hasText: text });
  }

  /** Press Refresh billing and wait for the sync to answer. */
  async refreshBilling(appointmentId: string): Promise<void> {
    const synced = waitForApiResponse(
      this.page,
      'POST',
      `${ENDPOINTS.appointments}/${appointmentId}/billing/sync`,
    );
    await this.refreshBillingButton.click();
    expect((await synced).status(), 'the billing sync should succeed').toBe(201);
  }

  /** The status button, which shows the current status, e.g. "Unconfirmed". */
  statusButton(current: AppointmentStatusLabel): Locator {
    return this.root.getByRole('button', { name: current, exact: true }).first();
  }

  /**
   * Change the status from `current` to `next`. Most statuses save at once; Cancelled first asks
   * to confirm, with an optional `cancellationReason`.
   */
  async changeStatus(
    appointmentId: string,
    current: AppointmentStatusLabel,
    next: AppointmentStatusLabel,
    cancellationReason?: string,
  ): Promise<void> {
    await this.statusButton(current).click();
    const saved = waitForApiResponse(this.page, 'PATCH', `${ENDPOINTS.appointments}/${appointmentId}`);
    await this.page.getByRole('menuitemradio', { name: next, exact: true }).click();
    if (next === 'Cancelled') {
      const confirm = this.page.getByRole('dialog', { name: 'Cancel appointment?' });
      await expect(confirm).toBeVisible();
      if (cancellationReason) {
        await confirm.getByRole('textbox', { name: 'Cancellation reason' }).fill(cancellationReason);
      }
      await confirm.getByRole('button', { name: 'Confirm cancellation' }).click();
      await expect(confirm).toBeHidden();
    }
    expect((await saved).ok(), 'the server should save the status').toBe(true);
    await expect(this.statusButton(next)).toBeVisible();
  }

  /** Replace the notes and press Save. */
  async saveNotes(appointmentId: string, notes: string): Promise<void> {
    await this.notesInput.fill(notes);
    const saved = waitForApiResponse(this.page, 'PATCH', `${ENDPOINTS.appointments}/${appointmentId}`);
    await this.saveButton.click();
    expect((await saved).ok(), 'the server should save the notes').toBe(true);
    await expect(this.saveButton).toBeHidden();
  }

  /** More actions → Delete appointment, confirming the dialog names the patient. */
  async delete(appointmentId: string, patientName: string): Promise<void> {
    await this.moreActionsButton.click();
    await this.page.getByRole('menuitem', { name: 'Delete appointment' }).click();
    await expect(this.deleteDialog).toBeVisible();
    await expect(this.deleteDialog).toContainText(patientName);
    const deleted = waitForApiResponse(this.page, 'DELETE', `${ENDPOINTS.appointments}/${appointmentId}`);
    await this.deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click();
    expect((await deleted).ok(), 'the server should delete the appointment').toBe(true);
    await expect(this.deleteDialog).toBeHidden();
  }

  /**
   * Add payment → "Record an invoice" for `amount`, with an optional note, and save. Replyn makes a
   * paid invoice and a cleared receipt for the visit. Returns once the server has saved it.
   */
  async addPayment(amount: number, notes?: string): Promise<void> {
    await this.addPaymentButton.click();
    await expect(this.invoiceDialog).toBeVisible();
    const amountInput = this.invoiceDialog.getByRole('textbox', { name: 'Amount paid' });
    await amountInput.fill(String(amount));
    // The amount field takes the value when it loses focus.
    await amountInput.press('Tab');
    if (notes) await this.invoiceDialog.getByRole('textbox', { name: 'Notes (optional)' }).fill(notes);
    const saved = waitForApiResponse(this.page, 'POST', ENDPOINTS.invoices);
    await this.invoiceDialog.getByRole('button', { name: 'Record invoice' }).click();
    expect((await saved).status(), 'the server should save the payment').toBe(201);
    await expect(this.invoiceDialog).toBeHidden();
  }

  /** A money record shown in the panel, e.g. its invoice "INV-000001". */
  document(code: string): Locator {
    return this.root.getByRole('button', { name: new RegExp(escapeRegExp(code)) });
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
