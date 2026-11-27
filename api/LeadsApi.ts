/**
 * Clients for Leads and Settings → Lead stages. A lead is one sales attempt with a contact: it
 * opens in a stage (New, or Booked when a visit is booked), moves through the Open stages, and
 * ends in Won, Lost or Disqualified. Stages can ask for values (e.g. a Lost reason) or a
 * follow-up date before a lead may move into them.
 */
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { env } from '../config/env';
import { sendTimed } from '../utils/timing';
import type { HeadersProvider } from './ResourceApi';

export const LEAD_ENDPOINTS = {
  leads: '/v1/leads',
  stages: '/v1/lead-stages',
  fields: '/v1/lead-fields',
} as const;

/** Where a stage sits: New, the Open stages, or one of the ways a lead ends. */
export type LeadStageCategory = 'new' | 'open' | 'won' | 'lost' | 'disqualified';

export type LeadStage = {
  id: string;
  name: string;
  /** Stable name of a built-in stage, e.g. "in_touch". */
  key: string;
  category: LeadStageCategory;
  position: number;
  description: string;
  isDefault: boolean;
  hiddenAt: string | null;
  /** Lead fields asked for when moving here; a required one must be filled in. */
  asks: { fieldKey: string; required: boolean }[];
  /** Whether moving here needs a follow-up date. */
  followUp: 'none' | 'optional' | 'required';
  /** Events that move a lead here by itself, e.g. "booked" or "attended". */
  autoMoves: string[];
  leadCount: number;
};

/** A field a stage can ask for, e.g. "Lost reason" with its options. */
export type LeadField = {
  id: string;
  key: string;
  label: string;
  type: string;
  options: { id: string; label: string; archived: boolean }[];
};

export type Lead = {
  id: string;
  contactId: string;
  contact: { id: string; name: string; phone: string | null };
  stageId: string;
  /** The stage it was in before it ended. */
  endedFromStageId: string | null;
  source: string;
  /** What opened it: "manual" (New lead), "booking", "chat"... */
  openedFrom: string;
  openedBy: string;
  createdByUserId: string | null;
  /** Values the stages asked for, e.g. { lost_reason: { option: "<id>" } }. */
  values: Record<string, unknown>;
  followUpAt: string | null;
  openedAt: string;
  endedAt: string | null;
};

/** Request body for POST /v1/leads/<id>/move. */
export type LeadMove = {
  stageId?: string;
  followUpAt?: string;
  /** Answers to the stage's asks, by field key; a list field takes the option id. */
  values?: Record<string, string>;
};

/** POST /v1/leads/counts: how many leads in each status. */
export type LeadCounts = Record<'all' | LeadStageCategory, number>;

export class LeadsApi {
  constructor(
    private readonly request: APIRequestContext,
    private readonly headers: HeadersProvider,
  ) {}

  /** POST a lead for a contact ("New lead"); it opens in the default stage. */
  async create(contactId: string): Promise<APIResponse> {
    return this.send('post', LEAD_ENDPOINTS.leads, { contactId });
  }

  async createRecord(contactId: string): Promise<Lead> {
    return this.data(await this.create(contactId), 'create a lead');
  }

  async get(id: string): Promise<APIResponse> {
    return this.send('get', `${LEAD_ENDPOINTS.leads}/${id}`);
  }

  async getRecord(id: string): Promise<Lead> {
    return this.data(await this.get(id), `GET lead ${id}`);
  }

  /** Move a lead to another stage, with what that stage asks for. */
  async move(id: string, move: LeadMove): Promise<APIResponse> {
    return this.send('post', `${LEAD_ENDPOINTS.leads}/${id}/move`, move);
  }

  /** The contact's leads, found by searching their name (newest first). */
  async forContact(name: string): Promise<Lead[]> {
    const response = await this.send('post', `${LEAD_ENDPOINTS.leads}/search`, {
      search: name,
      page: 1,
      limit: 25,
    });
    return (await this.data<{ result: Lead[] }>(response, 'search leads')).result;
  }

  async counts(): Promise<LeadCounts> {
    return this.data(await this.send('post', `${LEAD_ENDPOINTS.leads}/counts`, {}), 'count leads');
  }

  async stages(): Promise<LeadStage[]> {
    return this.data(await this.send('get', LEAD_ENDPOINTS.stages), 'GET lead stages');
  }

  /** The stage with a built-in key, e.g. "lost". */
  async stage(key: string): Promise<LeadStage> {
    const stage = (await this.stages()).find((candidate) => candidate.key === key);
    if (!stage) throw new Error(`No lead stage with key "${key}"`);
    return stage;
  }

  async fields(): Promise<LeadField[]> {
    return this.data(await this.send('get', LEAD_ENDPOINTS.fields), 'GET lead fields');
  }

  /** The id of a list field's option, e.g. option("lost_reason", "No response"). */
  async option(fieldKey: string, label: string): Promise<string> {
    const field = (await this.fields()).find((candidate) => candidate.key === fieldKey);
    const option = field?.options.find((candidate) => candidate.label === label);
    if (!option) throw new Error(`Lead field "${fieldKey}" has no option "${label}"`);
    return option.id;
  }

  private async send(method: 'get' | 'post', path: string, data?: object): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request[method](`${env.apiUrl}${path}`, { headers, data }));
  }

  private async data<T>(response: APIResponse, what: string): Promise<T> {
    if (!response.ok()) throw new Error(`Could not ${what}: ${response.status()} ${await response.text()}`);
    return (await response.json()).data;
  }
}
