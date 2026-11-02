import { test, expect } from '../../../fixtures/test';
import { toContactFieldPayload } from '../../../api/ContactFieldsApi';
import { recordApiCalls } from '../../../utils/network';
import { ENDPOINTS } from '../../../api/ResourceApi';
import { buildContactField } from '../../../utils/testData';

test.describe('Settings → Contact Fields', { tag: ['@settings', '@contact-fields'] }, () => {
  test(
    'should open Contact Fields from the Settings menu with the built-in fields',
    { tag: '@smoke' },
    async ({ page, contactFieldsPage }) => {
      await test.step('go to Settings → Contact Fields', () => contactFieldsPage.openFromDashboard());
      await test.step('the built-in fields are listed and cannot be edited', async () => {
        for (const name of ['First name', 'Last name', 'Phone', 'Email']) {
          // Each field has a drag handle named after it ("Phone" alone is also a type label).
          await expect(
            page.getByRole('button', { name: `Reorder ${name}`, exact: true }).first(),
          ).toBeVisible();
          await expect(page.getByRole('button', { name: `Edit ${name}`, exact: true })).toHaveCount(0);
        }
      });
    },
  );

  test('should save every field when user creates a text field', async ({
    contactFieldsPage,
    contactFieldsApi,
    cleanup,
  }) => {
    const field = buildContactField('Text');

    await test.step('open Settings → Contact Fields', () => contactFieldsPage.open());
    const id = await test.step('fill in and save the New contact field dialog', () =>
      contactFieldsPage.createField(field));
    cleanup.add(`contact field ${field.key}`, () => contactFieldsApi.deleteIfExists(id));

    await test.step('the field is listed with its type and key', async () => {
      await expect(contactFieldsPage.editButton(field)).toBeVisible();
      await expect(contactFieldsPage.summary(field)).toBeVisible();
    });
    await test.step('after a reload, the edit dialog shows every field, with key and type locked', () =>
      contactFieldsPage.expectSavedValues(field));
    await test.step('the server stored every field', async () => {
      expect(await contactFieldsApi.findRecord(id)).toMatchObject(toContactFieldPayload(field));
    });
  });

  test('should save the options when user creates a choice field', async ({
    contactFieldsPage,
    contactFieldsApi,
    cleanup,
  }) => {
    const field = buildContactField('Choice');

    await test.step('open Settings → Contact Fields', () => contactFieldsPage.open());
    const id = await test.step('create a Choice field with three options', () =>
      contactFieldsPage.createField(field));
    cleanup.add(`contact field ${field.key}`, () => contactFieldsApi.deleteIfExists(id));

    await test.step('after a reload, the edit dialog shows the options, one per line', () =>
      contactFieldsPage.expectSavedValues(field));
    await test.step('the server stored it as a select field with those options', async () => {
      expect(await contactFieldsApi.findRecord(id)).toMatchObject({ type: 'select', values: field.options });
    });
  });

  test('should suggest a storage key from the name', async ({ contactFieldsPage }) => {
    await test.step('open the New contact field dialog', async () => {
      await contactFieldsPage.open();
      await contactFieldsPage.openCreateDialog();
    });
    await test.step('type a name with capitals and spaces', () =>
      contactFieldsPage.createDialog.getByRole('textbox', { name: 'Name' }).fill('Patient MRN 2'));
    await test.step('the key is the name in lowercase, with underscores', async () => {
      await expect(contactFieldsPage.createDialog.getByRole('textbox', { name: 'Storage key' })).toHaveValue(
        'patient_mrn_2',
      );
    });
  });

  test('should save every change when user edits a field', async ({
    contactFieldsPage,
    contactFieldsApi,
    cleanup,
  }) => {
    const original = buildContactField('Text');
    const existing = await test.step('create a field to edit (through the API)', () =>
      contactFieldsApi.createRecord(toContactFieldPayload(original)));
    cleanup.add(`contact field ${original.key}`, () => contactFieldsApi.deleteIfExists(existing.id));
    const updated = buildContactField('Text', original);

    await test.step('change the name, placeholder and visibility, and save', () =>
      contactFieldsPage.editField(original, updated));
    await test.step('the list shows the new name instead of the old one', async () => {
      await expect(contactFieldsPage.editButton(updated)).toBeVisible();
      await expect(contactFieldsPage.editButton(original)).toHaveCount(0);
    });
    await test.step('after a reload, the edit dialog shows every new value', () =>
      contactFieldsPage.expectSavedValues(updated));
    await test.step('the server stored every new value', async () => {
      expect(await contactFieldsApi.findRecord(existing.id)).toMatchObject(toContactFieldPayload(updated));
    });
  });

  test('should archive a field and restore it from the archived list', async ({
    contactFieldsPage,
    contactFieldsApi,
    cleanup,
  }) => {
    const field = buildContactField('Number');
    const existing = await test.step('create a field (through the API)', () =>
      contactFieldsApi.createRecord(toContactFieldPayload(field)));
    cleanup.add(`contact field ${field.key}`, () => contactFieldsApi.deleteIfExists(existing.id));

    await test.step('archive it, confirming the dialog that names it', () =>
      contactFieldsPage.archiveField(field));
    await test.step('it leaves the active fields and is listed as archived', async () => {
      await expect(contactFieldsPage.editButton(field)).toHaveCount(0);
      await contactFieldsPage.showArchived();
      await expect(contactFieldsPage.archivedEntry(field)).toContainText(`${field.type} · ${field.key}`);
    });
    await test.step('restore it', () => contactFieldsPage.restoreField(field));
    await test.step('it is active again, on the page and on the server', async () => {
      await expect(contactFieldsPage.editButton(field)).toBeVisible();
      expect(await contactFieldsApi.findRecord(existing.id)).toMatchObject({
        key: field.key,
        deletedAt: null,
      });
    });
  });

  test('should delete an archived field permanently', async ({
    contactFieldsPage,
    contactFieldsApi,
    cleanup,
  }) => {
    const field = buildContactField('Phone');
    const existing = await test.step('create a field and archive it (through the API)', async () => {
      const record = await contactFieldsApi.createRecord(toContactFieldPayload(field));
      expect((await contactFieldsApi.archive(record.id)).ok()).toBe(true);
      return record;
    });
    // Safety net only: does nothing if the test deleted it as expected.
    cleanup.add(`contact field ${field.key}`, () => contactFieldsApi.deleteIfExists(existing.id));

    await test.step('open the archived fields', async () => {
      await contactFieldsPage.open();
      await contactFieldsPage.showArchived();
    });
    await test.step('delete it permanently, confirming the warning', () =>
      contactFieldsPage.deletePermanently(field));
    await test.step('it is gone from the page and from both lists on the server', async () => {
      await expect(contactFieldsPage.archivedEntry(field)).toHaveCount(0);
      expect(await contactFieldsApi.findRecord(existing.id)).toBeUndefined();
      expect((await contactFieldsApi.listArchivedRecords()).map((record) => record.id)).not.toContain(
        existing.id,
      );
    });
  });

  test('should name the missing fields and not save when user submits an empty field', async ({
    page,
    contactFieldsPage,
  }) => {
    const createCalls = recordApiCalls(page, 'POST', ENDPOINTS.contactFields);

    await test.step('open the New contact field dialog', async () => {
      await contactFieldsPage.open();
      await contactFieldsPage.openCreateDialog();
    });
    await test.step('press Add field without filling anything in', () =>
      contactFieldsPage.createDialog.getByRole('button', { name: 'Add field' }).click());

    await test.step('the name and key are marked invalid, each with its message', async () => {
      const dialog = contactFieldsPage.createDialog;
      await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'true');
      await expect(dialog.getByRole('textbox', { name: 'Storage key' })).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      await expect(contactFieldsPage.fieldError(dialog, 'Give the field a name')).toBeVisible();
      await expect(
        contactFieldsPage.fieldError(
          dialog,
          'Start with a letter, then lowercase letters, numbers or underscores',
        ),
      ).toBeVisible();
    });
    await test.step('the dialog stays open and nothing is sent to the server', async () => {
      await expect(contactFieldsPage.createDialog).toBeVisible();
      expect(createCalls).toEqual([]);
    });
  });
});
