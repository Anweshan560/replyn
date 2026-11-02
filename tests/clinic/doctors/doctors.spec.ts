import { test, expect } from '../../../fixtures/test';
import { ENDPOINTS } from '../../../api/ResourceApi';
import { toDoctorData, toDoctorPayload } from '../../../api/DoctorsApi';
import { recordApiCalls } from '../../../utils/network';
import { buildDoctor } from '../../../utils/testData';

// Already logged in through the saved session from tests/setup/auth.setup.ts.
test.describe('Doctors', { tag: ['@clinic', '@doctors'] }, () => {
  test(
    'should open the Doctors page when user picks Doctors in the Clinic menu',
    { tag: '@smoke' },
    async ({ page, doctorsPage }) => {
      await test.step('go to Clinic → Doctors from the dashboard', () => doctorsPage.openFromDashboard());
      await test.step('the doctors list is shown', async () => {
        await expect(page).toHaveURL('/doctors');
        await expect(doctorsPage.table).toBeVisible();
      });
    },
  );

  test('should save every field when user creates a doctor', async ({ doctorsPage, doctorsApi, cleanup }) => {
    const doctor = buildDoctor();

    await test.step('go to Clinic → Doctors', () => doctorsPage.openFromDashboard());
    const doctorId = await test.step('fill in and save the new-doctor form', () =>
      doctorsPage.createRecord(doctor));
    cleanup.add(`doctor "${doctor.name}"`, () => doctorsApi.deleteIfExists(doctorId));

    await test.step('every field is saved exactly as typed', () => doctorsPage.expectSavedValues(doctor));
    await test.step('the doctor appears in the list', async () => {
      await doctorsPage.openList();
      await expect(doctorsPage.rowFor(doctor.name)).toBeVisible();
    });
  });

  test('should save every change when user edits a doctor', async ({ doctorsPage, doctorsApi, cleanup }) => {
    const existing = await test.step('create a doctor to edit (through the API)', () =>
      doctorsApi.createRecord(toDoctorPayload(buildDoctor())));
    cleanup.add(`doctor "${existing.name}"`, () => doctorsApi.deleteIfExists(existing.id));
    const updated = buildDoctor();

    await test.step('change every field and save', () => doctorsPage.editRecord(existing.name, updated));
    await test.step('every field shows the new value', () => doctorsPage.expectSavedValues(updated));
    await test.step('the list shows the new name instead of the old one', async () => {
      await doctorsPage.openList();
      await expect(doctorsPage.rowFor(updated.name)).toBeVisible();
      await expect(doctorsPage.rowFor(existing.name)).toHaveCount(0);
    });
  });

  test('should remove the doctor when user deletes it', async ({ doctorsPage, doctorsApi, cleanup }) => {
    const existing = await test.step('create a doctor to delete (through the API)', () =>
      doctorsApi.createRecord(toDoctorPayload(buildDoctor())));
    // Safety net only: does nothing if the test deleted it as expected.
    cleanup.add(`doctor "${existing.name}"`, () => doctorsApi.deleteIfExists(existing.id));

    await test.step('delete the doctor from the list', () => doctorsPage.deleteRecord(existing.name));
    await test.step('the doctor is gone from the list and the server', async () => {
      await expect(doctorsPage.rowFor(existing.name)).toHaveCount(0);
      expect((await doctorsApi.get(existing.id)).status()).toBe(404);
    });
  });

  test('should show the doctor created through the API with every field filled in', async ({
    doctorsPage,
    doctorsApi,
    cleanup,
  }) => {
    const created = await test.step('create a doctor through the API', () =>
      doctorsApi.createRecord(toDoctorPayload(buildDoctor())));
    cleanup.add(`doctor "${created.name}"`, () => doctorsApi.deleteIfExists(created.id));

    await test.step('the doctor appears in the list', async () => {
      await doctorsPage.openList();
      await expect(doctorsPage.rowFor(created.name)).toBeVisible();
    });
    await test.step('its page shows every field sent to the API', async () => {
      await doctorsPage.openRecord(created.name);
      await doctorsPage.expectSavedValues(toDoctorData(created));
    });
  });

  test('should not save a doctor when the name is left empty', async ({ page, doctorsPage }) => {
    // Every other field is filled, so only the missing name can block the save.
    const doctor = { ...buildDoctor(), name: '' };
    const createCalls = recordApiCalls(page, 'POST', ENDPOINTS.doctors);

    await test.step('open the new-doctor form', async () => {
      await doctorsPage.openList();
      await doctorsPage.openNewForm();
    });
    await test.step('fill in everything except the name and save', async () => {
      await doctorsPage.fillForm(doctor);
      await doctorsPage.submitNewForm();
    });
    await test.step('the form shows "Name is required" and stays open', async () => {
      await expect(doctorsPage.nameRequiredError).toBeVisible();
      await expect(doctorsPage.nameInput).toHaveAttribute('aria-invalid', 'true');
      await expect(page).toHaveURL('/doctors/new');
    });
    await test.step('nothing is sent to the server and the typed values are kept', async () => {
      expect(createCalls, 'no create-doctor request should be sent').toEqual([]);
      await expect(doctorsPage.websiteInput).toHaveValue(doctor.website);
      await expect(doctorsPage.emrIdInput).toHaveValue(doctor.emrId);
      await expect(doctorsPage.descriptionEditor).toHaveText(doctor.description);
    });
  });
});
