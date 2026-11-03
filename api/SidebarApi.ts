import type { APIRequestContext, APIResponse } from '@playwright/test';
import { ENDPOINTS, type HeadersProvider } from './ResourceApi';
import { env } from '../config/env';
import { sendTimed } from '../utils/timing';

export type NotificationRecord = {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  /** Where clicking the notification goes, e.g. "/inbox/<workspace>/<conversation>". */
  route: string | null;
  occurredAt: string;
  /** null while unread. */
  readAt: string | null;
};

export type AvailabilityRecord = { userId: string; status: string; lastSeenAt: string | null };

/**
 * What the widgets at the bottom of the sidebar show: notifications, AI credits and who is online.
 * Read only: marking notifications read or changing availability would change the shared
 * account's real state.
 */
export class SidebarApi {
  constructor(
    private readonly request: APIRequestContext,
    private readonly headers: HeadersProvider,
  ) {}

  /** The latest notifications, newest first. */
  notifications(limit = 20): Promise<APIResponse> {
    return this.get(ENDPOINTS.notificationsFeed, { limit });
  }

  /** The number on the bell. */
  unreadCount(): Promise<APIResponse> {
    return this.get(`${ENDPOINTS.notificationsFeed}/unread-count`);
  }

  /** AI credits left: `{ balance: "0.0000", lowBalanceThreshold: 5 }`. */
  creditBalance(): Promise<APIResponse> {
    return this.get(`${ENDPOINTS.credits}/balance`);
  }

  /** Settings → Credits → Activity. */
  creditTransactions(): Promise<APIResponse> {
    return this.get(`${ENDPOINTS.credits}/transactions`);
  }

  /** Online / offline status of every member of the workspace. */
  availability(): Promise<APIResponse> {
    return this.get(ENDPOINTS.availability);
  }

  /** The logged-in user. */
  me(): Promise<APIResponse> {
    return this.get(ENDPOINTS.me);
  }

  private async get(path: string, params?: Record<string, number>): Promise<APIResponse> {
    const headers = await this.headers();
    return sendTimed(() => this.request.get(`${env.apiUrl}${path}`, { headers, params }));
  }
}
