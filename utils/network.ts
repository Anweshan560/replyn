import type { Page, Request, Response } from '@playwright/test';
import { env } from '../config/env';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** True if `request` is `method` on `apiPath` of the app's API (an exact path, or a pattern). */
function isApiCall(request: Request, method: HttpMethod, apiPath: string | RegExp): boolean {
  const url = new URL(request.url());
  const pathMatches = typeof apiPath === 'string' ? url.pathname === apiPath : apiPath.test(url.pathname);
  return request.method() === method && url.origin === env.apiUrl && pathMatches;
}

/**
 * Wait for the page's next call to an API endpoint to come back. Start waiting *before* the
 * action that sends it, so a fast response is not missed.
 */
export function waitForApiResponse(
  page: Page,
  method: HttpMethod,
  apiPath: string | RegExp,
): Promise<Response> {
  return page.waitForResponse((response) => isApiCall(response.request(), method, apiPath));
}

/**
 * Wait for the page's next GET of `apiPath` whose query matches `query` (a value of null means the
 * parameter must be absent). Lists that refetch on every keystroke or tab can answer out of
 * order, so matching on the query makes sure it is the answer to this action, not an earlier one.
 */
export function waitForListResponse(
  page: Page,
  apiPath: string,
  query: Record<string, string | null>,
): Promise<Response> {
  return page.waitForResponse((response) => {
    if (!isApiCall(response.request(), 'GET', apiPath)) return false;
    const params = new URL(response.url()).searchParams;
    return Object.entries(query).every(([name, value]) => params.get(name) === value);
  });
}

/**
 * Start recording the page's calls to one API endpoint.
 * @returns a list that fills up as matching requests are sent, e.g. to prove none were.
 */
export function recordApiCalls(page: Page, method: HttpMethod, apiPath: string | RegExp): string[] {
  const calls: string[] = [];
  page.on('request', (request) => {
    if (isApiCall(request, method, apiPath)) calls.push(request.url());
  });
  return calls;
}

/**
 * Make one API endpoint fail for this page only. The request never reaches the real server,
 * so this is safe for testing how the UI handles errors.
 */
export async function mockApiFailure(
  page: Page,
  method: HttpMethod,
  apiPath: string,
  status: number,
  message: string,
): Promise<void> {
  await page.route(`${env.apiUrl}${apiPath}`, async (route) => {
    if (!isApiCall(route.request(), method, apiPath)) return route.fallback();
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ message, statusCode: status }),
    });
  });
}
