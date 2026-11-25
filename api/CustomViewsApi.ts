import type { APIRequestContext, APIResponse } from '@playwright/test';
import { ENDPOINTS, ResourceApi, type HeadersProvider } from './ResourceApi';
import { sendTimed } from '../utils/timing';
import { VIEW_FIELDS, VIEW_OPERATORS, type SavedViewData } from '../utils/testData';

export type ViewRulePayload = { field: string; operator: string; value: string };

/**
 * An inbox view. Since the 2026-11-25 redesign views are segments with `surface: "inbox"` (the old
 * /v1/custom-views is gone, and views no longer have an icon). "Who sees it" is stored as
 * `visibility`: "Only me" is private, "Everyone" is workspace.
 */
export type CustomViewPayload = {
  name?: string;
  surface?: 'inbox';
  visibility?: 'private' | 'workspace';
  filter?: { rules: ViewRulePayload[] };
};

export type CustomViewRecord = Required<CustomViewPayload> & { id: string };

export function toCustomViewPayload(view: SavedViewData): CustomViewPayload {
  return {
    name: view.name,
    surface: 'inbox',
    visibility: view.share === 'Everyone' ? 'workspace' : 'private',
    filter: {
      rules: [
        {
          field: VIEW_FIELDS[view.rule.field],
          operator: VIEW_OPERATORS[view.rule.operator],
          value: view.rule.value,
        },
      ],
    },
  };
}

/** Inbox views: segments of the inbox surface. They update with PUT. */
export class CustomViewsApi extends ResourceApi<CustomViewPayload, CustomViewRecord> {
  constructor(request: APIRequestContext, headers: HeadersProvider) {
    super(request, headers, ENDPOINTS.segments, 'PUT');
  }

  /** The list only holds inbox views when asked for them: without `surface` it is empty. */
  override async list(page?: number): Promise<APIResponse> {
    const headers = await this.headers();
    const params: Record<string, string | number> = { surface: 'inbox' };
    if (page && page > 1) params.page = page;
    return sendTimed(() => this.request.get(this.url(), { headers, params }));
  }
}
