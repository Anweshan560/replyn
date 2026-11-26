import { test, expect } from '../../../fixtures/test';
import { toCustomViewPayload } from '../../../api/CustomViewsApi';
import { buildSavedView } from '../../../utils/testData';
import { knownBug } from '../../../utils/knownBug';

test.describe('Inbox → Views', { tag: ['@inbox', '@saved-views'] }, () => {
  test(
    'should open the inbox from the sidebar with its Views section',
    { tag: '@smoke' },
    async ({ page, savedViewsPage }) => {
      await test.step('go to the inbox from the sidebar', () => savedViewsPage.openFromDashboard());
      await test.step('the sidebar has a Views section with New view', async () => {
        // Since the 2026-11-25 redesign the section title is plain text, no longer a button.
        await expect(
          page.getByRole('navigation', { name: 'Inbox navigation' }).getByText('Views', { exact: true }),
        ).toBeVisible();
        await expect(savedViewsPage.newViewButton).toBeVisible();
      });
    },
  );

  test('should keep Create view disabled until the view has a name and a rule', async ({
    savedViewsPage,
  }) => {
    const dialog = savedViewsPage.createDialog;
    const createButton = dialog.getByRole('button', { name: 'Create view' });

    await test.step('open the New view dialog', async () => {
      await savedViewsPage.open();
      await savedViewsPage.openCreateDialog();
    });
    await test.step('Create view is disabled while the name is empty', async () => {
      await expect(createButton).toBeDisabled();
    });
    // Since the 2026-11-25 redesign a view needs a rule as well as a name.
    await test.step('a name alone does not enable it', async () => {
      await dialog.getByRole('textbox', { name: 'Name' }).fill('VIP patients');
      await expect(createButton).toBeDisabled();
    });
  });

  test('should save every field when user creates a view', async ({
    page,
    savedViewsPage,
    customViewsApi,
    cleanup,
  }) => {
    const view = buildSavedView();

    await test.step('open the inbox', () => savedViewsPage.open());
    const id = await test.step('name it, choose who sees it, add a rule, and create', () =>
      savedViewsPage.createView(view));
    cleanup.add(`saved view ${view.name}`, () => customViewsApi.deleteIfExists(id));

    await test.step('the view is listed in the sidebar, and opens the inbox filtered by it', async () => {
      await savedViewsPage.sidebarLink(view).click();
      await expect(page).toHaveURL((url) => url.searchParams.get('segment') === id);
    });
    await test.step('the server stored every field', async () => {
      expect((await (await customViewsApi.get(id)).json()).data).toMatchObject(toCustomViewPayload(view));
    });
  });

  test('should save the new name when user renames a view', async ({
    savedViewsPage,
    customViewsApi,
    cleanup,
  }) => {
    const original = buildSavedView();
    const existing = await test.step('create a view to rename (through the API)', () =>
      customViewsApi.createRecord(toCustomViewPayload(original)));
    cleanup.add(`saved view ${original.name}`, () => customViewsApi.deleteIfExists(existing.id));
    const newName = buildSavedView().name;

    await test.step('choose Rename in its actions menu and type the new name', async () => {
      await savedViewsPage.open();
      await savedViewsPage.renameView(original, newName);
    });
    await test.step('the sidebar shows the new name instead of the old one', async () => {
      await expect(savedViewsPage.sidebarLink({ name: newName })).toBeVisible();
      await expect(savedViewsPage.sidebarLink(original)).toHaveCount(0);
    });
    await test.step('the server stored the new name and kept the rule', async () => {
      expect((await (await customViewsApi.get(existing.id)).json()).data).toMatchObject({
        ...toCustomViewPayload(original),
        name: newName,
      });
    });
  });

  test('should remove the view when user deletes it', async ({ savedViewsPage, customViewsApi, cleanup }) => {
    const view = buildSavedView();
    const existing = await test.step('create a view to delete (through the API)', () =>
      customViewsApi.createRecord(toCustomViewPayload(view)));
    // Safety net only: does nothing if the test deleted it as expected.
    cleanup.add(`saved view ${view.name}`, () => customViewsApi.deleteIfExists(existing.id));

    await test.step('choose Delete in its actions menu and confirm', async () => {
      await savedViewsPage.open();
      await savedViewsPage.deleteView(view);
    });
    await test.step('it is gone from the sidebar and the server', async () => {
      await expect(savedViewsPage.sidebarLink(view)).toHaveCount(0);
      expect((await customViewsApi.get(existing.id)).status()).toBe(404);
    });
  });

  test('should show the inbox when /inbox is opened without a workspace', async ({ page }) => {
    knownBug('inbox-url-without-workspace');
    await test.step('open /inbox', () => page.goto('/inbox'));
    await test.step('the inbox is shown, not an error page', async () => {
      await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
    });
  });
});
