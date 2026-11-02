import type { APIRequestContext } from '@playwright/test';
import { ENDPOINTS, ResourceApi, type HeadersProvider } from './ResourceApi';
import type { WidgetData } from '../utils/testData';

/** Request body for POST /v1/widgets. */
export type WidgetPayload = {
  name?: string;
};

/** A widget as the API returns it (only the fields the tests use). */
export type Widget = Required<WidgetPayload> & { id: string };

/** Convert test data to the API's field names. */
export function toWidgetPayload(widget: WidgetData): WidgetPayload {
  return { name: widget.name };
}

/** Client for /v1/widgets: list, get, create, update, delete, createRecord and deleteIfExists. */
export class WidgetsApi extends ResourceApi<WidgetPayload, Widget> {
  constructor(request: APIRequestContext, headers: HeadersProvider) {
    super(request, headers, ENDPOINTS.widgets);
  }
}
