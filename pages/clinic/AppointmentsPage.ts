import { expect, type Locator, type Page } from '@playwright/test';
import { ENDPOINTS } from '../../api/ResourceApi';
import type { Appointment, AppointmentStatusLabel } from '../../api/AppointmentsApi';
import { waitForApiResponse } from '../../utils/network';
import { toDateParam, type PatientData } from '../../utils/testData';

export type CalendarView = 'Day' | 'Week' | 'Month';

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
  readonly recordPaymentButton: Locator;
  readonly deleteDialog: Locator;
  readonly paymentSteps: Locator;

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
    this.recordPaymentButton = this.root.getByRole('button', { name: 'Record the payment' });
    this.deleteDialog = page.getByRole('dialog', { name: 'Delete appointment?' });
    // The steps' title changes ("What did the visit cost? 2 of 3"), but always ends with "of 3".
    this.paymentSteps = page.getByRole('dialog', { name: /of 3$/ });
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
   * For an attended visit: Record the payment → "Paid for this visit" for `amount` → "All done".
   * Returns once the server has saved it.
   */
  async recordPayment(appointmentId: string, amount: number): Promise<void> {
    await this.recordPaymentButton.click();
    await expect(this.paymentSteps).toHaveAccessibleName(/^What did the visit cost\?/);
    await this.chooseStepOption(/^Paid for this visit/);
    const amountInput = this.paymentSteps.getByRole('textbox', { name: 'How much did they pay?' });
    await amountInput.fill(String(amount));
    // The amount field takes the value when it loses focus.
    await amountInput.press('Tab');
    await this.paymentSteps.getByRole('button', { name: 'Next' }).click();
    await expect(this.paymentSteps).toHaveAccessibleName(/^What came of the visit\?/);
    await this.chooseStepOption(/^All done/);
    const saved = waitForApiResponse(this.page, 'POST', `${ENDPOINTS.appointments}/${appointmentId}/outcome`);
    await this.paymentSteps.getByRole('button', { name: 'Save' }).click();
    expect((await saved).status(), 'the server should save the payment').toBe(201);
    await expect(this.paymentSteps).toBeHidden();
  }

  /** A money record shown in the panel, e.g. its invoice "INV-000001". */
  document(code: string): Locator {
    return this.root.getByRole('button', { name: new RegExp(escapeRegExp(code)) });
  }

  /**
   * Tick an option in a step of Record the payment. The option's text covers its hidden radio and
   * takes the clicks, so click the option's label (found from the radio) the way a user does.
   */
  private async chooseStepOption(name: RegExp): Promise<void> {
    const radio = this.paymentSteps.getByRole('radio', { name });
    await radio.locator('xpath=ancestor::label[1]').click();
    await expect(radio).toBeChecked();
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
