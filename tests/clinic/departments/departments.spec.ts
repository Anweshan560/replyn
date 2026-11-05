import { test, expect } from '../../../fixtures/test';
import { toDepartmentData, toDepartmentPayload } from '../../../api/DepartmentsApi';
import { ENDPOINTS } from '../../../api/ResourceApi';
import { recordApiCalls } from '../../../utils/network';
import { buildDepartment, otherColorThan } from '../../../utils/testData';

// Already logged in through the saved session from tests/setup/auth.setup.ts.
test.describe('Departments', { tag: ['@clinic', '@departments'] }, () => {
  test('should open the Departments page when user picks Departments in the Clinic menu', async ({
    page,
    departmentsPage,
    departmentsApi,
    cleanup,
  }) => {
    // With no departments the page shows an empty state instead of the table.
    const created = await departmentsApi.createRecord(toDepartmentPayload(buildDepartment()));
    cleanup.add(`department "${created.name}"`, () => departmentsApi.deleteIfExists(created.id));

    await test.step('go to Clinic → Departments from the dashboard', () =>
      departmentsPage.openFromDashboard());
    await test.step('the departments list is shown', async () => {
      await expect(page).toHaveURL('/departments');
      await expect(departmentsPage.table).toBeVisible();
    });
  });

  test('should save every field when user adds a department', async ({
    departmentsPage,
    departmentsApi,
    cleanup,
  }) => {
    const department = buildDepartment();

    await test.step('go to Clinic → Departments', () => departmentsPage.openFromDashboard());
    const departmentId = await test.step('fill in and save the Add Department dialog', () =>
      departmentsPage.createRecord(department));
    cleanup.add(`department "${department.name}"`, () => departmentsApi.deleteIfExists(departmentId));

    await test.step('the department appears in the list', async () => {
      await expect(departmentsPage.rowFor(department.name)).toBeVisible();
    });
    await test.step('every field, including the colour, is saved exactly as entered', () =>
      departmentsPage.expectSavedValues(department));
  });

  test('should save every change when user edits a department', async ({
    departmentsPage,
    departmentsApi,
    cleanup,
  }) => {
    const original = buildDepartment();
    const existing = await test.step('create a department to edit (through the API)', () =>
      departmentsApi.createRecord(toDepartmentPayload(original)));
    cleanup.add(`department "${existing.name}"`, () => departmentsApi.deleteIfExists(existing.id));
    const updated = { ...buildDepartment(), colorName: otherColorThan(original.colorName) };

    await test.step('change every field, including the colour, and save', () =>
      departmentsPage.editRecord(existing.name, updated));
    await test.step('the list shows the new name instead of the old one', async () => {
      await expect(departmentsPage.rowFor(updated.name)).toBeVisible();
      await expect(departmentsPage.rowFor(existing.name)).toHaveCount(0);
    });
    await test.step('every field shows the new value', () => departmentsPage.expectSavedValues(updated));
  });

  test('should remove the department when user deletes it', async ({
    departmentsPage,
    departmentsApi,
    cleanup,
  }) => {
    const existing = await test.step('create a department to delete (through the API)', () =>
      departmentsApi.createRecord(toDepartmentPayload(buildDepartment())));
    // Safety net only: does nothing if the test deleted it as expected.
    cleanup.add(`department "${existing.name}"`, () => departmentsApi.deleteIfExists(existing.id));

    await test.step('delete the department from the list', () => departmentsPage.deleteRecord(existing.name));
    await test.step('the department is gone from the list and the server', async () => {
      await expect(departmentsPage.rowFor(existing.name)).toHaveCount(0);
      expect((await departmentsApi.get(existing.id)).status()).toBe(404);
    });
  });

  test('should warn that linked doctors, treatments and agents are kept when deleting', async ({
    departmentsPage,
    departmentsApi,
    cleanup,
  }) => {
    const existing = await test.step('create a department (through the API)', () =>
      departmentsApi.createRecord(toDepartmentPayload(buildDepartment())));
    cleanup.add(`department "${existing.name}"`, () => departmentsApi.deleteIfExists(existing.id));

    await test.step('choose Delete on the department', () => departmentsPage.openDeleteDialog(existing.name));
    await test.step('the confirmation explains what happens to linked records', async () => {
      await expect(departmentsPage.deleteDialog).toContainText(
        'Doctors, treatments and agents will be unlinked but not deleted.',
      );
    });
    await test.step('cancelling keeps the department', async () => {
      await departmentsPage.deleteDialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(departmentsPage.deleteDialog).toBeHidden();
      await expect(departmentsPage.rowFor(existing.name)).toBeVisible();
      expect((await departmentsApi.get(existing.id)).status()).toBe(200);
    });
  });

  test('should show the department created through the API with every field filled in', async ({
    departmentsPage,
    departmentsApi,
    cleanup,
  }) => {
    const created = await test.step('create a department through the API', () =>
      departmentsApi.createRecord(toDepartmentPayload(buildDepartment())));
    cleanup.add(`department "${created.name}"`, () => departmentsApi.deleteIfExists(created.id));

    await test.step('the department appears in the list', async () => {
      await departmentsPage.openList();
      await expect(departmentsPage.rowFor(created.name)).toBeVisible();
    });
    await test.step('its Edit dialog shows every field sent to the API', () =>
      departmentsPage.expectSavedValues(toDepartmentData(created)));
  });

  test('should not save a department when the name is left empty', async ({ page, departmentsPage }) => {
    // Every other field is filled, so only the missing name can block the save.
    const department = { ...buildDepartment(), name: '' };
    const createCalls = recordApiCalls(page, 'POST', ENDPOINTS.departments);

    await test.step('open the Add Department dialog', async () => {
      await departmentsPage.openList();
      await departmentsPage.openAddDialog();
    });
    await test.step('fill in everything except the name and save', async () => {
      await departmentsPage.addDialog.fill(department);
      await departmentsPage.submitAddDialog();
    });
    await test.step('the dialog shows "Name is required" and stays open', async () => {
      await expect(departmentsPage.addDialog.nameRequiredError).toBeVisible();
      await expect(departmentsPage.addDialog.nameInput).toHaveAttribute('aria-invalid', 'true');
      await expect(departmentsPage.addDialog.root).toBeVisible();
    });
    await test.step('nothing is sent to the server and the entered values are kept', async () => {
      expect(createCalls, 'no create-department request should be sent').toEqual([]);
      await expect(departmentsPage.addDialog.descriptionInput).toHaveValue(department.description);
      await expect(departmentsPage.addDialog.colorSwatch(department.colorName)).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(departmentsPage.addDialog.externalIdInput).toHaveValue(department.externalId);
    });
  });
});
