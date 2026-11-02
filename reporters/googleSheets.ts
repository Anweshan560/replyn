import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * A minimal Google Sheets client: just what the failed-tests reporter needs, using a Google
 * service account and Node's built-in fetch and crypto, so no extra package is needed.
 */

type ServiceAccount = { client_email: string; private_key: string };

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * The service-account key: GOOGLE_SERVICE_ACCOUNT_KEY holds the JSON itself (used on CI, as a
 * repository secret), GOOGLE_SERVICE_ACCOUNT_KEY_FILE a path to the downloaded .json file (local).
 */
export function readServiceAccount(): ServiceAccount | undefined {
  const json =
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
    (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE &&
      readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE, 'utf8'));
  if (!json) return undefined;
  const key = JSON.parse(json) as ServiceAccount;
  if (!key.client_email || !key.private_key) {
    throw new Error('The Google service-account key has no client_email or private_key');
  }
  return key;
}

/** Exchange a signed token for a one-hour access token that may edit spreadsheets. */
async function accessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key, 'base64url');

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!response.ok) throw new Error(`Google login failed: ${response.status} ${await response.text()}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

/** One tab of a spreadsheet. */
export class SheetTab {
  private constructor(
    private readonly token: string,
    private readonly spreadsheetId: string,
    private readonly title: string,
  ) {}

  /** Log in and open the tab, creating it if the spreadsheet does not have it yet. */
  static async open(account: ServiceAccount, spreadsheetId: string, title: string): Promise<SheetTab> {
    const tab = new SheetTab(await accessToken(account), spreadsheetId, title);
    const { sheets } = await tab.call<{ sheets: { properties: { title: string } }[] }>(
      'GET',
      `?fields=sheets.properties.title`,
    );
    if (!sheets.some((sheet) => sheet.properties.title === title)) {
      await tab.call('POST', ':batchUpdate', { requests: [{ addSheet: { properties: { title } } }] });
    }
    return tab;
  }

  /** Every filled row of the tab, header included. */
  async rows(): Promise<string[][]> {
    const { values } = await this.call<{ values?: string[][] }>('GET', `/values/${this.range('A:Z')}`);
    return values ?? [];
  }

  /** Overwrite cells: each entry is a range in A1 notation (without the tab name) and its rows. */
  async write(updates: { range: string; values: string[][] }[]): Promise<void> {
    if (!updates.length) return;
    await this.call('POST', '/values:batchUpdate', {
      // RAW: store text as typed, so a value starting with "=" is never run as a formula.
      valueInputOption: 'RAW',
      data: updates.map((update) => ({ range: `'${this.title}'!${update.range}`, values: update.values })),
    });
  }

  /** Add rows below the last filled one. */
  async append(values: string[][]): Promise<void> {
    if (!values.length) return;
    await this.call(
      'POST',
      `/values/${this.range('A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { values },
    );
  }

  private range(cells: string): string {
    return encodeURIComponent(`'${this.title}'!${cells}`);
  }

  private async call<T = unknown>(method: string, path: string, body?: object): Promise<T> {
    const response = await fetch(`${SHEETS_API}/${this.spreadsheetId}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Google Sheets ${method} ${path} failed: ${response.status} ${await response.text()}`);
    }
    return (await response.json()) as T;
  }
}
