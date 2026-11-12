import { test as base } from '@playwright/test';
import { AppointmentsApi, BillingApi } from '../api/AppointmentsApi';
import { AuthApi } from '../api/AuthApi';
import { ContactFieldsApi } from '../api/ContactFieldsApi';
import { ContactsApi, LifecyclesApi, SegmentsApi } from '../api/ContactsApi';
import { CustomViewsApi } from '../api/CustomViewsApi';
import { DepartmentsApi } from '../api/DepartmentsApi';
import { ApiKeysApi, WebhooksApi } from '../api/DeveloperApi';
import { DoctorsApi } from '../api/DoctorsApi';
import { MembersApi } from '../api/MembersApi';
import { OrganizationApi } from '../api/OrganizationApi';
import { OutcomeReasonsApi } from '../api/OutcomeReasonsApi';
import {
  ClosingNotesApi,
  SavedFilesApi,
  SnippetsApi,
  TagsApi,
  TeamsApi,
  WebsitesApi,
} from '../api/SettingsApis';
import type { HeadersProvider } from '../api/ResourceApi';
import { TreatmentsApi } from '../api/TreatmentsApi';
import { AssignmentApi, SlasApi, WorkspaceApi } from '../api/WorkspaceApi';
import { RolesApi, WorkspaceUsersApi } from '../api/RolesApi';
import { ReportsApi } from '../api/ReportsApi';
import { WrapUpApi } from '../api/WrapUpApi';
import { WorkflowsApi } from '../api/WorkflowsApi';
import { BroadcastsApi, ChannelsApi } from '../api/BroadcastsApi';
import { SidebarApi } from '../api/SidebarApi';
import { InboxApi } from '../api/InboxApi';
import { env } from '../config/env';
import { LoginPage } from '../pages/auth/LoginPage';
import { SavedViewsPage } from '../pages/inbox/SavedViewsPage';
import { ConversationPage } from '../pages/inbox/ConversationPage';
import { AppointmentsPage } from '../pages/clinic/AppointmentsPage';
import { BillingPage } from '../pages/clinic/BillingPage';
import { ContactsPage } from '../pages/contacts/ContactsPage';
import { DepartmentsPage } from '../pages/clinic/DepartmentsPage';
import { DoctorsPage } from '../pages/clinic/DoctorsPage';
import { TreatmentsPage } from '../pages/clinic/TreatmentsPage';
import { MembersPage } from '../pages/settings/MembersPage';
import { OrganizationGeneralPage } from '../pages/settings/OrganizationGeneralPage';
import { OutcomeReasonsPage } from '../pages/settings/OutcomeReasonsPage';
import { ClosingNotesPage } from '../pages/settings/ClosingNotesPage';
import { ContactFieldsPage } from '../pages/settings/ContactFieldsPage';
import { SavedFilesPage } from '../pages/settings/SavedFilesPage';
import { SnippetsPage } from '../pages/settings/SnippetsPage';
import { TagsPage } from '../pages/settings/TagsPage';
import { TeamsPage } from '../pages/settings/TeamsPage';
import { WebhooksPage } from '../pages/settings/WebhooksPage';
import { WrapUpPage } from '../pages/settings/WrapUpPage';
import { AiSettingsPage } from '../pages/settings/AiSettingsPage';
import { AssignmentPage } from '../pages/settings/AssignmentPage';
import { HoursPage } from '../pages/settings/HoursPage';
import { LifecycleStagesPage } from '../pages/settings/LifecycleStagesPage';
import { SlaPage } from '../pages/settings/SlaPage';
import { WorkspaceGeneralPage } from '../pages/settings/WorkspaceGeneralPage';
import { RolesPage } from '../pages/settings/RolesPage';
import { DashboardPage, ReportsPage } from '../pages/reports/ReportsPage';
import { WorkspaceUsersPage } from '../pages/settings/WorkspaceUsersPage';
import { WebsitesPage } from '../pages/settings/WebsitesPage';
import { WorkflowsPage } from '../pages/workflows/WorkflowsPage';
import { BroadcastsPage, NewBroadcastForm } from '../pages/broadcasts/BroadcastsPage';
import { Sidebar } from '../pages/Sidebar';

/** Collects clean-up actions and runs them after the test, even when the test failed. */
export type Cleanup = {
  add(description: string, action: () => Promise<void>): void;
};

type Fixtures = {
  loginPage: LoginPage;
  doctorsPage: DoctorsPage;
  treatmentsPage: TreatmentsPage;
  departmentsPage: DepartmentsPage;
  organizationPage: OrganizationGeneralPage;
  membersPage: MembersPage;
  websitesPage: WebsitesPage;
  teamsPage: TeamsPage;
  tagsPage: TagsPage;
  closingNotesPage: ClosingNotesPage;
  snippetsPage: SnippetsPage;
  savedFilesPage: SavedFilesPage;
  contactsPage: ContactsPage;
  appointmentsPage: AppointmentsPage;
  billingPage: BillingPage;
  /** Headers for the app's API: a fresh login token plus the tenant and workspace IDs. */
  apiHeaders: HeadersProvider;
  doctorsApi: DoctorsApi;
  treatmentsApi: TreatmentsApi;
  departmentsApi: DepartmentsApi;
  organizationApi: OrganizationApi;
  membersApi: MembersApi;
  websitesApi: WebsitesApi;
  teamsApi: TeamsApi;
  tagsApi: TagsApi;
  closingNotesApi: ClosingNotesApi;
  snippetsApi: SnippetsApi;
  savedFilesApi: SavedFilesApi;
  contactsApi: ContactsApi;
  contactFieldsPage: ContactFieldsPage;
  contactFieldsApi: ContactFieldsApi;
  outcomeReasonsPage: OutcomeReasonsPage;
  outcomeReasonsApi: OutcomeReasonsApi;
  wrapUpPage: WrapUpPage;
  wrapUpApi: WrapUpApi;
  apiKeysApi: ApiKeysApi;
  webhooksPage: WebhooksPage;
  webhooksApi: WebhooksApi;
  savedViewsPage: SavedViewsPage;
  conversationPage: ConversationPage;
  inboxApi: InboxApi;
  workspaceGeneralPage: WorkspaceGeneralPage;
  hoursPage: HoursPage;
  slaPage: SlaPage;
  assignmentPage: AssignmentPage;
  aiSettingsPage: AiSettingsPage;
  lifecycleStagesPage: LifecycleStagesPage;
  workspaceApi: WorkspaceApi;
  slasApi: SlasApi;
  assignmentApi: AssignmentApi;
  rolesPage: RolesPage;
  reportsPage: ReportsPage;
  dashboardPage: DashboardPage;
  reportsApi: ReportsApi;
  rolesApi: RolesApi;
  workspaceUsersPage: WorkspaceUsersPage;
  workspaceUsersApi: WorkspaceUsersApi;
  customViewsApi: CustomViewsApi;
  workflowsPage: WorkflowsPage;
  workflowsApi: WorkflowsApi;
  broadcastsPage: BroadcastsPage;
  newBroadcastForm: NewBroadcastForm;
  broadcastsApi: BroadcastsApi;
  channelsApi: ChannelsApi;
  sidebar: Sidebar;
  sidebarApi: SidebarApi;
  segmentsApi: SegmentsApi;
  lifecyclesApi: LifecyclesApi;
  appointmentsApi: AppointmentsApi;
  billingApi: BillingApi;
  /** The workspace the test account works in (the same one the app sends as x-workspace-id). */
  workspaceId: string;
  /** Clerk login calls. Needs no browser and no saved session. */
  authApi: AuthApi;
  cleanup: Cleanup;
};

/**
 * The `test` every spec imports. On top of Playwright's built-ins it provides ready-made
 * page objects, API clients and automatic cleanup, so tests only describe behaviour.
 */
export const test = base.extend<Fixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  doctorsPage: async ({ page }, use) => {
    await use(new DoctorsPage(page));
  },

  treatmentsPage: async ({ page }, use) => {
    await use(new TreatmentsPage(page));
  },

  departmentsPage: async ({ page }, use) => {
    await use(new DepartmentsPage(page));
  },

  organizationPage: async ({ page }, use) => {
    await use(new OrganizationGeneralPage(page));
  },

  membersPage: async ({ page }, use) => {
    await use(new MembersPage(page));
  },

  websitesPage: async ({ page }, use) => {
    await use(new WebsitesPage(page));
  },

  // Teams live in a workspace, so the page needs its id for the API path it waits on.
  teamsPage: async ({ page, workspaceId }, use) => {
    await use(new TeamsPage(page, workspaceId));
  },

  tagsPage: async ({ page }, use) => {
    await use(new TagsPage(page));
  },

  closingNotesPage: async ({ page }, use) => {
    await use(new ClosingNotesPage(page));
  },

  snippetsPage: async ({ page }, use) => {
    await use(new SnippetsPage(page));
  },

  savedFilesPage: async ({ page }, use) => {
    await use(new SavedFilesPage(page));
  },

  contactsPage: async ({ page }, use) => {
    await use(new ContactsPage(page));
  },

  appointmentsPage: async ({ page }, use) => {
    await use(new AppointmentsPage(page));
  },

  billingPage: async ({ page }, use) => {
    await use(new BillingPage(page));
  },

  apiHeaders: async ({ page }, use) => {
    // The saved session logs the browser in. Open the app once to read the workspace ID from
    // its own API calls, and to reach Clerk, which hands out login tokens.
    const firstApiCall = page.waitForRequest(
      (request) => request.url().startsWith(env.apiUrl) && !!request.headers()['x-workspace-id'],
    );
    await page.goto('/dashboard');
    const workspaceId = (await firstApiCall).headers()['x-workspace-id'];
    await page.waitForFunction(() => (window as any).Clerk?.session);

    await use(async () => ({
      // Tokens expire after 60 seconds, so ask Clerk on every request. It caches them, so this is fast.
      authorization: `Bearer ${await page.evaluate(() => (window as any).Clerk.session.getToken())}`,
      'x-tenant-id': env.tenantId,
      'x-workspace-id': workspaceId,
    }));
  },

  doctorsApi: async ({ request, apiHeaders }, use) => {
    await use(new DoctorsApi(request, apiHeaders));
  },

  treatmentsApi: async ({ request, apiHeaders }, use) => {
    await use(new TreatmentsApi(request, apiHeaders));
  },

  departmentsApi: async ({ request, apiHeaders }, use) => {
    await use(new DepartmentsApi(request, apiHeaders));
  },

  organizationApi: async ({ request, apiHeaders }, use) => {
    await use(new OrganizationApi(request, apiHeaders));
  },

  membersApi: async ({ request, apiHeaders }, use) => {
    await use(new MembersApi(request, apiHeaders));
  },

  websitesApi: async ({ request, apiHeaders }, use) => {
    await use(new WebsitesApi(request, apiHeaders));
  },

  teamsApi: async ({ request, apiHeaders, workspaceId }, use) => {
    await use(new TeamsApi(request, apiHeaders, workspaceId));
  },

  tagsApi: async ({ request, apiHeaders }, use) => {
    await use(new TagsApi(request, apiHeaders));
  },

  closingNotesApi: async ({ request, apiHeaders }, use) => {
    await use(new ClosingNotesApi(request, apiHeaders));
  },

  snippetsApi: async ({ request, apiHeaders }, use) => {
    await use(new SnippetsApi(request, apiHeaders));
  },

  savedFilesApi: async ({ request, apiHeaders }, use) => {
    await use(new SavedFilesApi(request, apiHeaders));
  },

  contactsApi: async ({ request, apiHeaders }, use) => {
    await use(new ContactsApi(request, apiHeaders));
  },

  segmentsApi: async ({ request, apiHeaders }, use) => {
    await use(new SegmentsApi(request, apiHeaders));
  },

  lifecyclesApi: async ({ request, apiHeaders }, use) => {
    await use(new LifecyclesApi(request, apiHeaders));
  },

  appointmentsApi: async ({ request, apiHeaders }, use) => {
    await use(new AppointmentsApi(request, apiHeaders));
  },

  billingApi: async ({ request, apiHeaders }, use) => {
    await use(new BillingApi(request, apiHeaders));
  },

  contactFieldsPage: async ({ page }, use) => {
    await use(new ContactFieldsPage(page));
  },

  contactFieldsApi: async ({ request, apiHeaders }, use) => {
    await use(new ContactFieldsApi(request, apiHeaders));
  },

  outcomeReasonsPage: async ({ page }, use) => {
    await use(new OutcomeReasonsPage(page));
  },

  outcomeReasonsApi: async ({ request, apiHeaders }, use) => {
    await use(new OutcomeReasonsApi(request, apiHeaders));
  },

  wrapUpPage: async ({ page }, use) => {
    await use(new WrapUpPage(page));
  },

  wrapUpApi: async ({ request, apiHeaders }, use) => {
    await use(new WrapUpApi(request, apiHeaders));
  },

  apiKeysApi: async ({ request, apiHeaders }, use) => {
    await use(new ApiKeysApi(request, apiHeaders));
  },

  webhooksPage: async ({ page }, use) => {
    await use(new WebhooksPage(page));
  },

  webhooksApi: async ({ request, apiHeaders }, use) => {
    await use(new WebhooksApi(request, apiHeaders));
  },

  workspaceGeneralPage: async ({ page, workspaceId }, use) => {
    await use(new WorkspaceGeneralPage(page, workspaceId));
  },

  hoursPage: async ({ page, workspaceId }, use) => {
    await use(new HoursPage(page, workspaceId));
  },

  slaPage: async ({ page, workspaceId }, use) => {
    await use(new SlaPage(page, workspaceId));
  },

  assignmentPage: async ({ page }, use) => {
    await use(new AssignmentPage(page));
  },

  aiSettingsPage: async ({ page, workspaceId }, use) => {
    await use(new AiSettingsPage(page, workspaceId));
  },

  lifecycleStagesPage: async ({ page }, use) => {
    await use(new LifecycleStagesPage(page));
  },

  workspaceApi: async ({ request, apiHeaders, workspaceId }, use) => {
    await use(new WorkspaceApi(request, apiHeaders, workspaceId));
  },

  slasApi: async ({ request, apiHeaders, workspaceId }, use) => {
    await use(new SlasApi(request, apiHeaders, workspaceId));
  },

  assignmentApi: async ({ request, apiHeaders }, use) => {
    await use(new AssignmentApi(request, apiHeaders));
  },

  reportsPage: async ({ page }, use) => {
    await use(new ReportsPage(page));
  },

  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },

  reportsApi: async ({ request, apiHeaders }, use) => {
    await use(new ReportsApi(request, apiHeaders));
  },

  rolesPage: async ({ page, workspaceId }, use) => {
    await use(new RolesPage(page, workspaceId));
  },

  rolesApi: async ({ request, apiHeaders, workspaceId }, use) => {
    await use(new RolesApi(request, apiHeaders, workspaceId));
  },

  workspaceUsersPage: async ({ page, workspaceId }, use) => {
    await use(new WorkspaceUsersPage(page, workspaceId));
  },

  workspaceUsersApi: async ({ request, apiHeaders, workspaceId }, use) => {
    await use(new WorkspaceUsersApi(request, apiHeaders, workspaceId));
  },

  savedViewsPage: async ({ page, workspaceId }, use) => {
    await use(new SavedViewsPage(page, workspaceId));
  },

  conversationPage: async ({ page, workspaceId }, use) => {
    await use(new ConversationPage(page, workspaceId));
  },

  inboxApi: async ({ request, apiHeaders }, use) => {
    await use(new InboxApi(request, apiHeaders));
  },

  customViewsApi: async ({ request, apiHeaders }, use) => {
    await use(new CustomViewsApi(request, apiHeaders));
  },

  workflowsPage: async ({ page }, use) => {
    await use(new WorkflowsPage(page));
  },

  workflowsApi: async ({ request, apiHeaders }, use) => {
    await use(new WorkflowsApi(request, apiHeaders));
  },

  broadcastsPage: async ({ page }, use) => {
    await use(new BroadcastsPage(page));
  },

  newBroadcastForm: async ({ page }, use) => {
    await use(new NewBroadcastForm(page));
  },

  broadcastsApi: async ({ request, apiHeaders }, use) => {
    await use(new BroadcastsApi(request, apiHeaders));
  },

  channelsApi: async ({ request, apiHeaders }, use) => {
    await use(new ChannelsApi(request, apiHeaders));
  },

  sidebar: async ({ page }, use) => {
    await use(new Sidebar(page));
  },

  sidebarApi: async ({ request, apiHeaders }, use) => {
    await use(new SidebarApi(request, apiHeaders));
  },

  workspaceId: async ({ apiHeaders }, use) => {
    await use((await apiHeaders())['x-workspace-id']);
  },

  authApi: async ({ request }, use) => {
    await use(new AuthApi(request));
  },

  // Depends on `request` and `apiHeaders` so both are still available while cleanup runs.
  cleanup: async ({ request: _request, apiHeaders: _apiHeaders }, use) => {
    const actions: { description: string; action: () => Promise<void> }[] = [];
    await use({ add: (description, action) => actions.push({ description, action }) });

    for (const { description, action } of actions.reverse()) {
      try {
        await action();
      } catch (error) {
        // Warn instead of failing: the test result should reflect the behaviour under test.
        console.warn(`Cleanup failed (${description}) - remove it manually.`, error);
      }
    }
  },
});

export { expect } from '@playwright/test';
