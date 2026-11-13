import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../../fixtures/test';
import { env, getAgentCredentials } from '../../config/env';
import { ENDPOINTS, type HeadersProvider } from '../../api/ResourceApi';
import { toSnippetPayload } from '../../api/SettingsApis';
import { toCustomViewPayload } from '../../api/CustomViewsApi';
import { buildSavedView, buildSnippet } from '../../utils/testData';
import { knownBug } from '../../utils/knownBug';

// These tests run logged in as the limited test account (role "Agent"), see tests/setup/agent.setup.ts.
//
// Writes the Agent may not make are sent with an empty body. The API checks the permission before
// it checks the body, so a guarded endpoint answers 403 and nothing is ever created. If a guard
// goes missing, the empty body is rejected as invalid (422) instead, so the test fails without
// leaving data behind.

/** Every permission the built-in Agent role has (GET /v1/users/me → access.permissions). */
const AGENT_PERMISSIONS = [
  'contacts.view',
  'contacts.edit',
  'conversations.assign',
  'appointments.view',
  'appointments.edit',
  'payments.edit',
  'orders.view',
  'orders.edit',
  'replies.manage',
  'replies.delete',
  'views.create',
];

/** An id no record has, for update and delete checks: a forbidden call answers 403, not 404. */
const UNKNOWN_ID = '01a1a056-0000-7000-8000-000000000000';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

test.describe('Permissions: Agent on the API', { tag: ['@permissions'] }, () => {
  test.skip(!getAgentCredentials(), 'TEST_AGENT_USERNAME and TEST_AGENT_PASSWORD are not set');

  /** Send one call as the Agent; writes carry an empty body. */
  async function send(
    { request, apiHeaders }: { request: APIRequestContext; apiHeaders: HeadersProvider },
    method: Method,
    path: string,
  ) {
    return request.fetch(`${env.apiUrl}${path}`, {
      method,
      headers: await apiHeaders(),
      data: method === 'GET' || method === 'DELETE' ? undefined : {},
    });
  }

  test('should log in as an Agent with exactly the Agent permissions', async ({ request, apiHeaders }) => {
    const response = await test.step('GET /v1/users/me', () =>
      send({ request, apiHeaders }, 'GET', '/v1/users/me'));

    // If this fails, the test account's role was changed, and the other results mean nothing.
    await test.step('role "Agent", and only the Agent permissions', async () => {
      expect(response.status()).toBe(200);
      const { access } = (await response.json()).data;
      expect(access).toMatchObject({ roleId: 'workspace:agent', organizationRole: 'organization:member' });
      expect([...access.permissions].sort()).toEqual([...AGENT_PERMISSIONS].sort());
    });
  });

  test('should let an Agent read contacts, appointments, tags and snippets', async ({
    request,
    apiHeaders,
  }) => {
    const today = new Date().toISOString().slice(0, 10);
    for (const path of [
      `${ENDPOINTS.contacts}?limit=1`,
      `${ENDPOINTS.appointments}?startDate=${today}T00:00:00.000Z&endDate=${today}T23:59:59.999Z`,
      ENDPOINTS.tags,
      ENDPOINTS.snippets,
    ]) {
      const response = await test.step(`GET ${path}`, () => send({ request, apiHeaders }, 'GET', path));
      expect(response.status(), `GET ${path}`).toBe(200);
    }
  });

  test('should let an Agent add and delete a snippet (replies.manage, replies.delete)', async ({
    snippetsApi,
    cleanup,
  }) => {
    const snippet = buildSnippet();

    const created = await test.step('POST a snippet', () => snippetsApi.create(toSnippetPayload(snippet)));
    const body = await created.json();
    if (body.data?.id) cleanup.add(`snippet ${snippet.name}`, () => snippetsApi.deleteIfExists(body.data.id));

    await test.step('responds 201', () => expect(created.status()).toBe(201));

    const deleted = await test.step('DELETE it', () => snippetsApi.delete(body.data.id));
    await test.step('responds 200', () => expect(deleted.ok()).toBe(true));
  });

  test('should not let an Agent read API keys, webhooks or the billing ledger', async ({
    request,
    apiHeaders,
  }) => {
    for (const path of [ENDPOINTS.apiKeys, ENDPOINTS.webhookEndpoints, ENDPOINTS.billing]) {
      const response = await test.step(`GET ${path}`, () => send({ request, apiHeaders }, 'GET', path));
      expect(response.status(), `GET ${path}`).toBe(403);
    }
  });

  test('should not let an Agent create clinic records or settings', async ({
    request,
    apiHeaders,
    workspaceId,
  }) => {
    for (const path of [
      ENDPOINTS.doctors,
      ENDPOINTS.treatments,
      ENDPOINTS.departments,
      ENDPOINTS.tags,
      ENDPOINTS.closingNotes,
      ENDPOINTS.websites,
      ENDPOINTS.contactFields,
      ENDPOINTS.outcomeReasons,
      ENDPOINTS.wrapUp,
      ENDPOINTS.lifecycles,
      ENDPOINTS.apiKeys,
      ENDPOINTS.webhookEndpoints,
      ENDPOINTS.teams(workspaceId),
    ]) {
      const response = await test.step(`POST ${path}`, () => send({ request, apiHeaders }, 'POST', path));
      expect(response.status(), `POST ${path}`).toBe(403);
    }
  });

  test('should not let an Agent manage roles, members or invitations', async ({
    request,
    apiHeaders,
    workspaceId,
  }) => {
    for (const path of [
      `/v1/workspaces/${workspaceId}/roles`,
      `/v1/workspaces/${workspaceId}/users`,
      '/v1/organizations/invite-user',
    ]) {
      const response = await test.step(`POST ${path}`, () => send({ request, apiHeaders }, 'POST', path));
      expect(response.status(), `POST ${path}`).toBe(403);
    }
  });

  test('should not let an Agent change the organization, SLAs or assignment rules', async ({
    request,
    apiHeaders,
    workspaceId,
    organizationApi,
  }) => {
    const organization = await organizationApi.current();
    for (const [method, path] of [
      ['PATCH', `/v1/organizations/${organization.id}`],
      ['PUT', `/v1/workspaces/${workspaceId}/slas`],
      ['PATCH', '/v1/workspace-assignments'],
    ] as const) {
      const response = await test.step(`${method} ${path}`, () =>
        send({ request, apiHeaders }, method, path));
      expect(response.status(), `${method} ${path}`).toBe(403);
    }
  });

  test('should not let an Agent change the workspace settings', async ({
    request,
    apiHeaders,
    workspaceId,
  }) => {
    knownBug('agent-can-update-workspace');
    const path = `/v1/workspaces/${workspaceId}`;

    const response = await test.step(`PATCH ${path} (empty body)`, () =>
      send({ request, apiHeaders }, 'PATCH', path));

    await test.step('responds 403', () => expect(response.status()).toBe(403));
  });

  test('should not let an Agent delete contacts, doctors or tags, or edit doctors', async ({
    request,
    apiHeaders,
  }) => {
    for (const [method, path] of [
      ['DELETE', `${ENDPOINTS.contacts}/${UNKNOWN_ID}`],
      ['DELETE', `${ENDPOINTS.doctors}/${UNKNOWN_ID}`],
      ['PATCH', `${ENDPOINTS.doctors}/${UNKNOWN_ID}`],
      ['DELETE', `${ENDPOINTS.tags}/${UNKNOWN_ID}`],
    ] as const) {
      const response = await test.step(`${method} ${path}`, () =>
        send({ request, apiHeaders }, method, path));
      expect(response.status(), `${method} ${path}`).toBe(403);
    }
  });

  test('should not let an Agent delete conversations, appointments or orders, or export contacts', async ({
    request,
    apiHeaders,
  }) => {
    // Unticked for the Agent: Conversations → Delete, Appointments → Delete, Orders → Delete,
    // Contacts → Export.
    for (const [method, path] of [
      ['DELETE', `${ENDPOINTS.conversations}/${UNKNOWN_ID}`],
      ['DELETE', `${ENDPOINTS.appointments}/${UNKNOWN_ID}`],
      ['DELETE', `${ENDPOINTS.orders}/${UNKNOWN_ID}`],
      ['POST', ENDPOINTS.segmentExports],
    ] as const) {
      const response = await test.step(`${method} ${path}`, () =>
        send({ request, apiHeaders }, method, path));
      expect(response.status(), `${method} ${path}`).toBe(403);
    }
  });

  test('should not let an Agent list, read, add, change, comment on or delete tickets', async ({
    request,
    apiHeaders,
  }) => {
    // The Agent role has no Tickets permission at all.
    for (const [method, path] of [
      ['GET', ENDPOINTS.tickets],
      ['GET', `${ENDPOINTS.tickets}/${UNKNOWN_ID}`],
      ['POST', ENDPOINTS.tickets],
      ['PATCH', `${ENDPOINTS.tickets}/${UNKNOWN_ID}`],
      ['POST', `${ENDPOINTS.tickets}/${UNKNOWN_ID}/comments`],
      ['DELETE', `${ENDPOINTS.tickets}/${UNKNOWN_ID}`],
    ] as const) {
      const response = await test.step(`${method} ${path}`, () =>
        send({ request, apiHeaders }, method, path));
      expect(response.status(), `${method} ${path}`).toBe(403);
    }
  });

  test('should let an Agent add, rename and delete a view only they see (views.create)', async ({
    customViewsApi,
    cleanup,
  }) => {
    const view = { ...buildSavedView(), share: 'Just me' as const };

    const created = await test.step('POST a "Just me" view: responds 201', async () => {
      const response = await customViewsApi.create(toCustomViewPayload(view));
      const body = await response.json();
      if (body.data?.id) cleanup.add(`view ${view.name}`, () => customViewsApi.deleteIfExists(body.data.id));
      expect(response.status()).toBe(201);
      return body.data;
    });
    await test.step('rename it: responds 200', async () => {
      expect((await customViewsApi.update(created.id, { name: buildSavedView().name })).status()).toBe(200);
    });
    await test.step('delete it: responds 200', async () => {
      expect((await customViewsApi.delete(created.id)).status()).toBe(200);
    });
  });

  test('should not let an Agent share a view with everyone (no views.share)', async ({
    customViewsApi,
    cleanup,
  }) => {
    const refusal = 'Your role can only make views for yourself';

    await test.step('POST an "Everyone" view: responds 403', async () => {
      const view = { ...buildSavedView(), share: 'Everyone' as const };
      const response = await customViewsApi.create(toCustomViewPayload(view));
      const body = await response.json();
      if (body.data?.id) cleanup.add(`view ${view.name}`, () => customViewsApi.deleteIfExists(body.data.id));
      expect(response.status()).toBe(403);
      expect(body.message).toBe(refusal);
    });
    await test.step('share their own "Just me" view: responds 403', async () => {
      const view = await customViewsApi.createRecord(
        toCustomViewPayload({ ...buildSavedView(), share: 'Just me' }),
      );
      cleanup.add(`view ${view.name}`, () => customViewsApi.deleteIfExists(view.id));
      const response = await customViewsApi.update(view.id, { visibility: 'workspace' });
      expect(response.status()).toBe(403);
      expect((await response.json()).message).toBe(refusal);
    });
  });
});
