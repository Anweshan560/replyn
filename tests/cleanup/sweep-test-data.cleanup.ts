import { test, expect } from '../../fixtures/test';
import { env } from '../../config/env';
import type { ResourceApi } from '../../api/ResourceApi';
import { TEST_DATA_MARKER } from '../../utils/testData';

/**
 * The clean-up job: deletes test data that tests left behind (a test that crashed, a run that was
 * stopped), so the test workspace doesn't fill up.
 *
 * Safe by design:
 * - only records whose name carries the test marker ("qa" + 6 digits, see utils/testData.ts),
 *   so real data is never touched;
 * - only records older than 2 hours, so a test that is running right now keeps its data;
 * - only in the test workspace: it stops if the session is in any other workspace.
 *
 * Runs only when asked: `npm run test:sweep`. `npm run test:sweep:dry` lists what it would delete.
 * Data from before the marker (2026-11-03) has no marker, so it is not swept: delete it by hand.
 */

/** Hours a record must be old before it is swept; SWEEP_MIN_AGE_HOURS changes it (e.g. 0 to test the job). */
const MIN_AGE_HOURS = Number(process.env.SWEEP_MIN_AGE_HOURS ?? 2);

type AnyRecord = { id: string; createdAt?: string } & Record<string, unknown>;

/** A list to sweep, and the field(s) that hold the record's name. */
type Sweepable = { label: string; api: ResourceApi<object, AnyRecord>; nameFields: string[] };

function isMarked(record: AnyRecord, nameFields: string[]): boolean {
  return nameFields.some((field) => TEST_DATA_MARKER.test(String(record[field] ?? '')));
}

/** Old enough to sweep. Records without a creation time count as old. */
function isOld(record: AnyRecord, cutoff: number): boolean {
  return !record.createdAt || new Date(record.createdAt).getTime() < cutoff;
}

test.describe('Clean up old test data', () => {
  test.skip(!env.sweepTestData, 'Runs only when asked: npm run test:sweep');
  // Walking every list and deleting one record at a time can take a while.
  test.setTimeout(15 * 60_000);

  test('should delete marked test data older than 2 hours from the test workspace', async ({
    workspaceApi,
    doctorsApi,
    treatmentsApi,
    departmentsApi,
    websitesApi,
    teamsApi,
    tagsApi,
    closingNotesApi,
    snippetsApi,
    savedFilesApi,
    contactFieldsApi,
    outcomeReasonsApi,
    apiKeysApi,
    webhooksApi,
    customViewsApi,
    rolesApi,
    segmentsApi,
    lifecyclesApi,
    contactsApi,
    workflowsApi,
  }) => {
    await test.step(`the session is in the test workspace "${env.testWorkspace}"`, async () => {
      expect((await workspaceApi.current()).name, 'never sweep any other workspace').toBe(env.testWorkspace);
    });

    const cutoff = Date.now() - MIN_AGE_HOURS * 60 * 60 * 1000;
    const lists: Sweepable[] = [
      { label: 'doctors', api: doctorsApi, nameFields: ['name'] },
      { label: 'treatments', api: treatmentsApi, nameFields: ['name'] },
      { label: 'departments', api: departmentsApi, nameFields: ['name'] },
      { label: 'websites', api: websitesApi, nameFields: ['name', 'domain'] },
      { label: 'teams', api: teamsApi, nameFields: ['name'] },
      { label: 'tags', api: tagsApi, nameFields: ['name'] },
      { label: 'closing notes', api: closingNotesApi, nameFields: ['category'] },
      { label: 'snippets', api: snippetsApi, nameFields: ['name'] },
      { label: 'saved files', api: savedFilesApi, nameFields: ['name'] },
      { label: 'contact fields', api: contactFieldsApi, nameFields: ['name', 'key'] },
      { label: 'outcome reasons', api: outcomeReasonsApi, nameFields: ['label'] },
      { label: 'API keys', api: apiKeysApi, nameFields: ['name'] },
      { label: 'webhooks', api: webhooksApi, nameFields: ['description', 'url'] },
      { label: 'inbox views', api: customViewsApi, nameFields: ['name'] },
      // Built-in roles never carry the marker, so they are never deleted.
      { label: 'roles', api: rolesApi, nameFields: ['name'] },
      { label: 'segments', api: segmentsApi, nameFields: ['name'] },
      { label: 'lifecycle stages', api: lifecyclesApi, nameFields: ['name'] },
      // "Deleting" a workflow archives it; tests reuse archived test workflows, so they don't pile up.
      { label: 'workflows', api: workflowsApi, nameFields: ['name'] },
    ] as unknown as Sweepable[];

    const summary: string[] = [];
    const failures: string[] = [];

    async function sweep(label: string, records: AnyRecord[], remove: (id: string) => Promise<void>) {
      const old = records.filter((record) => isOld(record, cutoff));
      for (const record of old) {
        if (env.sweepDryRun) continue;
        try {
          await remove(record.id);
        } catch (error) {
          failures.push(`${label} ${record.id}: ${(error as Error).message}`);
        }
      }
      summary.push(`${label}: ${old.length}${env.sweepDryRun ? ' (dry run, not deleted)' : ''}`);
    }

    for (const { label, api, nameFields } of lists) {
      await test.step(label, async () => {
        const records = (await api.listRecords()).filter((record) => isMarked(record, nameFields));
        await sweep(label, records, (id) => api.deleteIfExists(id));
      });
    }

    // Contacts can run into thousands, so search for the marker instead of listing them all.
    await test.step('contacts', async () => {
      const marked: AnyRecord[] = [];
      for (let page: number | null = 1; page;) {
        const result = await contactsApi.searchRecords({ search: 'qa', page, limit: 100 });
        marked.push(
          ...(result.result as unknown as AnyRecord[]).filter((contact) =>
            isMarked(contact, ['firstName', 'lastName', 'email']),
          ),
        );
        page = result.meta.nextPage;
      }
      await sweep('contacts', marked, (id) => contactsApi.deleteIfExists(id));
    });

    console.log(`Old test data${env.sweepDryRun ? ' found' : ' deleted'}:\n  ${summary.join('\n  ')}`);
    test.info().annotations.push({ type: 'swept', description: summary.join(', ') });
    expect(failures, 'records that could not be deleted').toEqual([]);
  });
});
