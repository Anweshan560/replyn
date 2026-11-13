import { test, expect } from '../../fixtures/test';
import { toContactPayload } from '../../api/ContactsApi';
import { ENDPOINTS } from '../../api/ResourceApi';
import { toTagPayload } from '../../api/SettingsApis';
import { toTicketPayload, type TicketStatus } from '../../api/TicketsApi';
import { env } from '../../config/env';
import { buildContact, buildTag, buildTicket } from '../../utils/testData';
import { knownBug } from '../../utils/knownBug';

/** Well-formed, but no record has it. */
const UNKNOWN_ID = '01a1aac4-be7e-7411-a745-000000000000';
const STATUSES: TicketStatus[] = ['pending', 'progress', 'pending-action', 'resolved'];

test.describe('Tickets API', { tag: ['@tickets'] }, () => {
  test.describe('create, read, update and delete', () => {
    test('should create a ticket and return every field that was sent', async ({ ticketsApi, cleanup }) => {
      const payload = toTicketPayload(buildTicket());

      const response = await test.step('POST a new ticket', () => ticketsApi.create(payload));
      const body = await response.json();
      if (body.data?.id) cleanup.add(`ticket ${body.data.id}`, () => ticketsApi.deleteIfExists(body.data.id));

      await test.step('responds 201 with every field and a new id', () => {
        expect(response.status()).toBe(201);
        expect(body.data).toMatchObject(payload);
        expect(body.data.id).toEqual(expect.any(String));
      });
    });

    for (const status of STATUSES) {
      test(`should accept the status ${status}`, async ({ ticketsApi, cleanup }) => {
        const created = await ticketsApi.createRecord({ ...toTicketPayload(buildTicket()), status });
        cleanup.add(`ticket ${created.id}`, () => ticketsApi.deleteIfExists(created.id));

        expect(created.status).toBe(status);
      });
    }

    test('should include a new ticket in the list', async ({ ticketsApi, cleanup }) => {
      const created = await ticketsApi.createRecord(toTicketPayload(buildTicket()));
      cleanup.add(`ticket ${created.id}`, () => ticketsApi.deleteIfExists(created.id));

      expect(await ticketsApi.listRecords()).toContainEqual(expect.objectContaining({ id: created.id }));
    });

    test('should update the name, description, status and order', async ({ ticketsApi, cleanup }) => {
      const created = await ticketsApi.createRecord(toTicketPayload(buildTicket()));
      cleanup.add(`ticket ${created.id}`, () => ticketsApi.deleteIfExists(created.id));
      const changes = { ...toTicketPayload(buildTicket()), status: 'resolved' as const, order: 7 };

      const response = await test.step('PATCH every field', () => ticketsApi.update(created.id, changes));
      await test.step('responds 200 and stores the new values', async () => {
        expect(response.status()).toBe(200);
        expect(await ticketsApi.getRecord(created.id)).toMatchObject(changes);
      });
    });

    test('should assign a ticket and take the assignee off again', async ({ ticketsApi, cleanup }) => {
      const created = await ticketsApi.createRecord(toTicketPayload(buildTicket()));
      cleanup.add(`ticket ${created.id}`, () => ticketsApi.deleteIfExists(created.id));

      await test.step('assign it to the test account', async () => {
        expect((await ticketsApi.update(created.id, { assignedTo: created.createdBy })).status()).toBe(200);
        expect((await ticketsApi.getRecord(created.id)).assignedTo).toBe(created.createdBy);
      });
      await test.step('clear the assignee', async () => {
        expect((await ticketsApi.update(created.id, { assignedTo: null })).status()).toBe(200);
        expect((await ticketsApi.getRecord(created.id)).assignedTo).toBeNull();
      });
    });

    test('should link a ticket to a contact', async ({ ticketsApi, contactsApi, cleanup }) => {
      const contact = await contactsApi.createRecord(toContactPayload(buildContact()));
      cleanup.add(`contact ${contact.id}`, () => contactsApi.deleteIfExists(contact.id));

      const created = await ticketsApi.createRecord({
        ...toTicketPayload(buildTicket()),
        contactId: contact.id,
      });
      cleanup.add(`ticket ${created.id}`, () => ticketsApi.deleteIfExists(created.id));

      expect((await ticketsApi.getRecord(created.id)).contactId).toBe(contact.id);
    });

    test('should delete a ticket so it can no longer be found', async ({ ticketsApi, cleanup }) => {
      const created = await ticketsApi.createRecord(toTicketPayload(buildTicket()));
      // Safety net only: does nothing if the test deleted it as expected.
      cleanup.add(`ticket ${created.id}`, () => ticketsApi.deleteIfExists(created.id));

      const response = await test.step('DELETE it', () => ticketsApi.delete(created.id));
      await test.step('responds 200, a GET afterwards 404, and a second DELETE 404', async () => {
        expect(response.status()).toBe(200);
        expect((await ticketsApi.get(created.id)).status()).toBe(404);
        expect((await ticketsApi.delete(created.id)).status()).toBe(404);
      });
    });
  });

  test.describe('validation', () => {
    test('should reject a ticket without a name or status with 422', async ({ ticketsApi, cleanup }) => {
      const response = await test.step('POST an empty body', () => ticketsApi.create({}));
      const body = await response.json();
      if (body.data?.id) cleanup.add('ticket', () => ticketsApi.deleteIfExists(body.data.id));

      await test.step('responds 422 naming both fields', () => {
        expect(response.status()).toBe(422);
        expect(body.message).toHaveProperty('name');
        expect(body.message).toHaveProperty('status');
      });
    });

    test('should reject a status that does not exist with 422', async ({ ticketsApi, cleanup }) => {
      const payload = { ...toTicketPayload(buildTicket()), status: 'nope' as TicketStatus };

      const response = await ticketsApi.create(payload);
      const body = await response.json();
      if (body.data?.id) cleanup.add('ticket', () => ticketsApi.deleteIfExists(body.data.id));

      expect(response.status()).toBe(422);
      expect(body.message).toHaveProperty('status');
    });

    test('should reject an assignee that is not a UUID with 422', async ({ ticketsApi, cleanup }) => {
      const response = await ticketsApi.create({ ...toTicketPayload(buildTicket()), assignedTo: 'nope' });
      const body = await response.json();
      if (body.data?.id) cleanup.add('ticket', () => ticketsApi.deleteIfExists(body.data.id));

      expect(response.status()).toBe(422);
      expect(body.message).toHaveProperty('assignedTo');
    });

    test('should reject an update to an empty name or unknown status with 422', async ({
      ticketsApi,
      cleanup,
    }) => {
      const created = await ticketsApi.createRecord(toTicketPayload(buildTicket()));
      cleanup.add(`ticket ${created.id}`, () => ticketsApi.deleteIfExists(created.id));

      expect((await ticketsApi.update(created.id, { name: '' })).status()).toBe(422);
      expect((await ticketsApi.update(created.id, { status: 'nope' as TicketStatus })).status()).toBe(422);
      expect(await ticketsApi.getRecord(created.id)).toMatchObject({
        name: created.name,
        status: created.status,
      });
    });

    test('should reject a name of only spaces with 422', async ({ ticketsApi, cleanup }) => {
      knownBug('ticket-blank-name');

      const response = await ticketsApi.create({ ...toTicketPayload(buildTicket()), name: '   ' });
      const body = await response.json();
      if (body.data?.id) cleanup.add('blank ticket', () => ticketsApi.deleteIfExists(body.data.id));

      expect(response.status()).toBe(422);
    });

    test('should reject a name over 200 characters with 422', async ({ ticketsApi, cleanup }) => {
      knownBug('ticket-long-name');
      const ticket = buildTicket();

      const response = await ticketsApi.create({
        ...toTicketPayload(ticket),
        name: ticket.name.padEnd(201, 'x'),
      });
      const body = await response.json();
      if (body.data?.id) cleanup.add('long ticket', () => ticketsApi.deleteIfExists(body.data.id));

      expect(response.status()).toBe(422);
    });

    test('should reject an assignee that does not exist with a 4xx', async ({ ticketsApi, cleanup }) => {
      knownBug('ticket-unknown-reference-500');

      const response = await ticketsApi.create({
        ...toTicketPayload(buildTicket()),
        assignedTo: UNKNOWN_ID,
      });
      const body = await response.json();
      if (body.data?.id) cleanup.add('ticket', () => ticketsApi.deleteIfExists(body.data.id));

      expect(response.status()).toBeLessThan(500);
      expect(response.status()).toBeGreaterThanOrEqual(400);
    });

    test('should reject a contact that does not exist with a 4xx', async ({ ticketsApi, cleanup }) => {
      knownBug('ticket-unknown-reference-500');

      const response = await ticketsApi.create({
        ...toTicketPayload(buildTicket()),
        contactId: UNKNOWN_ID,
      });
      const body = await response.json();
      if (body.data?.id) cleanup.add('ticket', () => ticketsApi.deleteIfExists(body.data.id));

      expect(response.status()).toBeLessThan(500);
      expect(response.status()).toBeGreaterThanOrEqual(400);
    });
  });

  test.describe('ids that do not exist', () => {
    test('should answer 404 for a ticket that does not exist', async ({ ticketsApi }) => {
      expect((await ticketsApi.get(UNKNOWN_ID)).status()).toBe(404);
      expect((await ticketsApi.update(UNKNOWN_ID, { name: 'nope' })).status()).toBe(404);
      expect((await ticketsApi.delete(UNKNOWN_ID)).status()).toBe(404);
    });

    test('should answer 400 for a malformed id', async ({ ticketsApi }) => {
      knownBug('ticket-malformed-id-500');

      expect((await ticketsApi.get('not-a-uuid')).status()).toBe(400);
    });
  });

  test.describe('comments', () => {
    test('should add a comment, show it on the ticket and delete it', async ({ ticketsApi, cleanup }) => {
      const created = await ticketsApi.createRecord(toTicketPayload(buildTicket()));
      cleanup.add(`ticket ${created.id}`, () => ticketsApi.deleteIfExists(created.id));
      const text = `Comment on ${created.name}`;

      const response = await test.step('POST a comment', () => ticketsApi.addComment(created.id, text));
      const comment = (await response.json()).data;
      await test.step('responds 201, and the ticket lists it', async () => {
        expect(response.status()).toBe(201);
        expect(comment).toMatchObject({ text, ticketId: created.id });
        expect((await ticketsApi.getRecord(created.id)).comments).toContainEqual(
          expect.objectContaining({ id: comment.id, text }),
        );
      });
      await test.step('DELETE it: the ticket no longer lists it', async () => {
        expect((await ticketsApi.deleteComment(created.id, comment.id)).status()).toBe(200);
        expect((await ticketsApi.getRecord(created.id)).comments ?? []).not.toContainEqual(
          expect.objectContaining({ id: comment.id }),
        );
      });
    });

    test('should reject a comment without text with 422', async ({ ticketsApi, cleanup }) => {
      const created = await ticketsApi.createRecord(toTicketPayload(buildTicket()));
      cleanup.add(`ticket ${created.id}`, () => ticketsApi.deleteIfExists(created.id));

      expect((await ticketsApi.addComment(created.id, '')).status()).toBe(422);
      expect((await ticketsApi.addComment(created.id)).status()).toBe(422);
    });

    test('should answer 404 for a comment that does not exist', async ({ ticketsApi, cleanup }) => {
      const created = await ticketsApi.createRecord(toTicketPayload(buildTicket()));
      cleanup.add(`ticket ${created.id}`, () => ticketsApi.deleteIfExists(created.id));

      expect((await ticketsApi.deleteComment(created.id, UNKNOWN_ID)).status()).toBe(404);
    });
  });

  test.describe('tags', () => {
    test('should add a tag to a ticket and remove it', async ({ ticketsApi, tagsApi, cleanup }) => {
      const tag = await tagsApi.createRecord(toTagPayload(buildTag()));
      cleanup.add(`tag ${tag.id}`, () => tagsApi.deleteIfExists(tag.id));
      const created = await ticketsApi.createRecord(toTicketPayload(buildTicket()));
      cleanup.add(`ticket ${created.id}`, () => ticketsApi.deleteIfExists(created.id));

      await test.step('add the tag: the ticket lists it', async () => {
        expect((await ticketsApi.addTags(created.id, [tag.id])).ok()).toBe(true);
        expect((await ticketsApi.getRecord(created.id)).tags).toContainEqual(
          expect.objectContaining({ id: tag.id }),
        );
      });
      await test.step('remove it: the ticket no longer lists it', async () => {
        expect((await ticketsApi.removeTag(created.id, tag.id)).ok()).toBe(true);
        expect((await ticketsApi.getRecord(created.id)).tags ?? []).not.toContainEqual(
          expect.objectContaining({ id: tag.id }),
        );
      });
    });

    test('should reject a tag that does not exist with a 4xx', async ({ ticketsApi, cleanup }) => {
      knownBug('ticket-tags-500');
      const created = await ticketsApi.createRecord(toTicketPayload(buildTicket()));
      cleanup.add(`ticket ${created.id}`, () => ticketsApi.deleteIfExists(created.id));

      const status = (await ticketsApi.addTags(created.id, [UNKNOWN_ID])).status();

      expect(status).toBeLessThan(500);
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test('should reject an empty list of tags with 422', async ({ ticketsApi, cleanup }) => {
      knownBug('ticket-tags-500');
      const created = await ticketsApi.createRecord(toTicketPayload(buildTicket()));
      cleanup.add(`ticket ${created.id}`, () => ticketsApi.deleteIfExists(created.id));

      expect((await ticketsApi.addTags(created.id, [])).status()).toBe(422);
    });
  });

  test('should reject a request without a login token with 401', async ({ request, apiHeaders }) => {
    const { authorization: _omitted, ...headersWithoutToken } = await apiHeaders();

    const response = await request.get(`${env.apiUrl}${ENDPOINTS.tickets}`, { headers: headersWithoutToken });

    expect(response.status()).toBe(401);
  });
});
