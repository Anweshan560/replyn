import type { APIRequestContext, APIResponse } from '@playwright/test';
import { env } from '../config/env';
import { sendTimed } from '../utils/timing';

/** Paths of the app's API endpoints, relative to `env.apiUrl`. */
export const ENDPOINTS = {
  departments: '/v1/clinics/departments',
  doctors: '/v1/clinics/doctors',
  treatments: '/v1/clinics/treatments',
  appointments: '/v1/clinics/appointments',
  /** Billing: the ledger; `/patients` and `/review` hang off it. */
  billing: '/v1/clinics/billing',
  /** A patient's billing: `/v1/clinics/contacts/<id>/billing` and `/advances`. */
  clinicContacts: '/v1/clinics/contacts',
  websites: '/v1/websites',
  tags: '/v1/tags',
  closingNotes: '/v1/closing-notes',
  snippets: '/v1/snippets',
  savedFiles: '/v1/saved-files',
  contacts: '/v1/contacts',
  segments: '/v1/segments',
  lifecycles: '/v1/lifecycles',
  /** Archived fields are listed at `/archived`; a field is restored or purged at `/<id>/restore` and `/<id>/permanent`. */
  contactFields: '/v1/contact-fields',
  outcomeReasons: '/v1/outcome-reasons',
  /** The workspace's wrap-up: one record whose `config` holds every outcome. */
  wrapUp: '/v1/wrap-up',
  apiKeys: '/v1/api-keys',
  /** Webhooks are delivered by Svix; the event types are listed at `/v1/webhooks/event-types`. */
  webhookEndpoints: '/v1/webhooks/endpoints',
  webhookEventTypes: '/v1/webhooks/event-types',
  /** Inbox saved views. */
  customViews: '/v1/custom-views',
  /** DELETE archives a workflow; `/<id>/activate`, `/deactivate`, `/restore`, `/analytics`. */
  workflows: '/v1/workflows',
  broadcasts: '/v1/broadcasts',
  channels: '/v1/channels',
  notificationsFeed: '/v1/notifications/feed',
  credits: '/v1/credits',
  availability: '/v1/availability/workspace',
  me: '/v1/users/me',
  /** Teams belong to a workspace. */
  teams: (workspaceId: string) => `/v1/workspaces/${workspaceId}/teams`,
} as const;

/** Returns the auth + workspace headers. Called per request because login tokens last only 60s. */
export type HeadersProvider = () => Promise<Record<string, string>>;

/**
 * List / get / create / update / delete for one REST resource of the app's API.
 * The plain methods return the raw response, so tests can check status codes, including errors,
 * and response times through responseTimeMs().
 * The `...Record` helpers are for test setup and cleanup, and throw if the API misbehaves.
 */
export class ResourceApi<TPayload extends object, TRecord extends { id: string }> {
  constructor(
    protected readonly request: APIRequestContext,
    protected readonly headers: HeadersProvider,
    /** API path of the list, e.g. "/v1/websites". */
    readonly path: string,
    /** Most endpoints update with PATCH; a few (e.g. tags) use PUT. */
    private readonly updateMethod: 'PATCH' | 'PUT' = 'PATCH',
  ) {}

  /** GET the list; paginated endpoints (e.g. websites) take a page number. */
  async list(page?: number): Promise<APIResponse> {
    const headers = await this.headers();
    // Page 1 is the default; leave it off so unpaginated endpoints get the same request as ever.
    const params = page && page > 1 ? { page } : undefined;
    return sendTimed(() => this.request.get(this.url(), { headers, params }));
  }

  /** GET one record by id. */
  async get(id: string): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request.get(this.url(id), { headers }));
  }

  /** POST a new record. */
  async create(payload: TPayload): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request.post(this.url(), { headers, data: payload }));
  }

  /** Update a record by id (PATCH or PUT, depending on the endpoint). */
  async update(id: string, payload: Partial<TPayload>): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() =>
      this.request.fetch(this.url(id), { method: this.updateMethod, headers, data: payload }),
    );
  }

  /** DELETE a record by id. */
  async delete(id: string): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request.delete(this.url(id), { headers }));
  }

  /**
   * Every record in the list. Most endpoints answer with a plain array; paginated ones
   * (e.g. websites, 10 per page) answer `{ result, meta: { nextPage } }`, so walk every page.
   */
  async listRecords(): Promise<TRecord[]> {
    const records: TRecord[] = [];
    let page: number | null = 1;
    while (page) {
      const data: TRecord[] | { result: TRecord[]; meta: { nextPage: number | null } } = (
        await (await this.list(page)).json()
      ).data;
      if (Array.isArray(data)) return data;
      records.push(...data.result);
      page = data.meta.nextPage;
    }
    return records;
  }

  /**
   * One record, found in the list. For endpoints without GET by id (e.g. contact fields).
   * @returns undefined if the list doesn't contain it
   */
  async findRecord(id: string): Promise<TRecord | undefined> {
    return (await this.listRecords()).find((record) => record.id === id);
  }

  /** Create a record for test setup and return it. Throws unless the API answers 201. */
  async createRecord(payload: TPayload): Promise<TRecord> {
    const response = await this.create(payload);
    if (response.status() !== 201) {
      throw new Error(
        `Setup failed: POST ${this.path} returned ${response.status()}: ${await response.text()}`,
      );
    }
    return (await response.json()).data;
  }

  /**
   * Delete a record during cleanup. Passes if it was deleted now or was already gone.
   * A successful delete answers 200 on most endpoints and 204 on some (e.g. websites).
   */
  async deleteIfExists(id: string): Promise<void> {
    const response = await this.delete(id);
    if (!response.ok() && response.status() !== 404) {
      throw new Error(`DELETE ${this.path}/${id} returned ${response.status()}`);
    }
  }

  protected url(id?: string): string {
    return `${env.apiUrl}${this.path}${id ? `/${id}` : ''}`;
  }
}
