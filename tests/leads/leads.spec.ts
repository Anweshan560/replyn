import { test, expect } from '../../fixtures/test';
import { toContactPayload } from '../../api/ContactsApi';
import { LeadStagesSettingsPage } from '../../pages/leads/LeadsPage';
import { buildContact } from '../../utils/testData';

/**
 * Leads in the app: moving a lead with the panel's stage bar, the Lost reason a stage asks for,
 * and Settings → Lead stages. Each test opens a lead for its own new contact (through the API);
 * deleting the contact afterwards removes the lead.
 */
test.describe('Leads', { tag: ['@leads'] }, () => {
  test('should move a lead to another stage from the stage bar, and log the move', async ({
    leadsPage,
    leadsApi,
    contactsApi,
    cleanup,
  }) => {
    const contact = await contactsApi.createRecord(toContactPayload(buildContact()));
    cleanup.add(`contact ${contact.id} and its lead`, () => contactsApi.deleteIfExists(contact.id));
    const lead = await test.step('open a lead for a new contact (through the API)', () =>
      leadsApi.createRecord(contact.id));
    const trying = await leadsApi.stage('trying_to_contact');
    await leadsPage.openLead(lead.id);
    await expect(leadsPage.currentStageButton('New')).toBeVisible();

    await test.step('Move to Trying to contact, then Save', async () => {
      await leadsPage.startMove(trying.name);
      await leadsPage.saveMove(lead.id);
    });

    await test.step('the stage bar shows the new stage, and the activity logs the move', async () => {
      await expect(leadsPage.currentStageButton(trying.name)).toBeVisible();
      await expect(leadsPage.moveToButton('New')).toBeVisible();
      await expect(leadsPage.activity(`New → ${trying.name}`)).toBeVisible();
    });
    await test.step('the server has the lead in that stage', async () => {
      expect((await leadsApi.getRecord(lead.id)).stageId).toBe(trying.id);
    });
  });

  test('should not end a lead as Lost until a reason is picked', async ({
    leadsPage,
    leadsApi,
    contactsApi,
    cleanup,
  }) => {
    const contact = await contactsApi.createRecord(toContactPayload(buildContact()));
    cleanup.add(`contact ${contact.id} and its lead`, () => contactsApi.deleteIfExists(contact.id));
    const lead = await test.step('open a lead for a new contact (through the API)', () =>
      leadsApi.createRecord(contact.id));
    await leadsPage.openLead(lead.id);
    await leadsPage.startMove('Trying to contact');

    await test.step('pick Lost: it asks for the reason, and Save is off until one is picked', async () => {
      await leadsPage.pickStage('Lost');
      await expect(leadsPage.moveDialog.getByRole('grid', { name: 'Lost reason' })).toBeVisible();
      await expect(leadsPage.saveMoveButton).toBeDisabled();
    });
    await test.step('pick "No response" and Save', async () => {
      await leadsPage.pickAnswer('Lost reason', 'No response');
      await expect(leadsPage.saveMoveButton).toBeEnabled();
      await leadsPage.saveMove(lead.id);
    });
    await test.step('the server has the lead ended as Lost, with that reason', async () => {
      const [ended, lost, reason] = await Promise.all([
        leadsApi.getRecord(lead.id),
        leadsApi.stage('lost'),
        leadsApi.option('lost_reason', 'No response'),
      ]);
      expect(ended).toMatchObject({ stageId: lost.id, values: { lost_reason: { option: reason } } });
      expect(ended.endedAt).toEqual(expect.any(String));
    });
  });

  test('should list every stage in Settings → Lead stages, in its group, with how leads get there', async ({
    page,
    leadsApi,
  }) => {
    const settings = new LeadStagesSettingsPage(page);
    await settings.open();
    const stages = (await leadsApi.stages()).filter((stage) => !stage.hiddenAt);

    await test.step('the three groups are shown', async () => {
      for (const group of ['Not started', 'Open', 'Closed'] as const)
        await expect(settings.group(group)).toBeVisible();
    });
    for (const stage of stages) {
      // New leads land in the default stage by themselves, as do leads whose stage has autoMoves.
      const automatic = stage.isDefault || stage.autoMoves.length > 0;
      await test.step(`${stage.name}: its description, and ${automatic ? 'moves by itself' : 'By hand'}`, async () => {
        const card = settings.stage(stage.name);
        await expect(card).toBeVisible();
        await expect(card).toContainText(stage.description);
        if (automatic) await expect(card).toContainText('moves here by itself');
        else await expect(card).toContainText('By hand');
      });
    }
  });
});
