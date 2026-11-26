import { test, expect } from '../../fixtures/test';
import { firstNameContains, fullName, toContactPayload } from '../../api/ContactsApi';
import { ENDPOINTS } from '../../api/ResourceApi';
import { waitForApiResponse } from '../../utils/network';
import { buildContact, buildSegmentName } from '../../utils/testData';

/** The Filters preview's heading: "1 contact matches", "2 contacts match". */
const MATCH_COUNT = /^(\d+) contacts? match(es)?$/;

test.describe('Contacts → segments and filters', { tag: ['@contacts'] }, () => {
  test('should narrow the preview with a filter rule and save it as a segment', async ({
    page,
    contactsPage,
    contactsApi,
    segmentsApi,
    cleanup,
  }) => {
    // The first name carries a unique number, so the rule matches this contact and nothing else.
    const contact = buildContact({ uniqueFirstName: true });
    const name = fullName(contact);
    const created = await test.step('create a contact (through the API)', () =>
      contactsApi.createRecord(toContactPayload(contact)));
    cleanup.add(`contact "${name}"`, () => contactsApi.deleteIfExists(created.id));
    const segmentName = buildSegmentName();
    const filters = contactsPage.filtersDialog;

    await test.step('open Contacts → New segment', async () => {
      await contactsPage.open();
      await filters.open();
    });
    await test.step('with no rules, the preview counts every contact', async () => {
      await expect(filters.matchCount).toHaveText(MATCH_COUNT);
      const everyone = Number((await filters.matchCount.innerText()).match(MATCH_COUNT)![1]);
      // At least the new contact and the workspace's own "contaact1".
      expect(everyone).toBeGreaterThanOrEqual(2);
    });

    await test.step(`add the rule "First name contains ${contact.firstName}"`, () =>
      filters.addFirstNameContainsRule(contact.firstName));
    await test.step('the preview shows "1 contact matches" with just this contact', async () => {
      await expect(filters.matchCount).toHaveText('1 contact matches');
      await expect(filters.previewRow(name)).toBeVisible();
      await expect(filters.preview.getByRole('rowgroup').nth(1).getByRole('row')).toHaveCount(1);
    });

    const segment = await test.step(`name it "${segmentName}" and create the segment`, () =>
      filters.saveAsSegment(segmentName));
    cleanup.add(`segment "${segmentName}"`, () => segmentsApi.deleteIfExists(segment.id));

    await test.step('the segment is selected, listed in the left panel, and shows only this contact', async () => {
      await expect(page).toHaveURL((url) => url.searchParams.get('segment') === segment.id);
      await expect(contactsPage.sidebarLink(segmentName)).toBeVisible();
      await expect(contactsPage.rowFor(name)).toBeVisible();
      await expect(contactsPage.contactRows()).toHaveCount(1);
    });
    await test.step('the server stored the segment with the rule', async () => {
      const response = await segmentsApi.get(segment.id);
      expect(response.status()).toBe(200);
      expect((await response.json()).data).toMatchObject({
        name: segmentName,
        filter: { rules: [firstNameContains(contact.firstName)] },
      });
    });
  });

  test('should create a segment once it has a name and a rule, then delete it', async ({
    page,
    contactsPage,
    segmentsApi,
    cleanup,
  }) => {
    const segmentName = buildSegmentName();
    const dialog = contactsPage.newSegmentDialog;
    const createButton = dialog.getByRole('button', { name: 'Create segment', exact: true });

    await test.step('open Contacts → New segment', async () => {
      await contactsPage.open();
      await contactsPage.newSegmentButton.click();
      await expect(dialog).toBeVisible();
    });
    await test.step('Create stays greyed out while the name is empty', async () => {
      await expect(createButton).toBeDisabled();
    });

    // Since the 2026-11-25 redesign a segment needs a rule as well as a name.
    await test.step('type a name: Create stays greyed out without a rule', async () => {
      await dialog.getByRole('textbox', { name: 'Name' }).fill(segmentName);
      await expect(createButton).toBeDisabled();
    });
    await test.step('add a rule: Create becomes available', async () => {
      await contactsPage.filtersDialog.addFirstNameContainsRule('qa');
      await expect(createButton).toBeEnabled();
    });
    const segment = await test.step('create the segment', async () => {
      const created = waitForApiResponse(page, 'POST', ENDPOINTS.segments);
      await createButton.click();
      const response = await created;
      expect(response.status(), 'the server should create the segment').toBe(201);
      await expect(dialog).toBeHidden();
      return (await response.json()).data as { id: string };
    });
    cleanup.add(`segment "${segmentName}"`, () => segmentsApi.deleteIfExists(segment.id));

    await test.step('the new segment is selected and listed in the left panel', async () => {
      await expect(page).toHaveURL((url) => url.searchParams.get('segment') === segment.id);
      await expect(contactsPage.sidebarLink(segmentName)).toBeVisible();
    });

    await test.step('delete it through Segment actions, confirming the dialog names it', () =>
      contactsPage.deleteSelectedSegment(segmentName, segment.id));
    await test.step('it is gone from the left panel and the server', async () => {
      await expect(contactsPage.sidebarLink(segmentName)).toHaveCount(0);
      expect((await segmentsApi.get(segment.id)).status()).toBe(404);
    });
  });
});
