import { expect, type Locator, type Page, type Request, type Response } from '@playwright/test';
import { env } from '../../config/env';

/** A report as the Reports home lists it: its group, link title and address, and its page heading. */
export type ReportEntry = { group: string; title: string; path: string; heading: string };

/** Every report on the Reports home, in its order. */
export const REPORTS: ReportEntry[] = [
  { group: 'Conversations', title: 'Overview', path: '/reports/conversations', heading: 'Conversations' },
  { group: 'Conversations', title: 'Messages', path: '/reports/messages', heading: 'Messages' },
  { group: 'Daily', title: 'Daily tracker', path: '/reports/daily-tracker', heading: 'Daily tracker' },
  {
    group: 'Daily',
    title: 'Daily operations',
    path: '/reports/daily-operations',
    heading: 'Daily operations',
  },
  // Since the 2026-11-25 redesign Leads has a group of its own; "Sources & ads" became
  // "Lead acquisition" (its old address redirects there).
  { group: 'Leads', title: 'Overview', path: '/reports/leads', heading: 'Leads overview' },
  {
    group: 'Leads',
    title: 'Lead acquisition',
    path: '/reports/lead-acquisition',
    heading: 'Lead acquisition',
  },
  { group: 'Leads', title: 'Lost and disqualified', path: '/reports/lost', heading: 'Lost and disqualified' },
  { group: 'Contacts', title: 'Overview', path: '/reports/contacts', heading: 'Contacts' },
  { group: 'Contacts', title: 'Broadcasts', path: '/reports/broadcasts', heading: 'Broadcasts' },
  { group: 'Contacts', title: 'Follow-ups', path: '/reports/follow-ups', heading: 'Follow-ups' },
  { group: 'Appointments', title: 'Overview', path: '/reports/appointments', heading: 'Appointments' },
  {
    group: 'Appointments',
    title: 'Recoveries',
    path: '/reports/attendance',
    heading: 'Appointment recoveries',
  },
  {
    group: 'Appointments',
    title: 'Doctors & treatments',
    path: '/reports/doctors',
    heading: 'Doctors & treatments',
  },
  { group: 'Collections', title: 'Cash in', path: '/reports/collections/cash-in', heading: 'Cash in' },
  {
    group: 'Collections',
    title: 'Needs verification',
    path: '/reports/collections/verification',
    heading: 'Needs verification',
  },
  { group: 'Performance', title: 'Team performance', path: '/reports/agents', heading: 'Team performance' },
];

/** Reports home (/reports) and the report pages it links to. */
export class ReportsPage {
  readonly heading: Locator;
  readonly searchBox: Locator;
  readonly errorPage: Locator;
  /** The date range button above every report, e.g. "Oct 25 - Oct 31". */
  readonly dateRangeButton: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('banner').getByRole('heading', { level: 4 });
    // The one in the page itself; the reports side menu has its own.
    this.searchBox = page.getByRole('main').getByRole('searchbox', { name: 'Search reports' });
    this.errorPage = page.getByRole('heading', { name: 'Something went wrong' });
    this.dateRangeButton = page
      .getByRole('banner')
      .getByRole('button', { name: /^[A-Z][a-z]{2} \d{1,2}( - [A-Z][a-z]{2} \d{1,2})?/ })
      .first();
  }

  /** Go to Reports through the sidebar, as a user would. */
  async openFromDashboard(): Promise<void> {
    await this.page.goto('/dashboard');
    await this.page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Reports' })
      .click();
    await expect(this.page).toHaveURL('/reports');
    await expect(this.heading).toHaveText('Reports');
  }

  /** A report's link on the Reports home, e.g. "Leads How far new leads got…". */
  reportLink(report: ReportEntry): Locator {
    return this.page.getByRole('main').locator(`a[href="${report.path}"]`);
  }

  /**
   * Open a report from the Reports home and wait until it has loaded.
   * @returns every report API answer the page got while loading, to check none failed.
   */
  async openReport(report: ReportEntry): Promise<Response[]> {
    let sent = 0;
    const answers: Response[] = [];
    const isReportCall = (url: string) => {
      const { origin, pathname } = new URL(url);
      return origin === env.apiUrl && pathname.startsWith('/v1/reports/');
    };
    const countRequest = (request: Request) => {
      if (isReportCall(request.url()) && request.method() !== 'OPTIONS') sent++;
    };
    const collect = (response: Response) => {
      if (isReportCall(response.url()) && response.request().method() !== 'OPTIONS') answers.push(response);
    };
    this.page.on('request', countRequest);
    this.page.on('response', collect);
    await this.reportLink(report).click();
    await expect(this.page).toHaveURL(report.path);
    await expect(this.heading).toHaveText(report.heading);
    await expect(this.dateRangeButton).toBeVisible();
    // Loaded once the report's own data (not just the shared activity feed) has come back, and
    // every report request it sent has been answered.
    await expect
      .poll(
        () =>
          answers.some((answer) => !answer.url().includes('/v1/reports/activity')) && answers.length >= sent,
      )
      .toBe(true);
    this.page.off('request', countRequest);
    this.page.off('response', collect);
    return answers;
  }
}

/** The dashboard's tiles: money, appointments, and lead outcomes. */
export class DashboardPage {
  constructor(private readonly page: Page) {}

  /** Open the dashboard and wait for its tiles' data. */
  async open(): Promise<void> {
    const loaded = this.page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/v1/reports/dashboard/clinic' && response.ok(),
    );
    await this.page.goto('/dashboard');
    await loaded;
  }

  /** A tile's button, named after its label, e.g. "New leads 3". */
  tile(label: string): Locator {
    return this.page.getByRole('main').getByRole('button', { name: new RegExp(`^${label} `) });
  }

  /** The number a count tile shows, e.g. 3 for "New leads". */
  async count(label: string): Promise<number> {
    return Number((await this.tile(label).getByRole('heading').innerText()).replace(/[^\d]/g, ''));
  }

  /** The amount a money tile shows, e.g. 250 for "New advances AED 250". */
  async amount(label: string): Promise<number> {
    return Number((await this.tile(label).getByRole('definition').innerText()).replace(/[^\d.]/g, ''));
  }
}
