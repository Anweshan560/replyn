import { test, expect } from '../../fixtures/test';
import type { Cleanup } from '../../fixtures/test';
import { toContactPayload, type Contact, type ContactsApi } from '../../api/ContactsApi';
import type { Lead, LeadsApi } from '../../api/LeadsApi';
import { buildContact, buildPatient, nextClinicDay } from '../../utils/testData';
import { bookThroughApi, createDoctorAndTreatment } from '../clinic/bookingSetup';

/** An id in the right format that no stage has. */
const MISSING_ID = '00000000-0000-7000-8000-000000000000';
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

/** A new contact with a lead opened for them by hand. Deleting the contact removes the lead. */
async function contactWithLead(
  apis: { contactsApi: ContactsApi; leadsApi: LeadsApi },
  cleanup: Cleanup,
): Promise<{ contact: Contact; lead: Lead }> {
  return test.step('create a contact and open a lead for them (through the API)', async () => {
    const contact = await apis.contactsApi.createRecord(toContactPayload(buildContact()));
    cleanup.add(`contact ${contact.id} and its leads`, () => apis.contactsApi.deleteIfExists(contact.id));
    return { contact, lead: await apis.leadsApi.createRecord(contact.id) };
  });
}

/**
 * Leads and their stages: opening a lead, moving it, and the rules a stage sets (a follow-up date,
 * a required reason, no way back once a lead has ended). Each test uses its own new contact.
 */
test.describe('Leads API', { tag: ['@leads'] }, () => {
  test.describe('stages', () => {
    test('should have one default stage, in New, and every stage in a known category', async ({
      leadsApi,
    }) => {
      const stages = await test.step('GET the lead stages', () => leadsApi.stages());

      await test.step('exactly one is the default, and it is the New stage', () => {
        const defaults = stages.filter((stage) => stage.isDefault);
        expect(defaults).toHaveLength(1);
        expect(defaults[0].category).toBe('new');
      });
      await test.step('there is a stage for each way a lead ends: won, lost and disqualified', () => {
        const categories = new Set(stages.map((stage) => stage.category));
        for (const category of ['new', 'open', 'won', 'lost', 'disqualified'])
          expect(categories).toContain(category);
        for (const stage of stages) {
          expect(['new', 'open', 'won', 'lost', 'disqualified'], stage.name).toContain(stage.category);
          expect(['none', 'optional', 'required'], stage.name).toContain(stage.followUp);
        }
      });
      await test.step('every field a stage asks for exists', async () => {
        const fieldKeys = (await leadsApi.fields()).map((field) => field.key);
        for (const stage of stages) {
          for (const ask of stage.asks)
            expect(fieldKeys, `${stage.name} asks for ${ask.fieldKey}`).toContain(ask.fieldKey);
        }
      });
    });

    test("should count each status's leads the same as the stages do", async ({ leadsApi }) => {
      // Other tests open and move leads at the same time, so compare numbers read together, and retry.
      await expect(async () => {
        const [stages, counts] = await Promise.all([leadsApi.stages(), leadsApi.counts()]);
        const byCategory: Record<string, number> = { new: 0, open: 0, won: 0, lost: 0, disqualified: 0 };
        for (const stage of stages.filter((candidate) => !candidate.hiddenAt))
          byCategory[stage.category] += stage.leadCount;
        const total = Object.values(byCategory).reduce((sum, count) => sum + count, 0);
        expect(counts).toEqual({ all: total, ...byCategory });
      }).toPass({ timeout: 30_000 });
    });
  });

  test.describe('opening a lead', () => {
    test('should open a lead by hand in the default stage', async ({ contactsApi, leadsApi, cleanup }) => {
      const { contact, lead } = await contactWithLead({ contactsApi, leadsApi }, cleanup);
      const defaultStage = (await leadsApi.stages()).find((stage) => stage.isDefault)!;

      await test.step('the lead is in New, opened by hand, and still open', () => {
        expect(lead).toMatchObject({
          contactId: contact.id,
          stageId: defaultStage.id,
          openedFrom: 'manual',
          source: 'manual',
          endedAt: null,
          followUpAt: null,
          values: {},
        });
        expect(lead.createdByUserId).toEqual(expect.any(String));
      });
      await test.step('GET returns the same lead', async () => {
        expect(await leadsApi.getRecord(lead.id)).toMatchObject({ id: lead.id, stageId: defaultStage.id });
      });
    });

    test('should refuse a second open lead for the same contact with 409', async ({
      contactsApi,
      leadsApi,
      cleanup,
    }) => {
      const { contact } = await contactWithLead({ contactsApi, leadsApi }, cleanup);

      const response = await test.step('POST another lead for the same contact', () =>
        leadsApi.create(contact.id));

      await test.step('responds 409 "already has an open lead"', async () => {
        expect(response.status()).toBe(409);
        expect((await response.json()).message).toBe('This contact already has an open lead');
      });
    });

    test('should open a lead in Booked when a new patient books a visit', async ({
      appointmentsApi,
      contactsApi,
      doctorsApi,
      treatmentsApi,
      leadsApi,
      cleanup,
    }) => {
      const setup = await createDoctorAndTreatment({ doctorsApi, treatmentsApi }, cleanup);
      const patient = buildPatient();
      await test.step('book a visit next week for a new patient', () =>
        bookThroughApi({ appointmentsApi, contactsApi }, cleanup, setup, patient, nextClinicDay(10, 0, 7)));
      const booked = await leadsApi.stage('booked');

      await test.step('the patient has one lead, opened by the booking, in Booked', async () => {
        await expect
          .poll(async () => (await leadsApi.forContact(patient.lastName)).length, { timeout: 15_000 })
          .toBe(1);
        const [lead] = await leadsApi.forContact(patient.lastName);
        expect(lead).toMatchObject({ stageId: booked.id, openedFrom: 'booking' });
        expect(booked.autoMoves).toContain('booked');
      });
    });

    test("should remove a contact's leads with the contact", async ({ contactsApi, leadsApi, cleanup }) => {
      const contact = await contactsApi.createRecord(toContactPayload(buildContact()));
      cleanup.add(`contact ${contact.id}`, () => contactsApi.deleteIfExists(contact.id));
      const lead = await leadsApi.createRecord(contact.id);

      await test.step('delete the contact', async () => {
        expect((await contactsApi.delete(contact.id)).ok()).toBe(true);
      });

      await test.step('the lead is gone: 404 "No lead found"', async () => {
        const response = await leadsApi.get(lead.id);
        expect(response.status()).toBe(404);
        expect((await response.json()).message).toBe('No lead found');
      });
    });
  });

  test.describe('moving a lead', () => {
    test('should move a lead to an open stage that asks for nothing', async ({
      contactsApi,
      leadsApi,
      cleanup,
    }) => {
      const { lead } = await contactWithLead({ contactsApi, leadsApi }, cleanup);
      const trying = await leadsApi.stage('trying_to_contact');

      const response = await test.step('move it to Trying to contact', () =>
        leadsApi.move(lead.id, { stageId: trying.id }));

      await test.step('responds 201; the lead is there and still open', async () => {
        expect(response.status()).toBe(201);
        expect((await response.json()).data).toMatchObject({ stageId: trying.id, endedAt: null });
        expect((await leadsApi.getRecord(lead.id)).stageId).toBe(trying.id);
      });
    });

    test('should need a follow-up date to move into a stage that requires one', async ({
      contactsApi,
      leadsApi,
      cleanup,
    }) => {
      const { lead } = await contactWithLead({ contactsApi, leadsApi }, cleanup);
      const inTouch = await leadsApi.stage('in_touch');
      expect(inTouch.followUp, 'In touch should require a follow-up').toBe('required');

      await test.step('without one: 400 "Pick when to follow up", and the lead stays put', async () => {
        const response = await leadsApi.move(lead.id, { stageId: inTouch.id });
        expect(response.status()).toBe(400);
        expect((await response.json()).message).toBe(
          `Pick when to follow up before moving to ${inTouch.name}`,
        );
        expect((await leadsApi.getRecord(lead.id)).stageId).toBe(lead.stageId);
      });
      await test.step('with one: moved, and the follow-up is saved', async () => {
        const followUpAt = tomorrow();
        const response = await leadsApi.move(lead.id, { stageId: inTouch.id, followUpAt });
        expect(response.status()).toBe(201);
        expect((await response.json()).data).toMatchObject({ stageId: inTouch.id, followUpAt });
      });
    });

    for (const { key, fieldKey, answer } of [
      { key: 'lost', fieldKey: 'lost_reason', answer: 'No response' },
      { key: 'disqualified', fieldKey: 'disqualified_reason', answer: undefined },
    ]) {
      test(`should need a reason to end a lead as ${key}, then end it`, async ({
        contactsApi,
        leadsApi,
        cleanup,
      }) => {
        const { lead } = await contactWithLead({ contactsApi, leadsApi }, cleanup);
        const stage = await leadsApi.stage(key);
        const field = (await leadsApi.fields()).find((candidate) => candidate.key === fieldKey)!;
        const optionId = answer
          ? await leadsApi.option(fieldKey, answer)
          : field.options.find((option) => !option.archived)!.id;

        await test.step(`without a reason: 400 "Fill in ${field.label}", and the lead stays open`, async () => {
          const response = await leadsApi.move(lead.id, { stageId: stage.id });
          expect(response.status()).toBe(400);
          expect((await response.json()).message).toBe(`Fill in ${field.label}`);
          expect((await leadsApi.getRecord(lead.id)).endedAt).toBeNull();
        });
        await test.step('with a reason: the lead ends, keeping the reason and where it came from', async () => {
          const response = await leadsApi.move(lead.id, {
            stageId: stage.id,
            values: { [fieldKey]: optionId },
          });
          expect(response.status()).toBe(201);
          const ended: Lead = (await response.json()).data;
          expect(ended).toMatchObject({
            stageId: stage.id,
            endedFromStageId: lead.stageId,
            values: { [fieldKey]: { option: optionId } },
          });
          expect(ended.endedAt).toEqual(expect.any(String));
        });
      });
    }

    test('should not reopen a lead that has ended', async ({ contactsApi, leadsApi, cleanup }) => {
      const { lead } = await contactWithLead({ contactsApi, leadsApi }, cleanup);
      const [lost, trying] = await Promise.all([leadsApi.stage('lost'), leadsApi.stage('trying_to_contact')]);
      await test.step('end it as Lost', async () => {
        const values = { lost_reason: await leadsApi.option('lost_reason', 'No response') };
        expect((await leadsApi.move(lead.id, { stageId: lost.id, values })).status()).toBe(201);
      });

      const response = await test.step('try to move it back to Trying to contact', () =>
        leadsApi.move(lead.id, { stageId: trying.id }));

      await test.step('responds 422 "has ended", and it stays Lost', async () => {
        expect(response.status()).toBe(422);
        expect((await response.json()).message).toBe("This lead has ended, so it can't be opened again.");
        expect((await leadsApi.getRecord(lead.id)).stageId).toBe(lost.id);
      });
    });

    test('should let a contact have a new lead after the last one ended', async ({
      contactsApi,
      leadsApi,
      cleanup,
    }) => {
      const { contact, lead } = await contactWithLead({ contactsApi, leadsApi }, cleanup);
      const lost = await leadsApi.stage('lost');
      await test.step('end the first lead as Lost', async () => {
        const values = { lost_reason: await leadsApi.option('lost_reason', 'No response') };
        expect((await leadsApi.move(lead.id, { stageId: lost.id, values })).status()).toBe(201);
      });

      const response = await test.step('open another lead for the contact', () =>
        leadsApi.create(contact.id));

      await test.step('responds 201 with a new lead in New', async () => {
        expect(response.status()).toBe(201);
        const second: Lead = (await response.json()).data;
        expect(second.id).not.toBe(lead.id);
        expect(second.endedAt).toBeNull();
      });
    });

    test.describe('validation', () => {
      test('should reject a move without a stage, or with a stage id that is not a UUID, with 422', async ({
        contactsApi,
        leadsApi,
        cleanup,
      }) => {
        const { lead } = await contactWithLead({ contactsApi, leadsApi }, cleanup);
        for (const move of [{}, { stageId: 'not-a-stage' }]) {
          await test.step(`move with ${JSON.stringify(move)}: 422 "stageId must be a UUID"`, async () => {
            const response = await leadsApi.move(lead.id, move);
            expect(response.status()).toBe(422);
            expect((await response.json()).message).toEqual({ stageId: 'stageId must be a UUID' });
          });
        }
      });

      test('should answer 400 "That stage no longer exists" for a stage id no stage has', async ({
        contactsApi,
        leadsApi,
        cleanup,
      }) => {
        const { lead } = await contactWithLead({ contactsApi, leadsApi }, cleanup);

        const response = await test.step('move to a stage that does not exist', () =>
          leadsApi.move(lead.id, { stageId: MISSING_ID }));

        await test.step('responds 400 and the lead stays put', async () => {
          expect(response.status()).toBe(400);
          expect((await response.json()).message).toBe('That stage no longer exists');
          expect((await leadsApi.getRecord(lead.id)).stageId).toBe(lead.stageId);
        });
      });
    });
  });
});
