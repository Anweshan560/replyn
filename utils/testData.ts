// US English locale, so names, words and URLs always come from the English data set.
import { fakerEN_US as faker } from '@faker-js/faker';

/** Fields that both doctors and treatments have, as typed into the form. */
export type ClinicRecordData = {
  name: string;
  /** "Page on your website". */
  website: string;
  /** "ID in your EMR". */
  emrId: string;
  description: string;
};

export type DoctorData = ClinicRecordData;

/** Prices are strings because that is what the form's number inputs hold. */
export type TreatmentData = ClinicRecordData & {
  price: string;
  discountedPrice: string;
};

/**
 * The colour swatches in the department form: the name screen readers announce, and the hex
 * code the API stores for it.
 */
export const DEPARTMENT_COLORS = {
  'vibrant cyan blue': '#3B82F6',
  'green cyan': '#10B981',
  'vibrant orange': '#F59E0B',
  'vibrant red': '#EF4444',
  'vibrant purple': '#8B5CF6',
  'vibrant pink': '#EC4899',
  'light cyan': '#14B8A6',
  'grayish cyan blue': '#64748B',
} as const;

export type DepartmentColorName = keyof typeof DEPARTMENT_COLORS;

/** A department as typed into the Add/Edit Department dialog. */
export type DepartmentData = {
  name: string;
  description: string;
  colorName: DepartmentColorName;
  /** "External ID (optional)". */
  externalId: string;
};

const TREATMENTS = [
  'Botox',
  'Dermal Fillers',
  'Laser Hair Removal',
  'Chemical Peel',
  'Microneedling',
  'HydraFacial',
  'Teeth Whitening',
  'PRP Hair Therapy',
];

const DEPARTMENTS = [
  'Cardiology',
  'Dermatology',
  'Orthodontics',
  'Aesthetics',
  'Physiotherapy',
  'Pediatrics',
  'Radiology',
  'Nutrition',
];

const DEPARTMENT_FOCUS = [
  'routine check-ups and follow-up visits',
  'new patient consultations',
  'urgent same-day appointments',
  'long-term treatment plans',
];

const SPECIALTIES = [
  'dermatology',
  'cosmetic dentistry',
  'aesthetic medicine',
  'plastic surgery',
  'skin care',
  'hair restoration',
];

const PATIENT_TRAITS = [
  'calm and patient with nervous patients',
  'known for clear, friendly explanations',
  'focused on natural-looking results',
  'careful to answer every question before treatment',
];

const AUDIENCES = [
  'adults with sensitive skin',
  'first-time patients',
  'anyone looking for a quick refresh',
  'patients who want subtle results',
];

const RECOVERY = [
  'Most patients return to normal activities the same day.',
  'Mild redness usually fades within a day or two.',
  'No downtime is needed after the session.',
  'Some swelling is normal and settles within a week.',
];

/**
 * Marks every record the tests create: `qa` and six digits (e.g. "Botox qa482913"). The number
 * keeps names unique (two runs can pick the same fake name, and tests find and delete their own
 * rows by name); the `qa` lets the clean-up job (tests/cleanup) tell test data from real data.
 * Lower case, because some fields (e.g. contact field keys) only allow lower case.
 */
export const TEST_DATA_MARKER = /qa\d{6}/i;

function uniqueSuffix(): string {
  return `qa${faker.string.numeric({ length: 6, allowLeadingZeros: false })}`;
}

/** Any one of `items`, picked at random. */
export function pickRandom<T>(items: readonly T[]): T {
  return faker.helpers.arrayElement(items);
}

/** A realistic doctor with a unique name. */
export function buildDoctor(): DoctorData {
  return {
    // First and last name only: fullName() can add prefixes like "Mrs." or suffixes like "Jr.".
    name: `Dr. ${faker.person.firstName()} ${faker.person.lastName()} ${uniqueSuffix()}`,
    website: faker.internet.url(),
    emrId: `DR-${faker.string.numeric(4)}`,
    description:
      `Specialist in ${faker.helpers.arrayElement(SPECIALTIES)} with ` +
      `${faker.number.int({ min: 3, max: 25 })} years of experience, ` +
      `${faker.helpers.arrayElement(PATIENT_TRAITS)}.`,
  };
}

/** A realistic treatment with a unique name and a discount below its price. */
export function buildTreatment(): TreatmentData {
  const price = faker.number.int({ min: 200, max: 5000 });
  const treatment = faker.helpers.arrayElement(TREATMENTS);
  return {
    name: `${treatment} ${uniqueSuffix()}`,
    website: faker.internet.url(),
    price: String(price),
    // Always below the full price, as a discount should be.
    discountedPrice: String(faker.number.int({ min: 100, max: price - 50 })),
    emrId: `TR-${faker.string.numeric(4)}`,
    description:
      `${treatment} session lasting about ${faker.helpers.arrayElement([15, 30, 45, 60])} minutes, ` +
      `suited to ${faker.helpers.arrayElement(AUDIENCES)}. ` +
      faker.helpers.arrayElement(RECOVERY),
  };
}

/** A realistic department with a unique name and a random colour. */
export function buildDepartment(): DepartmentData {
  const department = faker.helpers.arrayElement(DEPARTMENTS);
  return {
    name: `${department} ${uniqueSuffix()}`,
    description: `Handles ${faker.helpers.arrayElement(DEPARTMENT_FOCUS)} for ${department.toLowerCase()}.`,
    colorName: faker.helpers.objectKey(DEPARTMENT_COLORS),
    externalId: `DP-${faker.string.numeric(4)}`,
  };
}

/** Any department colour except `colorName`, so an edit always changes the colour. */
export function otherColorThan(colorName: DepartmentColorName): DepartmentColorName {
  const others = (Object.keys(DEPARTMENT_COLORS) as DepartmentColorName[]).filter(
    (name) => name !== colorName,
  );
  return faker.helpers.arrayElement(others);
}

// ---------------------------------------------------------------------------------------------
// Settings → Organization → General
// ---------------------------------------------------------------------------------------------

/** A few of the Country dropdown's options: what the user picks, and the code the API stores. */
export const COUNTRIES = [
  { name: 'United Arab Emirates', code: 'AE' },
  { name: 'Nepal', code: 'NP' },
  { name: 'India', code: 'IN' },
  { name: 'Australia', code: 'AU' },
  { name: 'Canada', code: 'CA' },
  { name: 'Germany', code: 'DE' },
] as const;

/** A few of the Timezone dropdown's options: the label the user sees, and the IANA id the API stores. */
export const TIMEZONES = [
  { label: 'Dubai (UTC+4)', id: 'Asia/Dubai' },
  { label: 'Kathmandu (UTC+5:45)', id: 'Asia/Kathmandu' },
  { label: 'London (UTC+0)', id: 'Europe/London' },
  { label: 'Paris (UTC+1)', id: 'Europe/Paris' },
  { label: 'Eastern Time (UTC-5)', id: 'America/New_York' },
] as const;

/** Both Organization type options: the label the user sees, and the value the API stores. */
export const ORGANIZATION_TYPES = [
  { label: 'Clinic / Healthcare', value: 'clinic' },
  { label: 'E-commerce / Retail', value: 'ecommerce' },
] as const;

export type Country = (typeof COUNTRIES)[number];
export type Timezone = (typeof TIMEZONES)[number];
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

/** Everything on Organization → General that can be changed. */
export type OrganizationProfile = {
  name: string;
  website: string;
  /** Digits only, as typed. The phone's own country code (+977) is not changed by the tests. */
  phoneDigits: string;
  country: Country;
  timezone: Timezone;
  type: OrganizationType;
};

/** What the organization currently has, in API terms, so new values can be chosen to differ. */
export type CurrentOrganization = { region: string; timezone: string; type: string };

/** Any item except the one `isCurrent` matches, so an update always changes the value. */
function pickOther<T>(items: readonly T[], isCurrent: (item: T) => boolean): T {
  return faker.helpers.arrayElement(items.filter((item) => !isCurrent(item)));
}

/** New organization details where every field differs from `current`. */
export function buildOrganizationProfile(current: CurrentOrganization): OrganizationProfile {
  return {
    name: `${faker.company.name()} ${uniqueSuffix()}`,
    website: `https://www.${faker.internet.domainWord()}-${uniqueSuffix()}.com`,
    // A 10-digit mobile number starting with 98, the format of the account's existing number.
    phoneDigits: `98${faker.string.numeric(8)}`,
    country: pickOther(COUNTRIES, (country) => country.code === current.region),
    timezone: pickOther(TIMEZONES, (timezone) => timezone.id === current.timezone),
    type: pickOther(ORGANIZATION_TYPES, (type) => type.value === current.type),
  };
}

// ---------------------------------------------------------------------------------------------
// Settings → Organization → Members
// ---------------------------------------------------------------------------------------------

/** Organization roles in the invite dialog, and the value the API stores. */
export const ORGANIZATION_ROLES = {
  'Org Admin': 'organization:admin',
  'Org Member': 'organization:member',
} as const;

/** Workspace roles in the invite dialog, and the value the API stores. */
export const WORKSPACE_ROLES = {
  Admin: 'workspace:admin',
  Member: 'workspace:member',
  Agent: 'workspace:agent',
  Marketing: 'workspace:marketing',
  Finance: 'workspace:finance',
} as const;

export type OrganizationRoleName = keyof typeof ORGANIZATION_ROLES;
export type WorkspaceRoleName = keyof typeof WORKSPACE_ROLES;

/** A person to invite, as typed into the Invite user dialog. */
export type Invitee = {
  firstName: string;
  lastName: string;
  /** Always on example.com, so no real person ever receives the invitation email. */
  email: string;
  organizationRole: OrganizationRoleName;
  workspaceRole: WorkspaceRoleName;
};

/**
 * A realistic invitee. Always an Org Member, never an admin, and never a workspace Admin, so a
 * test invitation can't grant broad access even before it is revoked.
 */
export function buildInvitee(): Invitee {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  return {
    firstName,
    lastName,
    email: `qa.${firstName}.${lastName}.${uniqueSuffix()}@example.com`
      .toLowerCase()
      .replace(/[^a-z0-9.@]/g, ''),
    organizationRole: 'Org Member',
    workspaceRole: faker.helpers.arrayElement(['Member', 'Agent', 'Marketing', 'Finance'] as const),
  };
}

// ---------------------------------------------------------------------------------------------
// Settings pages with a table and add/edit dialogs
// ---------------------------------------------------------------------------------------------

/** Settings → Workspace → Websites. */
export type WebsiteData = { domain: string; name: string };

/** A website on example.com, a domain reserved for testing, so it never points at a real site. */
export function buildWebsite(): WebsiteData {
  return {
    domain: `qa-${faker.internet.domainWord()}-${uniqueSuffix()}.example.com`,
    name: `${faker.company.name()} Website ${uniqueSuffix()}`,
  };
}

/** The colour swatches in the team dialog (each button is named "Select color <hex>"). */
export const TEAM_COLORS = [
  '#6366f1',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
] as const;

/** The team dialog's auto-assign strategies: the label the user sees, and the value the API stores. */
export const TEAM_STRATEGIES = [
  { label: "Who's online", value: 'online' },
  { label: 'Least assigned', value: 'least_assigned' },
  { label: 'Round robin', value: 'round_robin' },
] as const;

/** Settings → Workspace → Teams. */
export type TeamData = {
  name: string;
  color: (typeof TEAM_COLORS)[number];
  strategy: (typeof TEAM_STRATEGIES)[number];
};

/** A team; pass the current one to get a different colour and strategy. */
export function buildTeam(current?: TeamData): TeamData {
  return {
    name: `${faker.commerce.department()} Team ${uniqueSuffix()}`,
    color: pickOther(TEAM_COLORS, (color) => color === current?.color),
    strategy: pickOther(TEAM_STRATEGIES, (strategy) => strategy.value === current?.strategy.value),
  };
}

/** The tag dialog's colour presets and the hex code each one sets. */
export const TAG_COLORS = {
  Red: '#ef4444',
  Orange: '#f97316',
  Yellow: '#eab308',
  Green: '#22c55e',
  Teal: '#14b8a6',
  Blue: '#3b82f6',
  Purple: '#a855f7',
  Pink: '#ec4899',
  Gray: '#6b7280',
} as const;

export type TagColorName = keyof typeof TAG_COLORS;

/** Settings → Inbox → Tags. */
export type TagData = { name: string; colorName: TagColorName };

/** A tag; pass the current one to get a different colour. */
export function buildTag(current?: TagData): TagData {
  const colorNames = Object.keys(TAG_COLORS) as TagColorName[];
  return {
    name: `qa-${faker.word.adjective()}-${uniqueSuffix()}`,
    colorName: pickOther(colorNames, (name) => name === current?.colorName),
  };
}

/** Settings → Inbox → Closing Notes. */
export type ClosingNoteData = { category: string; summary: string };

/** A closing note with a realistic reason. */
export function buildClosingNote(): ClosingNoteData {
  const reason = faker.helpers.arrayElement([
    'Appointment booked',
    'Question answered',
    'Price enquiry',
    'Follow-up scheduled',
    'Not interested',
  ]);
  return {
    category: `${reason} ${uniqueSuffix()}`,
    summary: `${reason}. ${faker.helpers.arrayElement(['Patient was happy with the answer.', 'Agent will check back next week.', 'No further action needed.'])}`,
  };
}

/** Settings → Content → Snippets. */
export type SnippetData = { name: string; content: string; visibility: 'Everyone' | 'Only me' };

/** A saved reply; pass the current one to get the other visibility. */
export function buildSnippet(current?: SnippetData): SnippetData {
  const topic = faker.helpers.arrayElement(['Opening hours', 'Parking', 'Booking', 'Prices', 'Aftercare']);
  return {
    name: `${topic} reply ${uniqueSuffix()}`,
    content: `Hi! ${faker.helpers.arrayElement([
      'We are open from 9am to 6pm, Monday to Saturday.',
      'Free parking is available behind the clinic.',
      'You can book online or reply here with a time that suits you.',
      'Our price list is attached; let us know if you have questions.',
    ])}`,
    visibility:
      current?.visibility === 'Everyone'
        ? 'Only me'
        : current
          ? 'Everyone'
          : faker.helpers.arrayElement(['Everyone', 'Only me']),
  };
}

/** Settings → Content → Files. The uploaded file is always tests/assets/sample.png. */
export type SavedFileData = { name: string };

/** A saved file with a realistic name. */
export function buildSavedFile(): SavedFileData {
  const kind = faker.helpers.arrayElement([
    'Price list',
    'Consent form',
    'Aftercare guide',
    'Clinic brochure',
  ]);
  return { name: `${kind} ${uniqueSuffix()}` };
}

/** An email on example.com, a domain reserved for testing, so it can never be a real account. */
export function buildUnknownEmail(): string {
  return faker.internet.email({ provider: 'example.com' }).toLowerCase();
}

/** A random password that will not match any real account's password. */
export function buildWrongPassword(): string {
  return faker.internet.password({ length: 14 });
}

// ---------------------------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------------------------

/** A contact's text fields, as typed into the Create contact dialog. */
export type ContactData = {
  firstName: string;
  lastName: string;
  /** A UAE mobile number in international format: the dialog's phone field accepts it as typed. */
  phone: string;
  email: string;
  address: string;
};

/**
 * A realistic contact. The last name ends with a unique number, so searching for it finds this
 * contact only. Options:
 * - `batch`: give several contacts the same number (find them all with one search); each still
 *   gets its own letter, so their names differ.
 * - `uniqueFirstName`: put the number in the first name too, for filters on the first name.
 */
export function buildContact(
  options: { batch?: { tag: string; index: number }; uniqueFirstName?: boolean } = {},
): ContactData {
  const { batch, uniqueFirstName = false } = options;
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const suffix = batch ? `${batch.tag}${String.fromCharCode(65 + batch.index)}` : uniqueSuffix();
  return {
    firstName: uniqueFirstName ? `${firstName} ${suffix}` : firstName,
    lastName: `${lastName} ${suffix}`,
    // 50 is a UAE mobile prefix; the rest is random. Shorter numbers fail the dialog's check.
    phone: `+97150${faker.string.numeric(7)}`,
    email: `qa.${firstName}.${lastName}.${suffix}@example.com`.toLowerCase().replace(/[^a-z0-9.@]/g, ''),
    address: faker.location.streetAddress(),
  };
}

/** `count` contacts that share one search tag; returns the tag too. */
export function buildContactBatch(count: number): { tag: string; contacts: ContactData[] } {
  const tag = uniqueSuffix();
  return {
    tag,
    contacts: Array.from({ length: count }, (_, index) => buildContact({ batch: { tag, index } })),
  };
}

/** A name for a test segment, unique so parallel runs never clash. */
export function buildSegmentName(): string {
  return `QA ${faker.helpers.arrayElement(['Warm leads', 'Follow-up list', 'VIP patients', 'New enquiries'])} ${uniqueSuffix()}`;
}

/** A short, realistic note an agent might leave on a contact. */
export function buildContactNote(): string {
  return `${faker.helpers.arrayElement([
    'Called back, prefers a morning appointment.',
    'Asked about prices for a second session.',
    'Will confirm the booking after checking with family.',
    'Interested in the package offer.',
  ])} (${uniqueSuffix()})`;
}

// ---------------------------------------------------------------------------------------------
// Clinic → Appointments and Billing
// ---------------------------------------------------------------------------------------------

/** A patient as typed into the New appointment dialog. Booking a new patient creates a contact. */
export type PatientData = { firstName: string; lastName: string; phone: string };

/** A realistic patient whose last name ends with a unique number, like buildContact(). */
export function buildPatient(): PatientData {
  const { firstName, lastName, phone } = buildContact();
  return { firstName, lastName, phone };
}

/**
 * The next day the clinic takes bookings, at least `daysAhead` days from now, at `hour`:`minute`
 * local time. The test workspace is closed on Saturdays and Sundays: the API answers
 * 400 "Clinic is closed on this day" for those.
 */
export function nextClinicDay(hour = 10, minute = 0, daysAhead = 1): Date {
  const day = new Date();
  day.setDate(day.getDate() + daysAhead);
  while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1);
  day.setHours(hour, minute, 0, 0);
  return day;
}

/** The next Saturday at 10:00 local time: a day the clinic is closed. */
export function nextClosedDay(): Date {
  const day = new Date();
  day.setDate(day.getDate() + ((6 - day.getDay() + 7) % 7 || 7));
  day.setHours(10, 0, 0, 0);
  return day;
}

/** "2026-11-02": the calendar's ?date= value for `day` (local time). */
export function toDateParam(day: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** An amount paid at a visit, in whole AED. */
export function buildPaymentAmount(): number {
  return faker.number.int({ min: 100, max: 2000 });
}

// --- Sprint 2: Settings CRUD ------------------------------------------------------------------

/** The contact field dialog's types and the value the API stores for each. */
export const CONTACT_FIELD_TYPES = {
  Text: 'string',
  Number: 'number',
  Choice: 'select',
  Phone: 'phone',
} as const;

export type ContactFieldTypeName = keyof typeof CONTACT_FIELD_TYPES;

/** Settings → Workspace → Contact Fields, as typed into the New contact field dialog. */
export type ContactFieldData = {
  name: string;
  /** "Storage key": fixed once the field exists. */
  key: string;
  type: ContactFieldTypeName;
  /** Only for Choice fields: one option per line in the dialog. */
  options: string[];
  placeholder: string;
  /** "Show this field on contacts". */
  showOnContacts: boolean;
};

/**
 * A contact field; pass the current one to get a different name, placeholder and visibility.
 * The key and type stay the same, as the app doesn't let them change.
 */
export function buildContactField(
  type: ContactFieldTypeName = 'Text',
  current?: ContactFieldData,
): ContactFieldData {
  const suffix = uniqueSuffix();
  const label = faker.helpers.arrayElement(['Insurance', 'Patient MRN', 'Referral', 'Membership']);
  return {
    name: `${label} ${suffix}`,
    key: current?.key ?? `qa_${label.toLowerCase().replace(/\W+/g, '_')}_${suffix}`,
    type: current?.type ?? type,
    options: (current?.type ?? type) === 'Choice' ? ['Daman', 'AXA', `Bupa ${suffix}`] : [],
    placeholder: `${faker.helpers.arrayElement(['Enter', 'Type', 'Add'])} the ${label.toLowerCase()}`,
    showOnContacts: current ? !current.showOnContacts : true,
  };
}

/** The outcome reason's "Show under" options and the value the API stores for each. */
export const OUTCOME_ANSWERS = {
  'All done': 'all_done',
  'Nothing booked': 'nothing_booked',
  'Not interested': 'not_interested',
  "No-show, won't come back": 'wont_come',
} as const;

export type OutcomeAnswerName = keyof typeof OUTCOME_ANSWERS;

/** What a new reason is shown under when it is added from the page, before any edit. */
export const DEFAULT_OUTCOME_ANSWERS: OutcomeAnswerName[] = ['Nothing booked', 'Not interested'];

/** Settings → Inbox → Outcome Reasons. */
export type OutcomeReasonData = { label: string; showUnder: OutcomeAnswerName[] };

/** An outcome reason; pass the current one to get a different label and other answers. */
export function buildOutcomeReason(current?: OutcomeReasonData): OutcomeReasonData {
  const all = Object.keys(OUTCOME_ANSWERS) as OutcomeAnswerName[];
  const others = all.filter((answer) => !current?.showUnder.includes(answer));
  return {
    label: `qa-${faker.helpers.arrayElement(['Insurance declined', 'Moved away', 'Too busy', 'Prefers online'])} ${uniqueSuffix()}`,
    showUnder: current ? others : faker.helpers.arrayElements(all, { min: 1, max: 3 }),
  };
}

/** The wrap-up outcome's "Result" options and the value the API stores for each. */
export const WRAP_UP_RESULTS = { Won: 'won', 'In progress': 'in_progress', Lost: 'lost' } as const;

export type WrapUpResultName = keyof typeof WRAP_UP_RESULTS;

/** Settings → Inbox → Wrap-Up: one outcome. Its single step closes the conversation. */
export type WrapUpOutcomeData = { name: string; result: WrapUpResultName; description: string };

/** A wrap-up outcome; pass the current one to get a different result. */
export function buildWrapUpOutcome(current?: WrapUpOutcomeData): WrapUpOutcomeData {
  const results = Object.keys(WRAP_UP_RESULTS) as WrapUpResultName[];
  return {
    name: `qa-${faker.helpers.arrayElement(['Booked appointment', 'Sent price list', 'Will call back'])} ${uniqueSuffix()}`,
    result: pickOther(results, (result) => result === current?.result),
    description: `Pick this when ${faker.helpers.arrayElement(['the patient booked', 'prices were shared', 'the patient asked for a call'])}.`,
  };
}

/** Settings → Workspace → API Keys. */
export type ApiKeyData = { name: string };

export function buildApiKey(): ApiKeyData {
  return {
    name: `qa-${faker.helpers.arrayElement(['CRM sync', 'Zapier', 'Reporting'])} key ${uniqueSuffix()}`,
  };
}

/** The only webhook event the app offers today. */
export const WEBHOOK_EVENT = 'channel.incoming_message';

/** Settings → Workspace → API Keys → Webhooks. URLs are on example.com, so nothing is delivered. */
export type WebhookData = { url: string; description: string };

export function buildWebhook(): WebhookData {
  const suffix = uniqueSuffix();
  return {
    url: `https://example.com/qa-webhooks/${faker.word.noun()}-${suffix}`,
    description: `qa-${faker.helpers.arrayElement(['CRM', 'Data warehouse', 'Alerts'])} ${suffix}`,
  };
}

/** The saved view's rule fields and operators used by the tests, and their API values. */
export const VIEW_FIELDS = { 'First name': 'firstName', 'Last name': 'lastName', Email: 'email' } as const;
export const VIEW_OPERATORS = { contains: 'contains', 'starts with': 'beginsWith' } as const;

/** Icons from the emoji picker: what to search for, and the emoji to pick from the results. */
export const VIEW_ICONS = [
  { search: 'rocket', emoji: '🚀' },
  { search: 'fire', emoji: '🔥' },
  { search: 'bell', emoji: '🔔' },
] as const;

/** Inbox → Views: a saved filter with one rule. */
export type SavedViewData = {
  name: string;
  icon: (typeof VIEW_ICONS)[number];
  rule: { field: keyof typeof VIEW_FIELDS; operator: keyof typeof VIEW_OPERATORS; value: string };
  share: 'Just me' | 'Everyone';
};

/** A saved view; pass the current one to get a different icon, rule and sharing. */
export function buildSavedView(current?: SavedViewData): SavedViewData {
  const fields = Object.keys(VIEW_FIELDS) as (keyof typeof VIEW_FIELDS)[];
  const operators = Object.keys(VIEW_OPERATORS) as (keyof typeof VIEW_OPERATORS)[];
  return {
    name: `qa-${faker.helpers.arrayElement(['VIP patients', 'New leads', 'Dental enquiries'])} ${uniqueSuffix()}`,
    icon: pickOther(VIEW_ICONS, (icon) => icon.emoji === current?.icon.emoji),
    rule: {
      field: pickOther(fields, (field) => field === current?.rule.field),
      operator: pickOther(operators, (operator) => operator === current?.rule.operator),
      value: `qa${uniqueSuffix()}`,
    },
    share:
      current?.share === 'Everyone' ? 'Just me' : current ? 'Everyone' : pickRandom(['Just me', 'Everyone']),
  };
}

// --- Sprint 3: Workspace settings -------------------------------------------------------------

/** A new name for the test workspace. Tests put the real name back afterwards. */
export function buildWorkspaceName(): string {
  return `qa-${faker.helpers.arrayElement(['Front desk', 'Reception', 'Patient care'])} ${uniqueSuffix()}`;
}

/** Days a follow-up keeps credit for a booking: 1 to 365, and never `current`. */
export function buildFollowUpCreditDays(current: number): number {
  let days = current;
  while (days === current) days = faker.number.int({ min: 2, max: 364 });
  return days;
}

/** An off day at least a month ahead, so it never closes the workspace while tests run. */
export function buildOffDay(): { date: Date; reason: string } {
  const date = faker.date.soon({ days: 300, refDate: new Date(Date.now() + 31 * 24 * 3600 * 1000) });
  date.setHours(12, 0, 0, 0);
  return {
    date,
    reason: `qa-${faker.helpers.arrayElement(['Staff training', 'Holiday', 'Renovation'])} ${uniqueSuffix()}`,
  };
}

/** A lifecycle stage name and emoji; the emoji is one the picker offers. */
export function buildLifecycleStage(): { name: string; emoji: string } {
  return {
    name: `qa-${faker.helpers.arrayElement(['Consultation booked', 'Quote sent', 'Treatment planned'])} ${uniqueSuffix()}`,
    emoji: faker.helpers.arrayElement(['🧪', '📅', '💬']),
  };
}

// --- Sprint 4: Roles & access -----------------------------------------------------------------

/** The role editor's "Contacts they see" options and the value the API stores for each. */
export const CONTACT_VISIBILITY = {
  'All contacts': 'all',
  "Their teams' contacts": 'teams',
  'Only assigned to them': 'assigned',
} as const;

/**
 * Permissions Agent doesn't have (Member has them all), so ticking one on a role started from Agent
 * is always a change: where the editor shows it (area and label) and its API key.
 */
export const EXTRA_ROLE_PERMISSIONS = [
  { area: 'Contacts', label: 'Delete', key: 'contacts.delete' },
  { area: 'Contacts', label: 'Export', key: 'contacts.export' },
  { area: 'Conversations', label: 'Delete', key: 'conversations.delete' },
  { area: 'Appointments', label: 'Delete', key: 'appointments.delete' },
] as const;

/** A custom role, as built in Settings → Roles → New role. */
export type RoleData = {
  name: string;
  description: string;
  /** The built-in role the editor starts from: Agent, so the extra permissions are additions. */
  startFrom: 'Agent';
  contactVisibility: keyof typeof CONTACT_VISIBILITY;
  /** Permissions ticked on top of the starting role's. */
  extraPermissions: (typeof EXTRA_ROLE_PERMISSIONS)[number][];
};

/** A custom role; pass the current one to get a different name, description and contact access. */
export function buildRole(current?: RoleData): RoleData {
  const visibilities = Object.keys(CONTACT_VISIBILITY) as RoleData['contactVisibility'][];
  return {
    name: `qa-${faker.helpers.arrayElement(['Front desk', 'Night shift', 'Billing desk'])} ${uniqueSuffix()}`,
    description: `For ${faker.helpers.arrayElement(['receptionists', 'weekend cover', 'the billing team'])}.`,
    startFrom: 'Agent',
    contactVisibility: pickOther(visibilities, (visibility) => visibility === current?.contactVisibility),
    extraPermissions: faker.helpers.arrayElements(EXTRA_ROLE_PERMISSIONS, { min: 1, max: 2 }),
  };
}

/** Someone to add to the workspace, on example.com so no invitation email reaches anyone. */
export function buildWorkspaceInvitee(): { firstName: string; lastName: string; email: string } {
  const firstName = faker.person.firstName();
  const lastName = `${faker.person.lastName()} ${uniqueSuffix()}`;
  return {
    firstName,
    lastName,
    email: `qa-${uniqueSuffix()}-${faker.string.alpha(5).toLowerCase()}@example.com`,
  };
}

export type TicketData = { name: string; description: string };

/** A ticket name and description. */
export function buildTicket(): TicketData {
  const issue = faker.helpers.arrayElement([
    'Refund request',
    'Wrong invoice',
    'Missed callback',
    'Booking problem',
  ]);
  return {
    name: `${issue} ${uniqueSuffix()}`,
    description: `Test ticket: ${faker.lorem.sentence({ min: 4, max: 8 })}`,
  };
}

export type WorkflowData = { name: string; description: string };

/** A workflow name and description (the steps are set in api/WorkflowsApi.ts: toWorkflowPayload). */
export function buildWorkflow(): WorkflowData {
  const purpose = faker.helpers.arrayElement([
    'Welcome',
    'Lead follow-up',
    'Review request',
    'No-show nudge',
  ]);
  return {
    name: `${purpose} workflow ${uniqueSuffix()}`,
    description: `Test workflow: ${faker.lorem.sentence({ min: 4, max: 8 })}`,
  };
}

/**
 * Inbox → an internal note on a conversation. Notes cannot be deleted, so the marker is all that
 * tells test notes apart on the shared test conversation.
 */
export function buildNoteText(): string {
  const text = faker.helpers.arrayElement([
    'Asked about prices, send the list',
    'Wants an appointment next week',
    'Prefers to be contacted in the evening',
    'Waiting for their insurance details',
  ]);
  return `${text} ${uniqueSuffix()}`;
}

/** Inbox → Mark as follow up: the reminder's title. */
export function buildFollowUpTitle(): string {
  const text = faker.helpers.arrayElement([
    'Send the price list',
    'Confirm the booking',
    'Check on their recovery',
  ]);
  return `${text} ${uniqueSuffix()}`;
}
