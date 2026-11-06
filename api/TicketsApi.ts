import type { APIRequestContext, APIResponse } from '@playwright/test';
import { ENDPOINTS, ResourceApi, type HeadersProvider } from './ResourceApi';
import { sendTimed } from '../utils/timing';
import type { TicketData } from '../utils/testData';

export type TicketStatus = 'pending' | 'progress' | 'pending-action' | 'resolved';

/** Request body for POST /v1/tickets. `name` and `status` are required. */
export type TicketPayload = {
  name?: string;
  description?: string | null;
  status?: TicketStatus;
  assignedTo?: string | null;
  contactId?: string | null;
  order?: number;
};

export type TicketComment = { id: string; text: string; ticketId: string };

/** A ticket as the API returns it (only the fields the tests use). */
export type Ticket = TicketPayload & {
  id: string;
  name: string;
  status: TicketStatus;
  createdBy: string;
  workspaceId: string;
  comments?: TicketComment[];
  tags?: { id: string; name: string }[];
};

/** Convert test data to the API's field names. */
export function toTicketPayload(ticket: TicketData): TicketPayload {
  return { name: ticket.name, description: ticket.description, status: 'pending' };
}

/** Client for /v1/tickets, with a ticket's comments and tags. */
export class TicketsApi extends ResourceApi<TicketPayload, Ticket> {
  constructor(request: APIRequestContext, headers: HeadersProvider) {
    super(request, headers, ENDPOINTS.tickets);
  }

  /** The ticket with its comments and tags. Throws if the API does not find it. */
  async getRecord(id: string): Promise<Ticket> {
    const response = await this.get(id);
    if (!response.ok()) throw new Error(`GET ${this.path}/${id} returned ${response.status()}`);
    return (await response.json()).data;
  }

  /** `text` is left out to test validation. */
  async addComment(id: string, text?: string): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request.post(`${this.url(id)}/comments`, { headers, data: { text } }));
  }

  async deleteComment(id: string, commentId: string): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request.delete(`${this.url(id)}/comments/${commentId}`, { headers }));
  }

  async addTags(id: string, tagIds: string[]): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request.post(`${this.url(id)}/tags`, { headers, data: { tagIds } }));
  }

  async removeTag(id: string, tagId: string): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request.delete(`${this.url(id)}/tags/${tagId}`, { headers }));
  }
}
