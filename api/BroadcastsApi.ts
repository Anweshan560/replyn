import type { APIRequestContext, APIResponse } from '@playwright/test';
import { ENDPOINTS, type HeadersProvider } from './ResourceApi';
import { env } from '../config/env';
import { sendTimed } from '../utils/timing';

/** The statuses the Broadcasts → Filters → Status list offers, as the API names them. */
export const BROADCAST_STATUSES = [
  'pending',
  'scheduled',
  'processing',
  'sending',
  'paused',
  'completed',
  'cancelled',
  'failed',
] as const;

export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

export type BroadcastFilters = { search?: string; statuses?: BroadcastStatus; page?: number; limit?: number };

/**
 * Broadcasts, read only. The test workspace has no WhatsApp channel, so a broadcast can't be
 * created there, and tests must never send one: only the list, its filters and the validation of
 * an empty request are tested.
 */
export class BroadcastsApi {
  constructor(
    private readonly request: APIRequestContext,
    private readonly headers: HeadersProvider,
  ) {}

  /** GET the list with the page's filters (the page sends page 1, 10 per page). */
  async list(filters: BroadcastFilters = {}): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() =>
      this.request.get(this.url(), { headers, params: { page: 1, limit: 10, ...filters } }),
    );
  }

  async get(id: string): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request.get(this.url(id), { headers }));
  }

  /** Only ever called with an incomplete body, to check that it is refused. */
  async createInvalid(payload: Record<string, unknown>): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request.post(this.url(), { headers, data: payload }));
  }

  private url(id?: string): string {
    return `${env.apiUrl}${ENDPOINTS.broadcasts}${id ? `/${id}` : ''}`;
  }
}

/** The workspace's channels (WhatsApp, Instagram, ...), as the New broadcast form lists them. */
export class ChannelsApi {
  constructor(
    private readonly request: APIRequestContext,
    private readonly headers: HeadersProvider,
  ) {}

  async list(params: { page?: number; limit?: number } = {}): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() =>
      this.request.get(`${env.apiUrl}${ENDPOINTS.channels}`, {
        headers,
        params: { limit: 100, page: 1, ...params },
      }),
    );
  }
}
