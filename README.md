# Replyn Test Suite

End-to-end tests for the [Replyn](https://beta.replyn.dev) clinic app, written with Playwright and TypeScript.
They cover **login** (valid and invalid credentials), managing **doctors** and **treatments** in the UI
(create, edit, delete, required fields, server errors), and the matching **REST and login APIs**.

## Setup

**1. Install** (needs Node.js 20+):

```bash
npm ci
npx playwright install chromium
```

**2. Configure:** copy `.env.example` to `.env` and fill in the test account:

```text
TEST_USERNAME=your-test-account@example.com
TEST_PASSWORD=your-password
```

Everything else in `.env.example` is optional and defaults to the beta environment. `TEST_WORKSPACE`
(default `Testing`) is the workspace every test runs in: setup switches to it after logging in.
`.env` is git-ignored, so never commit it. On CI the GitHub secrets `SECRETU` and `SECRETP` provide the account.

The permission tests also need a second, limited account: a member of `TEST_WORKSPACE` with the built-in
**Agent** role. Add it as `TEST_AGENT_USERNAME` / `TEST_AGENT_PASSWORD` (`.env` locally, GitHub secrets
of the same names on CI). Without it those tests are skipped.

**3. Run:**

| What                                                       | Command                                                           |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| Everything, including the exclusive tests                  | `npm run test:all`                                                |
| Everything except the exclusive tests                      | `npm test`                                                        |
| Smoke test only (is the app up?)                           | `npm run test:smoke`                                              |
| UI tests only / API tests only                             | `npm run test:ui` / `npm run test:api`                            |
| Login                                                      | `npm run test:login`                                              |
| All of Clinic                                              | `npm run test:clinic`                                             |
| One Clinic feature                                         | `npm run test:doctors` (or `test:treatments`, `test:departments`) |
| Clinic → Appointments / Billing                            | `npm run test:appointments` / `npm run test:billing`              |
| All of Settings (except the exclusive tests)               | `npm run test:settings`                                           |
| Settings → Members                                         | `npm run test:members`                                            |
| Settings → Roles and Workspace Members                     | `npm run test:roles`                                              |
| Settings → Contact Fields / Outcome Reasons                | `npm run test:contact-fields` / `npm run test:outcome-reasons`    |
| Settings → Wrap-Up (one test at a time)                    | `npm run test:wrap-up`                                            |
| Settings → API Keys and Webhooks                           | `npm run test:api-keys`                                           |
| Inbox → saved Views                                        | `npm run test:inbox`                                              |
| Reports: every report loads, and the API                   | `npm run test:reports`                                            |
| Report and dashboard numbers with seeded data (exclusive)  | `npm run test:report-numbers`                                     |
| All exclusive tests (run on their own)                     | `npm run test:exclusive`                                          |
| Settings → Organization (exclusive)                        | `npm run test:organization`                                       |
| Workspace General, Hours, SLAs, Assignment, AI (exclusive) | `npm run test:workspace`                                          |
| Settings → Lifecycle stages (exclusive)                    | `npm run test:lifecycle`                                          |
| Contacts                                                   | `npm run test:contacts`                                           |
| Broadcasts: list, filters, form validation (never sends)   | `npm run test:broadcasts`                                         |
| Workflows list: tabs, Live switch, duplicate, archive      | `npm run test:workflows`                                          |
| Sidebar widgets: notifications, AI credits, account menu   | `npm run test:sidebar`                                            |
| Permissions: what the Agent role may and may not do        | `npm run test:permissions`                                        |
| Clean up old test data / only list what it would delete    | `npm run test:sweep` / `npm run test:sweep:dry`                   |
| One file                                                   | `npx playwright test tests/clinic/doctors/doctors.spec.ts`        |
| One test, by name                                          | `npx playwright test -g "when user deletes it"`                   |
| Headless (no browser window)                               | `npm run test:headless`                                           |
| Headed (watch the browser)                                 | `npm run test:headed`                                             |
| UI mode (pick, re-run and debug tests)                     | `npm run test:debug`                                              |
| Type-check / format                                        | `npm run typecheck` / `npm run format`                            |

Locally the browser window is visible by default. `test:headless` hides it, and accepts the same
options: `npm run test:headless -- tests/clinic/doctors`. You can also set `HEADLESS=true` in `.env`.

**Why some tests are exclusive (run on their own):** they change settings the other tests rely on.
Settings → Organization changes the whole app (switching the organization type to E-commerce hides the
Clinic menu); the workspace's General settings, Hours, SLAs, Assignment rules, AI switch and Lifecycle
stages change how every conversation, booking and contact behaves (the contacts tests read the stages).
The report-number tests count contacts, bookings and payments, which the parallel tests keep changing.
They live in the `exclusive` project and run only through `npm run test:exclusive` (or the narrower
`test:organization`, `test:workspace`, `test:lifecycle`), or last in `npm run test:all`, one test at a
time, and every test restores the original values. In any other run they show as _skipped_, with that
reason. On CI they run after the regression suite.

**Why Settings → Wrap-Up runs one test at a time:** a workspace has a single wrap-up, so two tests
changing it at once would overwrite each other. Its tests have their own `workspace-settings` project
(one worker), which runs alongside the parallel tests in every normal run, and each test puts the
wrap-up back as it found it.

**Why the inbox conversation tests run one at a time:** `tests/inbox/conversation` and
`tests/inbox/instagram` all work on the one real Instagram conversation (see "Daily Instagram
message"). They have their own `inbox` project (one worker, UI and API), which runs alongside the
parallel tests in every normal run but not in the quick check. The `testConversation` fixture saves the
conversation's state (status, assignee, lifecycle, tags, follow-up) before each test and puts it back
afterwards. Notes cannot be deleted, so test notes stay on the conversation, marked `qa` + 6 digits.
Tests that need a second person (mentions, live updates) use the `agent` fixture: the Agent account in
a browser of its own, skipped without `TEST_AGENT_USERNAME` / `TEST_AGENT_PASSWORD`.

Every run starts with `tests/setup/auth.setup.ts`, which logs in once and saves the session for the other tests.
The permission tests (`tests/permissions`) start from `tests/setup/agent.setup.ts` instead, logged in as the
Agent. Writes the Agent may not make are sent with an empty body: the API checks the permission first, so
they answer 403 and nothing is created.

**Test data and the clean-up job:** every name the tests create carries a marker, `qa` and six digits
(e.g. `Botox qa482913`), made by `uniqueSuffix()` in `utils/testData.ts`. Tests delete their own data, but a
crashed or stopped run leaves some behind. `npm run test:sweep` (`tests/cleanup`) deletes it: only records
with the marker, only those older than 2 hours (so a run in progress keeps its data), and only in
`TEST_WORKSPACE` (it stops if the session is in any other workspace). CI runs it before every regression.
`npm run test:sweep:dry` lists what it would delete. Data from before the marker (before 2026-11-03) has no
marker and is not swept.

## Folder structure

| Folder                    | What's in it                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `tests/auth/`             | Login: UI (`login.spec.ts`) and API (`login.api.spec.ts`).                                                 |
| `tests/clinic/<feature>/` | Doctors, Treatments, Departments, Appointments, Billing: UI and API tests side by side.                    |
| `tests/settings/<page>/`  | Every automated Settings page (Organization, Members, Contact Fields, Wrap-Up, API Keys, …).               |
| `tests/contacts/`         | Contacts: list, create, row actions, side panel and segments (UI), and the contacts API.                   |
| `tests/inbox/<feature>/`  | Inbox: saved Views, conversation actions (`conversation/`) and the daily Instagram message (`instagram/`). |
| `tests/reports/`          | Reports: each report loads (UI) and answers (API); `numbers/` checks counts with seeded data (exclusive).  |
| `tests/broadcasts/`       | Broadcasts: list, search, status filter, New broadcast form up to validation. Never creates or sends one.  |
| `tests/workflows/`        | Workflows list: tiles, tabs, trigger filter, Live switch, duplicate, archive/restore (canvas is manual).   |
| `tests/sidebar/`          | Sidebar widgets: notification bell and panel, AI credits, account menu, search, links. Read only.          |
| `tests/setup/`            | Logs in once before the other tests and saves the session.                                                 |
| `pages/`                  | Page objects (`auth/`, `clinic/`, `settings/`, `contacts/`, `inbox/`): _how_ to use each page.             |
| `api/`                    | API clients: one small class per endpoint group, plus the field-name mapping to the UI forms.              |
| `fixtures/`               | The `test` that every spec imports, ready-made with page objects, API clients and cleanup.                 |
| `config/`                 | `env.ts`: the only place that reads `.env` (URLs, credentials, limits).                                    |
| `utils/`                  | Helpers: Faker test data, network recording/mocking, response timing.                                      |
| `reporters/`              | Writes a screenshot and plain-text summary of every failed test to `test-results/failures/`.               |
| `scripts/`                | `test-all.mjs`: runs the suite, then the exclusive tests on their own.                                     |
| `.github/`                | CI: smoke test, then the full suite, then the exclusive tests, on every push and PR.                       |

File names decide how a test runs: `*.api.spec.ts` runs in the `api` project, other `*.spec.ts` files in `ui`.

**Known app issues are marked with `test.fail()`.** Such a test checks the behaviour we expect, and its
reason says what the app does instead and when it was seen. It passes while the issue is there, and fails
(on purpose) once the app is fixed: then delete the `test.fail()` line.

## Adding tests for a feature

Every feature gets **both** UI tests (what a user sees and does) and API tests (what the server
accepts, stores and refuses). This walkthrough uses Clinic → Doctors, which follows every step.
Copy the starter files in [`templates/new-feature/`](templates/new-feature) to begin.

### 1. Put the files in the feature's folder

```text
tests/clinic/doctors/
  doctors.spec.ts       UI tests: run in the `ui` project
  doctors.api.spec.ts   API tests: the `.api.spec.ts` ending puts them in the `api` project
```

The folder is the area and the feature (`tests/<area>/<feature>/`). It names the failure screenshots
and the _Area_ column of the failed-tests sheet.

### 2. Describe the page in a page object (`pages/`)

A page object holds every locator and action for one page, so tests read like steps and a changed
button is fixed in one place. See `pages/clinic/DoctorsPage.ts`.

- One class per page, with a short JSDoc on each public method.
- Locators, in this order of preference: `getByRole` → `getByLabel` → `getByPlaceholder` →
  `getByText` → `getByTestId`. CSS only when nothing else works, with a comment saying why.
- Methods do things a user does (`openFromDashboard()`, `createRecord(data)`), and wait for the result
  (an API response or a visible change), never a fixed time.

### 3. Add an API client (`api/`)

Most endpoints list, create, update and delete records: extend `ResourceApi` and you get all of
that, plus `createRecord()` and `deleteIfExists()` for setup and cleanup. See `api/DoctorsApi.ts`:

- Add the path to `ENDPOINTS` in `api/ResourceApi.ts`.
- Write the request and response types, and a `to…Payload()` function that turns test data into the
  API's field names.

### 4. Register both in `fixtures/test.ts`

Add the page object and the client to the `Fixtures` type and to `test.extend`, next to
`doctorsPage` and `doctorsApi`. Tests then just ask for them: `async ({ doctorsPage, doctorsApi }) =>`.

### 5. Build test data (`utils/testData.ts`)

Add a `build…()` function that returns realistic data with a unique part, e.g.
`` name: `Dr. ${faker.person.lastName()} ${uniqueSuffix()}` ``, so parallel tests never collide.
Always use `uniqueSuffix()` in the name: its `qa` marker is how the clean-up job recognises test data. If the
feature is a new list, add it to `tests/cleanup/sweep-test-data.cleanup.ts` too.

### 6. Write the tests

```ts
import { test, expect } from '../../../fixtures/test';
import { toDoctorPayload } from '../../../api/DoctorsApi';
import { buildDoctor } from '../../../utils/testData';

test.describe('Clinic → Doctors', { tag: ['@clinic', '@doctors'] }, () => {
  test('should show a new doctor in the list', async ({ doctorsPage, doctorsApi, cleanup }) => {
    // Arrange through the API: it is fast. Register cleanup right away, so the test leaves nothing
    // behind even if it fails.
    const doctor = await test.step('create a doctor (through the API)', () =>
      doctorsApi.createRecord(toDoctorPayload(buildDoctor())));
    cleanup.add(`doctor ${doctor.id}`, () => doctorsApi.deleteIfExists(doctor.id));

    await test.step('open Clinic → Doctors', () => doctorsPage.openFromDashboard());
    await test.step('the doctor is listed', async () => {
      await expect(doctorsPage.rowFor(doctor.name)).toBeVisible();
    });
  });
});
```

- **Import `test` and `expect` from `fixtures/test`**, not from `@playwright/test`.
- **Name tests like sentences:** `should <expected result> when <action>`.
- **Write every step with `test.step('…')`.** Step names become the _Test steps_ and _Steps to
  reproduce_ in the failed-tests sheet, so write them for a person reading a bug report:
  `open Clinic → Doctors`, `the doctor is listed`.
- **Every test creates its own data and cleans it up** with `cleanup.add()`. Never rely on data a
  person or another test made.
- **Never use `waitForTimeout`.** Use `expect(...)`, which retries, or wait for an API response
  (`waitForApiResponse` in `utils/network.ts`).
- **Tags:** the area and feature on the `describe` (`@clinic`, `@doctors`). Add `@smoke` to the one
  test per area that proves the page works, for the quick check on every push.

What the API tests should cover, for each endpoint: create (201 and every field stored), list, get,
update, delete, validation (422 with the right message for missing or wrong fields) and a request
without a login token (401). `doctors.api.spec.ts` has all of them.

### 7. Special cases

| Situation                                                                | What to do                                                                                                                                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The test changes something the whole workspace shares (hours, SLAs, AI…) | Put it under one of the folders in `EXCLUSIVE_TESTS` in `playwright.config.ts` and call `runOnlyOnItsOwn()`; save the current value first and restore it with `cleanup.add()`. |
| A setting the workspace has only one of (like Wrap-Up)                   | Add the folder to `WORKSPACE_SETTINGS_TESTS`: those run one at a time next to the others.                                                                                      |
| The test finds a real bug in the app                                     | Add the bug to `scripts/known-bugs.json`, call `knownBug('<key>')` first thing in the test, and create its issue: `npm run known-bugs -- --create`. See "Known bugs".          |
| The test checks what a limited role may do                               | Put it in `tests/permissions`: it runs logged in as the Agent account.                                                                                                         |
| The test fails now and then for reasons outside the app                  | Fix it. While you do, tag it `@quarantine`. See "Flaky tests".                                                                                                                 |

### 8. Run it

```bash
npx playwright test tests/clinic/doctors              # the whole feature, UI and API
npx playwright test tests/clinic/doctors --headed     # watch the browser
npx playwright test -g "new doctor"                   # one test, by part of its name
npx playwright test tests/clinic/doctors --ui         # step through it in Playwright's UI mode
npx playwright show-trace test-results/<folder>/trace.zip   # replay a failure
```

### 9. Checklist before you commit

- [ ] UI tests **and** API tests for the feature.
- [ ] `npm run typecheck` and `npm run format:check` pass.
- [ ] The new tests pass **3 times in a row**: `npx playwright test tests/<area>/<feature> --repeat-each=3`.
- [ ] Nothing is left behind: after a run, the records the tests created are gone from the app.
- [ ] Step names read like a bug report, and the test name says what should happen.

## Viewing the report

After any run:

```bash
npm run report
```

This opens the HTML report: each test with its steps, and for failures a screenshot, a trace you can
step through, and the error. On CI, download the `<suite>-report` artifact (e.g. `regression-report`) from the
workflow run, unzip it, and run `npx playwright show-report <folder>`.

### Failure screenshots

Every failed test also gets a screenshot and a plain-text summary in `test-results/failures/`, named after
**where** it failed: `<feature folder>__<test name>__<project>__attempt-<n>`. For example:

```text
test-results/failures/
  clinic-doctors__should-save-every-field-when-user-creates-a-doctor__ui__attempt-1.png
  clinic-doctors__should-save-every-field-when-user-creates-a-doctor__ui__attempt-1.txt
```

The `.txt` file holds the error, the test's file and line, and the path of its trace. On CI these are inside the
`*-test-results` artifact. Passing `--reporter=...` on the command line replaces the configured reporters, so
leave it out if you want these files.

### Failed tests sheet

After every run, each failed test is written to a shared Google Sheet (tab **Failed tests**) as a test case:
test steps (with the failing one marked), steps to reproduce, expected and actual result, the error, the source
line and where to find the screenshot or the CI run.

- **One row per test.** If it fails again later, the same row is updated: _Last failed_, _Times failed_ and the
  latest error. _First failed_ and the two "fill in" columns (_Bug status_, _Notes_) are never overwritten.
- A failed row whose test passes on a later run is marked **Passing again**.
- Known bugs marked with `test.fail()` are not added; a test that passes on retry is added as **Flaky**.
- A problem with the sheet only prints a warning; it never fails the run.

One-time setup:

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (any name), then open
   **APIs & Services → Library**, search **Google Sheets API** and click **Enable**.
2. **APIs & Services → Credentials → Create credentials → Service account**: give it a name (e.g.
   `replyn-tests`) and click **Done**. Open it, go to **Keys → Add key → Create new key → JSON**. A `.json` file
   downloads: this is a password, never commit it.
3. Save it as `secrets/google-service-account.json` in this project (`secrets/` is ignored by git).
4. Create a Google Sheet, click **Share** and add the service account's email (the `client_email` in the
   `.json` file, ending in `iam.gserviceaccount.com`) as **Editor**.
5. In `.env`, set `FAILED_TESTS_SHEET_ID` to the long id in the sheet's link
   (`docs.google.com/spreadsheets/d/<id>/edit`) and
   `GOOGLE_SERVICE_ACCOUNT_KEY_FILE=secrets/google-service-account.json`.
6. For GitHub Actions: in the repository, **Settings → Secrets and variables → Actions**: add a **secret**
   `GOOGLE_SERVICE_ACCOUNT_KEY` with the whole content of the `.json` file, and a **variable**
   `FAILED_TESTS_SHEET_ID` with the sheet id.

To see the rows without touching the sheet, set `FAILED_TESTS_SHEET_DRY_RUN=true`: they are written to
`test-results/failed-tests-sheet.json` instead.

### Flaky tests

CI retries a failed test twice. A test that fails and then passes on a retry is **flaky**: the run
stays green, but the GitHub summary and the failed-tests sheet list it.

A test that keeps failing for reasons outside the feature (timing, the shared beta server) can be
quarantined while it is fixed: add the `@quarantine` tag and a comment saying why and since when.

```ts
// Quarantined 2026-11-02: the picker sometimes opens empty on CI. Fix by 2026-11-09.
test('should …', { tag: '@quarantine' }, async ({ … }) => { … });
```

Quarantined tests are left out of every normal run, so they cannot turn the daily run red. They
still run every day, right after the regression on CI, and their failures only warn (and go to the
sheet). Run them locally with `npm run test:quarantine`. Fix the test within a week, then remove
the tag. Never quarantine a test because the app has a bug: mark that with `knownBug()` instead.

### GitHub summary

On GitHub Actions, every run's summary page shows a table: passed, failed, flaky, known bugs and
skipped, then each failed and flaky test with its first error line and source.

### After a deploy

The daily run only tests once a day, so a bad deploy could stay broken until the next morning. Add
this as the last step of the deploy to beta, to run the quick check (smoke and API tests) straight away:

```sh
curl -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  -d '{"ref":"main","inputs":{"suite":"quick"}}' \
  https://api.github.com/repos/Anweshan560/replyn/actions/workflows/playwright.yml/dispatches
```

`GITHUB_TOKEN` is a fine-grained token for this repository with Actions read and write access, kept
as a secret in the deploy pipeline. It answers 204 when the run has started. Failures alert as below.

### Alerts

Scheduled and hand-started runs on `main` report problems as GitHub issues, and GitHub emails people
watching the repository. Each kind of alert has one issue: the first alert opens it, and later ones
comment on it until someone closes it.

| Label                        | When                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| `ci-alert-failed`            | The run failed or was cancelled.                                       |
| `ci-alert-flaky`             | The run passed, but tests needed a retry. The comments show how often. |
| `ci-alert-missed`            | No run started by 09:00 Nepal time, e.g. the 06:30 job was turned off. |
| `ci-alert-instagram-session` | Instagram ended the sender's session. See "Daily Instagram message".   |
| `ci-alert-instagram-send`    | The daily Instagram message failed for another reason.                 |

The repository is public, so alerts hold only a link and a count. To check that alerts reach you, open
**Actions > Daily Run Watchdog > Run workflow** and tick `test_alert`.

cron-job.org starts the watchdog at 09:00 Nepal time, as it does the daily run, because GitHub's own
timer ran hours late or not at all. Both jobs use the same token, so if it expires neither can start
and no issue opens. Keep cron-job.org's failure emails on for both jobs: they are the alert for that.

### Daily Instagram message

The inbox tests in `tests/inbox/instagram` and `tests/inbox/conversation` need a real Instagram conversation. A throwaway
Instagram account (the "sender") sends one every morning to the Instagram account connected to the
test workspace (the "receiver", a Professional account). The tests then find it in the inbox, reply
from Replyn and wait until Instagram reports the reply delivered. Instagram only allows replies within
24 hours of the person's last message, so the tests use the newest `AUTOTEST` message from the last 24
hours. If there is none, they fail and point here. The conversation tests (assign, close, snooze,
notes…) send nothing to Instagram, so they only need the conversation to exist.

What is sent to the sender's Instagram on each run: the UI and API reply tests (2 texts) and the image
test (1 image). Images must be a normal size: Instagram refuses tiny ones (the 70-byte
`tests/assets/sample.png` fails with error 100), so the test sends `tests/assets/inbox-image.jpg`.

| What                               | Where                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------ |
| Log in as the sender, save session | `npm run instagram:login` (visible browser, answer any code prompt)      |
| Send today's message by hand       | `npm run instagram:send -- --headed`                                     |
| The daily send                     | `.github/workflows/instagram-sender.yml`, started by cron-job.org        |
| The session                        | `secrets/instagram-sender.json` (git-ignored), `IG_SENDER_SESSION` on CI |

Locally `.env` holds `IG_SENDER_USERNAME`, `IG_SENDER_PASSWORD` and `IG_RECEIVER_HANDLE`. CI needs
only two repository secrets: `IG_SENDER_SESSION` (the contents of
`secrets/instagram-sender.json.base64.txt`, written by `instagram:login`) and `IG_RECEIVER_HANDLE`. The
password never leaves your machine.

cron-job.org starts **Instagram Sender** at 06:15 Nepal time, before the 06:30 daily run, the same way
as the daily run (POST to `.../actions/workflows/instagram-sender.yml/dispatches` with `{"ref":"main"}`).
There is deliberately no GitHub schedule as a backup: a late duplicate would send a second message.

**When Instagram ends the session** (every few weeks, or after a "suspicious login" check), the run
fails and opens a `ci-alert-instagram-session` issue. Run `npm run instagram:login`, paste the new
base64 file into the `IG_SENDER_SESSION` secret, re-run the workflow and close the issue.

Automating a personal Instagram account is against Instagram's terms, so the sender must stay a
throwaway account that sends one message a day. If it gets banned, create a new one, message the
receiver once by hand, update `.env` and log in again. Never automate the receiver.

### Known bugs

When a test finds a real bug in the app, the test stays as it is (it checks the correct behaviour)
and is marked as hitting a known bug, so the run stays green:

```ts
test('should reject an empty workspace name with 422', async ({ workspaceApi }) => {
  knownBug('workspace-empty-name');
  …
});
```

Every known bug is described once in [`scripts/known-bugs.json`](scripts/known-bugs.json): title,
date found, steps to reproduce, expected and actual result, the tests that check it, and its GitHub
issue. To add one, add an entry there, call `knownBug('<key>')` first thing in the test, and create
the issue:

```bash
npm run known-bugs                         # list every known bug and its issue
npm run known-bugs -- --create --dry-run   # show the issues that would be created
npm run known-bugs -- --create             # create them (GitHub CLI: winget install GitHub.cli, gh auth login)
```

**When the bug is fixed**, its test passes, and the run says so: the GitHub summary lists it under
"Known bugs that now pass" and the failed-tests sheet marks it **Known bug fixed?**. Check the
issue, close it, remove the `knownBug(...)` line and the entry in `known-bugs.json`: from then on the
test guards against the bug coming back.
