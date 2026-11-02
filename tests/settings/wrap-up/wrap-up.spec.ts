import { test, expect } from '../../../fixtures/test';
import { toClosingNotePayload } from '../../../api/SettingsApis';
import { ENDPOINTS } from '../../../api/ResourceApi';
import { toWrapUpOutcomePayload } from '../../../api/WrapUpApi';
import { recordApiCalls } from '../../../utils/network';
import { buildClosingNote, buildWrapUpOutcome, type ClosingNoteData } from '../../../utils/testData';

// The workspace has one wrap-up, so these tests run one at a time in the workspace-settings
// project, and each puts the wrap-up back as it found it.
test.describe('Settings → Wrap-Up', { tag: ['@settings', '@wrap-up'] }, () => {
  let closingNote: ClosingNoteData;
  let closingNoteId: string;

  test.beforeEach(async ({ wrapUpApi, closingNotesApi, cleanup }) => {
    // Cleanup runs in reverse: the wrap-up is restored first, then this closing note is deleted.
    closingNote = buildClosingNote();
    closingNoteId = (await closingNotesApi.createRecord(toClosingNotePayload(closingNote))).id;
    cleanup.add(`closing note ${closingNote.category}`, () => closingNotesApi.deleteIfExists(closingNoteId));
    // The page loads the closing notes once, so wait until the server lists the new one.
    await expect
      .poll(async () => (await closingNotesApi.findRecord(closingNoteId))?.id, {
        message: 'the new closing note should be listed',
        timeout: 15_000,
      })
      .toBe(closingNoteId);
    cleanup.add('restore the wrap-up', await wrapUpApi.rememberCurrent());
  });

  test('should open Wrap-Up from the Settings menu', async ({ page, wrapUpPage }) => {
    await test.step('go to Settings → Wrap-Up', () => wrapUpPage.openFromDashboard());
    await test.step('the page explains wrap-up and offers Create outcome', async () => {
      await expect(page.getByRole('heading', { name: 'Conversation wrap-up' })).toBeVisible();
      await expect(wrapUpPage.createOutcomeButton).toBeVisible();
    });
  });

  test('should save every field when user creates an outcome', async ({ wrapUpPage, wrapUpApi }) => {
    const outcome = buildWrapUpOutcome();

    await test.step('open Settings → Wrap-Up', () => wrapUpPage.open());
    await test.step('create an outcome: name, result, description and its closing note', () =>
      wrapUpPage.addOutcome(outcome, closingNote.category));
    await test.step('the page reports unsaved changes until saved', async () => {
      await expect(wrapUpPage.unsavedChanges).toBeVisible();
      await wrapUpPage.save();
    });

    await test.step('after a reload, the outcome shows every field', () =>
      wrapUpPage.expectSavedOutcome(outcome, closingNote.category));
    await test.step('the server stored it, with a step that closes the conversation', async () => {
      // The page gives the outcome and step ids of its own, so compare everything else.
      const { id: _id, steps: _steps, ...fields } = toWrapUpOutcomePayload(outcome, closingNoteId);
      expect(await wrapUpApi.listOutcomes()).toContainEqual(
        expect.objectContaining({
          ...fields,
          steps: [
            expect.objectContaining({
              type: 'close_conversation',
              config: { closingNoteIds: [closingNoteId] },
            }),
          ],
        }),
      );
    });
  });

  test('should save every change when user edits an outcome', async ({ wrapUpPage, wrapUpApi }) => {
    const original = buildWrapUpOutcome();
    await test.step('add an outcome to edit (through the API)', () =>
      wrapUpApi.addOutcome(toWrapUpOutcomePayload(original, closingNoteId)));
    const updated = buildWrapUpOutcome(original);

    await test.step('open Settings → Wrap-Up', () => wrapUpPage.open());
    await test.step('change its name, result and description, and save', async () => {
      await wrapUpPage.editOutcome(original.name, updated);
      await wrapUpPage.save();
    });

    await test.step('after a reload, the outcome shows every new value', () =>
      wrapUpPage.expectSavedOutcome(updated, closingNote.category));
    await test.step('the server stored the new values instead of the old ones', async () => {
      const outcomes = await wrapUpApi.listOutcomes();
      expect(outcomes).toContainEqual(
        expect.objectContaining({
          name: updated.name,
          category: toWrapUpOutcomePayload(updated, closingNoteId).category,
          description: updated.description,
        }),
      );
      expect(outcomes.map((outcome) => outcome.name)).not.toContain(original.name);
    });
  });

  test('should remove the outcome when user deletes it and saves', async ({ wrapUpPage, wrapUpApi }) => {
    const outcome = buildWrapUpOutcome();
    await test.step('add an outcome to delete (through the API)', () =>
      wrapUpApi.addOutcome(toWrapUpOutcomePayload(outcome, closingNoteId)));

    await test.step('open Settings → Wrap-Up', () => wrapUpPage.open());
    await test.step('delete the outcome and save', async () => {
      await wrapUpPage.deleteOutcome(outcome.name);
      await wrapUpPage.save();
    });

    await test.step('after a reload it is not listed, and the server no longer has it', async () => {
      await wrapUpPage.open();
      await expect(wrapUpPage.outcomeEntry(outcome.name)).toHaveCount(0);
      expect((await wrapUpApi.listOutcomes()).map((item) => item.name)).not.toContain(outcome.name);
    });
  });

  test('should ask for a closing note and not save an outcome without one', async ({ page, wrapUpPage }) => {
    const createCalls = recordApiCalls(page, 'POST', ENDPOINTS.wrapUp);
    const updateCalls = recordApiCalls(page, 'PATCH', new RegExp(`^${ENDPOINTS.wrapUp}/`));

    await test.step('open Settings → Wrap-Up and start an outcome without a closing note', async () => {
      await wrapUpPage.open();
      await wrapUpPage.createOutcomeButton.click();
      await wrapUpPage.fillOutcome(buildWrapUpOutcome());
    });
    await test.step('press Save changes', () => wrapUpPage.saveButton.click());

    await test.step('the step asks for a closing note, and nothing is sent to the server', async () => {
      await expect(wrapUpPage.missingClosingNote).toBeVisible();
      await expect(wrapUpPage.unsavedChanges).toBeVisible();
      expect([...createCalls, ...updateCalls]).toEqual([]);
    });
  });

  test('should save an edit to an outcome that was created through the API without ids', async ({
    wrapUpPage,
    wrapUpApi,
  }) => {
    test.fail(
      true,
      'Known bug (2026-10-31): the API accepts outcomes and steps without an `id`, but the page then marks ' +
        'such an outcome "Needs attention" on Save, shows no reason, and saves nothing. Remove this line once fixed.',
    );
    const original = buildWrapUpOutcome();
    await test.step('add an outcome without ids (through the API)', () =>
      wrapUpApi.addOutcome(toWrapUpOutcomePayload(original, closingNoteId, { withIds: false })));
    const updated = buildWrapUpOutcome(original);

    await test.step('open Settings → Wrap-Up, change the outcome and press Save changes', async () => {
      await wrapUpPage.open();
      await wrapUpPage.editOutcome(original.name, updated);
      await wrapUpPage.saveButton.click();
    });
    await test.step('the server stores the new name', async () => {
      // Poll rather than wait for the save request: today none is sent, and the test must end quickly.
      await expect
        .poll(async () => (await wrapUpApi.listOutcomes()).map((outcome) => outcome.name))
        .toContain(updated.name);
    });
  });
});
