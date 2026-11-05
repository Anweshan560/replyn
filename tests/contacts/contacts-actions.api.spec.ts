import { test as base, expect } from '../../fixtures/test';
import { toContactPayload, type Contact, type ContactEvent } from '../../api/ContactsApi';
import { ENDPOINTS } from '../../api/ResourceApi';
import { toClosingNotePayload } from '../../api/SettingsApis';
import { env } from '../../config/env';
import { buildClosingNote, buildContact, buildContactNote, pickRandom } from '../../utils/testData';
import { knownBug } from '../../utils/knownBug';

/** An id in the right format that nothing has. */
const MISSING_ID = '00000000-0000-7000-8000-000000000000';

/** Every test works on its own contact, so blocking or resolving never touches real contacts. */
const test = base.extend<{ contact: Contact }>({
  contact: async ({ contactsApi }, use) => {
    const contact = await contactsApi.createRecord(toContactPayload(buildContact()));
    await use(contact);
    await contactsApi.deleteIfExists(contact.id);
  },
});

/** The timeline's newest entry of a type. Timelines are newest first. */
function latest(events: ContactEvent[], type: string): ContactEvent['activity'] {
  return events.find((event) => event.activity?.type === type)?.activity;
}

// The API side of the row actions and the side panel; see contacts-row-actions.spec.ts and
// contacts-panel.spec.ts for the same actions through the page.
test.describe('Contact actions API', { tag: ['@contacts'] }, () => {
  test.describe('block', () => {
    test('should block a contact and unblock it, and log both on the timeline', async ({
      contactsApi,
      contact,
    }) => {
      const blocked = await test.step('PATCH blocked: true', () =>
        contactsApi.update(contact.id, { blocked: true }));

      await test.step('responds 200 and the server has it blocked', async () => {
        expect(blocked.status()).toBe(200);
        expect((await (await contactsApi.get(contact.id)).json()).data.blocked).toBe(true);
      });

      const unblocked = await test.step('PATCH blocked: false', () =>
        contactsApi.update(contact.id, { blocked: false }));

      await test.step('responds 200 and the server has it unblocked', async () => {
        expect(unblocked.status()).toBe(200);
        expect((await (await contactsApi.get(contact.id)).json()).data.blocked).toBe(false);
      });
      await test.step('the timeline has the block and the unblock', async () => {
        const events = await contactsApi.eventRecords(contact.id);
        expect(latest(events, 'block')?.payload).toMatchObject({ blocked: true });
        expect(latest(events, 'unblock')?.payload).toMatchObject({ blocked: false });
      });
    });

    test('should reject a blocked value that is not true or false with 422', async ({
      contactsApi,
      contact,
    }) => {
      const response = await test.step('PATCH blocked: "yes"', () =>
        contactsApi.update(contact.id, { blocked: 'yes' as unknown as boolean }));

      await test.step('responds 422 and the contact stays unblocked', async () => {
        expect(response.status()).toBe(422);
        expect((await response.json()).message.blocked).toBe('blocked must be a boolean value');
        expect((await (await contactsApi.get(contact.id)).json()).data.blocked).toBe(false);
      });
    });
  });

  test.describe('opt out of broadcasts', () => {
    test('should opt a contact out and back in, and log both on the timeline', async ({
      contactsApi,
      contact,
    }) => {
      const out = await test.step('PATCH optedOut: true', () =>
        contactsApi.update(contact.id, { optedOut: true }));

      await test.step('responds 200 and the server stored when', async () => {
        expect(out.status()).toBe(200);
        expect((await (await contactsApi.get(contact.id)).json()).data.optedOutAt).toEqual(
          expect.any(String),
        );
      });

      const back = await test.step('PATCH optedOut: false', () =>
        contactsApi.update(contact.id, { optedOut: false }));

      await test.step('responds 200 and the contact is opted in again', async () => {
        expect(back.status()).toBe(200);
        expect((await (await contactsApi.get(contact.id)).json()).data.optedOutAt).toBeNull();
      });
      await test.step('the timeline says a teammate did both', async () => {
        const events = await contactsApi.eventRecords(contact.id);
        expect(latest(events, 'opt_out')?.payload).toMatchObject({ source: 'teammate' });
        expect(latest(events, 'opt_in')?.payload).toMatchObject({ source: 'teammate' });
      });
    });

    test('should keep the first opt-out time when opted out twice', async ({ contactsApi, contact }) => {
      const first = await test.step('opt the contact out', async () =>
        (await (await contactsApi.update(contact.id, { optedOut: true })).json()).data.optedOutAt);

      const response = await test.step('opt it out again', () =>
        contactsApi.update(contact.id, { optedOut: true }));

      await test.step('responds 200 with the same time', async () => {
        expect(response.status()).toBe(200);
        expect((await response.json()).data.optedOutAt).toBe(first);
      });
    });

    test('should reject an optedOut value that is not true or false with 422', async ({
      contactsApi,
      contact,
    }) => {
      const response = await test.step('PATCH optedOut: "yes"', () =>
        contactsApi.update(contact.id, { optedOut: 'yes' as unknown as boolean }));

      await test.step('responds 422 and the contact stays opted in', async () => {
        expect(response.status()).toBe(422);
        expect((await response.json()).message.optedOut).toBe('optedOut must be a boolean value');
        expect((await (await contactsApi.get(contact.id)).json()).data.optedOutAt).toBeNull();
      });
    });
  });

  test.describe('lifecycle stage', () => {
    test('should move a contact to a new stage and log where it came from', async ({
      contactsApi,
      lifecyclesApi,
      contact,
    }) => {
      const target = pickRandom(
        (await lifecyclesApi.openStages()).filter((stage) => stage.id !== contact.lifecycleId),
      );

      const response = await test.step(`PATCH the stage to "${target.name}"`, () =>
        contactsApi.update(contact.id, { lifecycleId: target.id }));

      await test.step('responds 200 and the server stored the stage', async () => {
        expect(response.status()).toBe(200);
        expect((await (await contactsApi.get(contact.id)).json()).data.lifecycleId).toBe(target.id);
      });
      await test.step('the timeline has the change, from the old stage to the new one', async () => {
        expect(latest(await contactsApi.eventRecords(contact.id), 'lifecycle_change')?.payload).toEqual({
          lifecycleId: target.id,
          fromLifecycleId: contact.lifecycleId,
        });
      });
    });

    for (const [label, lifecycleId] of [
      ['a stage id no stage has', MISSING_ID],
      ['a stage id that is not a UUID', 'nope'],
    ]) {
      test(`should reject ${label}`, async ({ contactsApi, contact }) => {
        knownBug('contact-bad-stage-500');

        const response = await test.step('PATCH the stage', () =>
          contactsApi.update(contact.id, { lifecycleId }));

        await test.step('responds with a 4xx error', () => {
          expect(response.status()).toBeGreaterThanOrEqual(400);
          expect(response.status()).toBeLessThan(500);
        });
      });
    }
  });

  test.describe('notes', () => {
    test('should save a note and show it on the timeline', async ({ contactsApi, contact }) => {
      const text = buildContactNote();

      const response = await test.step('POST the note', () =>
        contactsApi.addActivity(contact.id, { type: 'note', payload: { text }, mentioned: [] }));

      await test.step('responds 201 with the note', async () => {
        expect(response.status()).toBe(201);
        expect((await response.json()).data).toMatchObject({
          type: 'note',
          contactId: contact.id,
          payload: { text },
        });
      });
      await test.step('the timeline has it', async () => {
        expect(latest(await contactsApi.eventRecords(contact.id), 'note')?.payload).toEqual({ text });
      });
    });

    for (const [label, body] of [
      ['with empty text', { type: 'note', payload: { text: '' } }],
      ['without a payload', { type: 'note' }],
    ] as const) {
      test(`should reject a note ${label}`, async ({ contactsApi, contact }) => {
        knownBug('contact-empty-note');

        const response = await test.step('POST the note', () => contactsApi.addActivity(contact.id, body));

        await test.step('responds 422', () => expect(response.status()).toBe(422));
      });
    }

    for (const [label, type] of [
      ['no type', undefined],
      ['an unknown type', 'nope'],
    ] as const) {
      test(`should reject an activity with ${label} with 422`, async ({ contactsApi, contact }) => {
        const response = await test.step('POST the activity', () =>
          contactsApi.addActivity(contact.id, { type, payload: { text: buildContactNote() } }));

        await test.step('responds 422 with an error about the type', async () => {
          expect(response.status()).toBe(422);
          expect((await response.json()).message).toHaveProperty('type');
        });
      });
    }
  });

  test.describe('resolve', () => {
    test('should close a conversation with a closing note and reopen it', async ({
      contactsApi,
      closingNotesApi,
      contact,
      cleanup,
    }) => {
      const closing = await test.step('create a closing note category', () =>
        closingNotesApi.createRecord(toClosingNotePayload(buildClosingNote())));
      cleanup.add(`closing note ${closing.category}`, () => closingNotesApi.deleteIfExists(closing.id));
      const closingNote = {
        topicId: closing.id,
        topicName: closing.category,
        summary: `Resolved by the test: ${closing.description}`,
      };

      const closed = await test.step('PATCH status: closed with the closing note', () =>
        contactsApi.update(contact.id, { status: 'closed', closingNote }));

      await test.step('responds 200 and the server has it closed with that closing note', async () => {
        expect(closed.status()).toBe(200);
        expect((await (await contactsApi.get(contact.id)).json()).data).toMatchObject({
          status: 'closed',
          lastClosingNoteId: closing.id,
        });
      });
      await test.step('the timeline has the closing note', async () => {
        expect(
          latest(await contactsApi.eventRecords(contact.id), 'conversation_status_change')?.payload,
        ).toMatchObject({ status: 'closed', closingNote });
      });

      const reopened = await test.step('PATCH status: open', () =>
        contactsApi.update(contact.id, { status: 'open' }));

      await test.step('responds 200, and the timeline has it reopened', async () => {
        expect(reopened.status()).toBe(200);
        expect((await (await contactsApi.get(contact.id)).json()).data.status).toBe('open');
        expect(
          latest(await contactsApi.eventRecords(contact.id), 'conversation_status_change')?.payload,
        ).toMatchObject({ status: 'open' });
      });
    });

    test('should reject a closing note category that does not exist', async ({ contactsApi, contact }) => {
      knownBug('closing-note-unknown-topic');

      const response = await test.step('PATCH status: closed with an unknown category', () =>
        contactsApi.update(contact.id, {
          status: 'closed',
          closingNote: { topicId: MISSING_ID, topicName: 'nope', summary: 'nope' },
        }));

      await test.step('responds with a 4xx error', () => {
        expect(response.status()).toBeGreaterThanOrEqual(400);
        expect(response.status()).toBeLessThan(500);
      });
    });

    test('should reject an unknown status with 422', async ({ contactsApi, contact }) => {
      const response = await test.step('PATCH status: "nope"', () =>
        contactsApi.update(contact.id, { status: 'nope' as Contact['status'] }));

      await test.step('responds 422 and the conversation stays open', async () => {
        expect(response.status()).toBe(422);
        expect((await response.json()).message).toHaveProperty('status');
        expect((await (await contactsApi.get(contact.id)).json()).data.status).toBe('open');
      });
    });
  });

  test.describe('unknown contacts and login', () => {
    test('should answer 404 "No such contact" for an id no contact has', async ({ contactsApi }) => {
      for (const [label, send] of [
        ['PATCH', () => contactsApi.update(MISSING_ID, { blocked: true })],
        ['a note', () => contactsApi.addActivity(MISSING_ID, { type: 'note', payload: { text: 'x' } })],
      ] as const) {
        await test.step(`${label} responds 404`, async () => {
          const response = await send();
          expect(response.status()).toBe(404);
          expect((await response.json()).message).toBe('No such contact');
        });
      }
    });

    test('should answer 400 for a malformed contact id', async ({ contactsApi }) => {
      for (const [label, send] of [
        ['PATCH', () => contactsApi.update('not-a-uuid', { blocked: true })],
        ['a note', () => contactsApi.addActivity('not-a-uuid', { type: 'note', payload: { text: 'x' } })],
      ] as const) {
        await test.step(`${label} responds 400`, async () => {
          expect((await send()).status()).toBe(400);
        });
      }
    });

    test('should reject actions without a login token with 401 and change nothing', async ({
      request,
      apiHeaders,
      contactsApi,
      contact,
    }) => {
      const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();
      const url = `${env.apiUrl}${ENDPOINTS.contacts}/${contact.id}`;

      await test.step('blocking without a token responds 401', async () => {
        const response = await request.patch(url, { headers: headersWithoutToken, data: { blocked: true } });
        expect(response.status()).toBe(401);
      });
      await test.step('a note without a token responds 401', async () => {
        const response = await request.post(`${url}/activity`, {
          headers: headersWithoutToken,
          data: { type: 'note', payload: { text: buildContactNote() } },
        });
        expect(response.status()).toBe(401);
      });
      await test.step('the contact is not blocked and has no note', async () => {
        expect((await (await contactsApi.get(contact.id)).json()).data.blocked).toBe(false);
        expect(latest(await contactsApi.eventRecords(contact.id), 'note')).toBeUndefined();
      });
    });
  });
});
