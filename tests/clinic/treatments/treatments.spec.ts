import { test, expect } from '../../../fixtures/test';
import { ENDPOINTS } from '../../../api/ResourceApi';
import { toTreatmentData, toTreatmentPayload } from '../../../api/TreatmentsApi';
import { mockApiFailure, recordApiCalls } from '../../../utils/network';
import { buildTreatment } from '../../../utils/testData';

// Already logged in through the saved session from tests/setup/auth.setup.ts.
test.describe('Treatments', { tag: ['@clinic', '@treatments'] }, () => {
  test('should open the Treatments page when user picks Treatments in the Clinic menu', async ({
    page,
    treatmentsPage,
    treatmentsApi,
    cleanup,
  }) => {
    // With no treatments the page shows an empty state instead of the table.
    const created = await treatmentsApi.createRecord(toTreatmentPayload(buildTreatment()));
    cleanup.add(`treatment "${created.name}"`, () => treatmentsApi.deleteIfExists(created.id));

    await test.step('go to Clinic → Treatments from the dashboard', () => treatmentsPage.openFromDashboard());
    await test.step('the treatments list is shown', async () => {
      await expect(page).toHaveURL('/treatments');
      await expect(treatmentsPage.table).toBeVisible();
    });
  });

  test('should save every field when user creates a treatment', async ({
    treatmentsPage,
    treatmentsApi,
    cleanup,
  }) => {
    const treatment = buildTreatment();

    await test.step('go to Clinic → Treatments', () => treatmentsPage.openFromDashboard());
    const treatmentId = await test.step('fill in and save the new-treatment form', () =>
      treatmentsPage.createRecord(treatment));
    cleanup.add(`treatment "${treatment.name}"`, () => treatmentsApi.deleteIfExists(treatmentId));

    await test.step('every field is saved exactly as typed', () =>
      treatmentsPage.expectSavedValues(treatment));
    await test.step('the treatment appears in the list', async () => {
      await treatmentsPage.openList();
      await expect(treatmentsPage.rowFor(treatment.name)).toBeVisible();
    });
  });

  test('should save every change when user edits a treatment', async ({
    treatmentsPage,
    treatmentsApi,
    cleanup,
  }) => {
    const existing = await test.step('create a treatment to edit (through the API)', () =>
      treatmentsApi.createRecord(toTreatmentPayload(buildTreatment())));
    cleanup.add(`treatment "${existing.name}"`, () => treatmentsApi.deleteIfExists(existing.id));
    const updated = buildTreatment();

    await test.step('change every field and save', () => treatmentsPage.editRecord(existing.name, updated));
    await test.step('every field shows the new value', () => treatmentsPage.expectSavedValues(updated));
    await test.step('the list shows the new name instead of the old one', async () => {
      await treatmentsPage.openList();
      await expect(treatmentsPage.rowFor(updated.name)).toBeVisible();
      await expect(treatmentsPage.rowFor(existing.name)).toHaveCount(0);
    });
  });

  test('should remove the treatment when user deletes it', async ({
    treatmentsPage,
    treatmentsApi,
    cleanup,
  }) => {
    const existing = await test.step('create a treatment to delete (through the API)', () =>
      treatmentsApi.createRecord(toTreatmentPayload(buildTreatment())));
    // Safety net only: does nothing if the test deleted it as expected.
    cleanup.add(`treatment "${existing.name}"`, () => treatmentsApi.deleteIfExists(existing.id));

    await test.step('delete the treatment from the list', () => treatmentsPage.deleteRecord(existing.name));
    await test.step('the treatment is gone from the list and the server', async () => {
      await expect(treatmentsPage.rowFor(existing.name)).toHaveCount(0);
      expect((await treatmentsApi.get(existing.id)).status()).toBe(404);
    });
  });

  test('should show the treatment created through the API with every field filled in', async ({
    treatmentsPage,
    treatmentsApi,
    cleanup,
  }) => {
    const created = await test.step('create a treatment through the API', () =>
      treatmentsApi.createRecord(toTreatmentPayload(buildTreatment())));
    cleanup.add(`treatment "${created.name}"`, () => treatmentsApi.deleteIfExists(created.id));

    await test.step('the treatment appears in the list', async () => {
      await treatmentsPage.openList();
      await expect(treatmentsPage.rowFor(created.name)).toBeVisible();
    });
    await test.step('its page shows every field sent to the API', async () => {
      await treatmentsPage.openRecord(created.name);
      await treatmentsPage.expectSavedValues(toTreatmentData(created));
    });
  });

  test('should not save a treatment when the name is left empty', async ({ page, treatmentsPage }) => {
    // Every other field is filled, so only the missing name can block the save.
    const treatment = { ...buildTreatment(), name: '' };
    const createCalls = recordApiCalls(page, 'POST', ENDPOINTS.treatments);

    await test.step('open the new-treatment form', async () => {
      await treatmentsPage.openList();
      await treatmentsPage.openNewForm();
    });
    await test.step('fill in everything except the name and save', async () => {
      await treatmentsPage.fillForm(treatment);
      await treatmentsPage.submitNewForm();
    });
    await test.step('the form shows "Name is required" and stays open', async () => {
      await expect(treatmentsPage.nameRequiredError).toBeVisible();
      await expect(treatmentsPage.nameInput).toHaveAttribute('aria-invalid', 'true');
      await expect(page).toHaveURL('/treatments/new');
    });
    await test.step('nothing is sent to the server and the typed values are kept', async () => {
      expect(createCalls, 'no create-treatment request should be sent').toEqual([]);
      await expect(treatmentsPage.websiteInput).toHaveValue(treatment.website);
      await expect(treatmentsPage.priceInput).toHaveValue(treatment.price);
      await expect(treatmentsPage.discountedPriceInput).toHaveValue(treatment.discountedPrice);
      await expect(treatmentsPage.emrIdInput).toHaveValue(treatment.emrId);
      await expect(treatmentsPage.descriptionEditor).toHaveText(treatment.description);
    });
  });

  test('should show "Couldn’t save" and keep the form when the server fails to save', async ({
    page,
    treatmentsPage,
  }) => {
    const treatment = buildTreatment();

    await test.step('make the create-treatment API call fail with a 500 error', () =>
      mockApiFailure(page, 'POST', ENDPOINTS.treatments, 500, 'Internal server error'));
    await test.step('open the new-treatment form', async () => {
      await treatmentsPage.openList();
      await treatmentsPage.openNewForm();
    });
    await test.step('fill in every field and save', async () => {
      await treatmentsPage.fillForm(treatment);
      await treatmentsPage.submitNewForm();
    });
    await test.step('the error is shown and the user stays on the form', async () => {
      await expect(treatmentsPage.saveFailedError).toBeVisible();
      await expect(page.getByText('Internal server error')).toBeVisible();
      await expect(page).toHaveURL('/treatments/new');
    });
    await test.step('nothing the user typed is lost', async () => {
      await expect(treatmentsPage.nameInput).toHaveValue(treatment.name);
      await expect(treatmentsPage.priceInput).toHaveValue(treatment.price);
      await expect(treatmentsPage.descriptionEditor).toHaveText(treatment.description);
    });
  });
});
