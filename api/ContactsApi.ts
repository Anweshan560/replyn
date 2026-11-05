/**
 * Clients for the Contacts page: contacts themselves, the segments (saved filters) in its left panel,
 * and the lifecycle stages a contact moves through.
 */
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { ENDPOINTS, ResourceApi, type HeadersProvider } from './ResourceApi';
import { sendTimed } from '../utils/timing';
import type { ContactData } from '../utils/testData';

// --- Contacts ---------------------------------------------------------------------------------

/** Where a contact came from: the create dialog's Origin. */
export type ContactOrigin = 'manual' | 'referral' | 'emr';

/** Request body for POST and PATCH /v1/contacts. */
export type ContactPayload = {
  firstName?: string;
  lastName?: string;
  /** International format, e.g. "+971501234567". */
  phone?: string;
  email?: string;
  address?: string;
  lifecycleId?: string;
  origin?: ContactOrigin;
  /** The dialog's "Referred by"; required by the UI when the origin is a referral. */
  referredByName?: string;
  /** Tag ids. */
  tags?: string[];
  treatmentIds?: string[];
  blocked?: boolean;
  /** Opt the contact out of broadcasts, or back in. The API answers with `optedOutAt`. */
  optedOut?: boolean;
  /** "closed" resolves the conversation, "open" reopens it. */
  status?: 'open' | 'closed';
  /** Sent with status "closed", as the Resolve dialog does. */
  closingNote?: ContactClosingNote;
};

/** What the Resolve dialog sends: the closing note category and a summary. */
export type ContactClosingNote = { topicId: string; topicName: string; summary: string };

/** Request body for POST /v1/contacts/<id>/activity, e.g. a note from the side panel. */
export type ContactActivityPayload = {
  type?: string;
  payload?: { text: string };
  mentioned?: string[];
};

/** One entry of a contact's timeline. */
export type ContactEvent = {
  contactId: string;
  activity?: { type: string; payload: Record<string, unknown> | null };
};

/** A contact as the API returns it (only the fields the tests use). */
export type Contact = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  lifecycleId: string;
  origin: ContactOrigin | null;
  referredByName: string | null;
  tags: string[];
  treatmentIds: string[];
  blocked: boolean;
  /** When the contact was opted out of broadcasts; null while they still receive them. */
  optedOutAt: string | null;
  /** "closed" once the conversation is resolved. */
  status: 'open' | 'closed';
  lastClosingNoteId: string | null;
};

/** A filter rule, as the list's stage links, the Filters dialog and saved segments send it. */
export type FilterRule = { field: string; operator: string; value: unknown; valueSource?: 'value' };

/** Request body for POST /v1/contacts/search. Every field is optional. */
export type ContactSearch = {
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  filter?: { rules: FilterRule[] };
};

/** One page of search results. */
export type ContactSearchResult = {
  result: Contact[];
  meta: { count: number; currentPage: number; nextPage: number | null; previousPage: number | null };
};

/** Convert test data to the API's fields. */
export function toContactPayload(contact: ContactData): ContactPayload {
  return {
    firstName: contact.firstName,
    lastName: contact.lastName,
    phone: contact.phone,
    email: contact.email,
    address: contact.address,
  };
}

/** The contact's name as the list, the side panel and the Filters preview show it. */
export function fullName(contact: Pick<ContactData, 'firstName' | 'lastName'>): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ');
}

/** Client for the contacts endpoints. Create, get, update and delete come from ResourceApi. */
export class ContactsApi extends ResourceApi<ContactPayload, Contact> {
  constructor(request: APIRequestContext, headers: HeadersProvider) {
    super(request, headers, ENDPOINTS.contacts);
  }

  /** POST /v1/contacts/search: the list behind the Contacts page. Answers 201, not 200. */
  async search(body: ContactSearch): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request.post(`${this.url()}/search`, { headers, data: body }));
  }

  /** Search for test checks. Throws unless the API answers 201. */
  async searchRecords(body: ContactSearch): Promise<ContactSearchResult> {
    const response = await this.search(body);
    if (response.status() !== 201) {
      throw new Error(`POST ${this.path}/search returned ${response.status()}: ${await response.text()}`);
    }
    return (await response.json()).data;
  }

  /** GET the contact's timeline: notes, stage changes and other activity. */
  async events(id: string): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request.get(this.url(`${id}/events`), { headers }));
  }

  /** The timeline for test checks, newest first. Throws unless the API answers 200. */
  async eventRecords(id: string): Promise<ContactEvent[]> {
    const response = await this.events(id);
    if (response.status() !== 200) {
      throw new Error(`GET ${this.path}/${id}/events returned ${response.status()}: ${await response.text()}`);
    }
    return (await response.json()).data.result;
  }

  /** POST to the contact's timeline: how the side panel saves a note. */
  async addActivity(id: string, body: ContactActivityPayload): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request.post(this.url(`${id}/activity`), { headers, data: body }));
  }

  /** GET where the contact came from (origin, who added them, referral details). */
  async origin(id: string): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request.get(this.url(`${id}/origin`), { headers }));
  }
}

// --- Segments ---------------------------------------------------------------------------------

/** Request body for POST /v1/segments. */
export type SegmentPayload = { name?: string; filter?: { rules: FilterRule[] } };

export type Segment = { id: string; name: string; filter: { rules: FilterRule[] } };

/** A rule matching contacts whose first name contains `text`, as the Filters dialog builds it. */
export function firstNameContains(text: string): FilterRule {
  return { field: 'firstName', operator: 'contains', valueSource: 'value', value: text };
}

/** Segments update with PUT; PATCH answers 404. */
export class SegmentsApi extends ResourceApi<SegmentPayload, Segment> {
  constructor(request: APIRequestContext, headers: HeadersProvider) {
    super(request, headers, ENDPOINTS.segments, 'PUT');
  }
}

// --- Lifecycle stages -------------------------------------------------------------------------

/** A lifecycle stage, e.g. "Hot Lead", with how many contacts are in it. */
export type Lifecycle = {
  id: string;
  name: string;
  emoji: string;
  /** Position within its group: 1 is the first stage. */
  stage: number;
  /**
   * "lead" for the pipeline's stages; "lost" for the ones the card view folds away under "Lost
   * stages" (e.g. Cold Lead, even though its isLost is false).
   */
  type: 'lead' | 'lost';
  isDefault: boolean;
  isWon: boolean;
  isLost: boolean;
  isSpam: boolean;
  contactCount: number;
};

/** A stage as Settings → Lifecycle creates or renames it. */
export type LifecyclePayload = {
  name?: string;
  emoji?: string;
  description?: string;
  /** Position within its group: 1 is the first stage. */
  stage?: number;
  type?: Lifecycle['type'];
};

/**
 * Lifecycle stages. Listing needs `?contactCount=` (see stagesWithCounts). Settings → Lifecycle
 * creates, renames and deletes them; contacts tests read them, so tests that change stages run
 * in the exclusive project.
 */
export class LifecyclesApi extends ResourceApi<LifecyclePayload, Lifecycle> {
  constructor(request: APIRequestContext, headers: HeadersProvider) {
    super(request, headers, ENDPOINTS.lifecycles);
  }

  /** Every stage with its contact count. */
  async stagesWithCounts(): Promise<Lifecycle[]> {
    const headers = await this.headers();
    const response = await this.request.get(this.url(), { headers, params: { contactCount: true } });
    if (!response.ok()) throw new Error(`GET ${this.path} returned ${response.status()}`);
    return (await response.json()).data;
  }

  /** Every stage. The plain list answers 400 without `?contactCount=`, so this asks for counts. */
  override listRecords(): Promise<Lifecycle[]> {
    return this.stagesWithCounts();
  }

  /** The pipeline's stages, in order: the card view's columns (lost stages are folded away). */
  async openStages(): Promise<Lifecycle[]> {
    return (await this.stagesWithCounts())
      .filter((stage) => stage.type === 'lead')
      .sort((a, b) => a.stage - b.stage);
  }

  /** The stage called `name`, e.g. "Hot Lead". */
  async byName(name: string): Promise<Lifecycle> {
    const stage = (await this.stagesWithCounts()).find((candidate) => candidate.name === name);
    if (!stage) throw new Error(`No lifecycle stage called "${name}"`);
    return stage;
  }
}
