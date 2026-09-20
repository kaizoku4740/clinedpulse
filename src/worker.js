import PostalMime from 'postal-mime';
import { detectEmailMaterials, materialNotificationTitle, normalizeEmailAddress } from '../lib/email-monitoring.js';
import { verifyWebhookSignature } from '../lib/webhook-signing.js';

const json = (data, status = 200) => Response.json(data, { status });
const hubKey = value => ['heme', 'endo', 'gastro'].includes(value) ? value : 'heme';
const storageHubKey = (hub, mode = 'live') => mode === 'test' ? `test-${hubKey(hub)}` : hubKey(hub);
const eventTypes = new Set(['Case Discussion', 'Summit Session', 'Faculty Workshop', 'Webinar', 'Post-Conference Update']);
const eventStatuses = new Set([
  'Planning', 'Speaker Invited', 'Speaker Confirmed', 'Zoom Scheduled', 'Materials Pending',
  'Event Ready', 'Completed', 'Follow-Up Complete'
]);
const speakerSorts = {
  name_asc: 'name COLLATE NOCASE ASC, id ASC',
  name_desc: 'name COLLATE NOCASE DESC, id DESC',
  specialty_asc: 'specialty COLLATE NOCASE ASC, name COLLATE NOCASE ASC',
  institution_asc: 'institution COLLATE NOCASE ASC, name COLLATE NOCASE ASC',
  newest: 'created_at DESC, id DESC'
};
const eventSorts = {
  date_desc: "CASE WHEN event_date = '' THEN 0 ELSE 1 END ASC, event_date DESC, event_time DESC, events.id DESC",
  date_asc: 'event_date ASC, event_time ASC, events.id ASC',
  closest_date: "ABS(julianday(event_date) - julianday('now')) ASC, event_date ASC, event_time ASC, events.id ASC",
  farthest_date: "ABS(julianday(event_date) - julianday('now')) DESC, event_date DESC, event_time DESC, events.id DESC",
  readiness_desc: 'readiness_score DESC, event_date DESC, event_time DESC',
  readiness_asc: 'readiness_score ASC, event_date DESC, event_time DESC'
};
const checklistItems = [
  'Speaker Confirmed',
  'Zoom Created',
  'Calendar Invite Sent',
  'Bio Collected',
  'Headshot Collected',
  'Faculty Profile Added',
  'Topic Finalized',
  'Slides Requested',
  'Slides Received',
  'Consent Form Received',
  'Marketing Team Notified',
  'Thank-You Email Sent'
];
const statusChecklistMap = {
  Planning: [],
  'Speaker Invited': [],
  'Speaker Confirmed': ['Speaker Confirmed'],
  'Zoom Scheduled': ['Speaker Confirmed', 'Zoom Created', 'Calendar Invite Sent'],
  'Materials Pending': [
    'Speaker Confirmed', 'Zoom Created', 'Calendar Invite Sent', 'Bio Collected',
    'Headshot Collected', 'Faculty Profile Added', 'Topic Finalized', 'Slides Requested',
    'Marketing Team Notified'
  ],
  'Event Ready': [
    'Speaker Confirmed', 'Zoom Created', 'Calendar Invite Sent', 'Bio Collected',
    'Headshot Collected', 'Faculty Profile Added', 'Topic Finalized', 'Slides Requested',
    'Slides Received', 'Consent Form Received', 'Marketing Team Notified'
  ],
  Completed: [
    'Speaker Confirmed', 'Zoom Created', 'Calendar Invite Sent', 'Bio Collected',
    'Headshot Collected', 'Faculty Profile Added', 'Topic Finalized', 'Slides Requested',
    'Slides Received', 'Consent Form Received', 'Marketing Team Notified'
  ],
  'Follow-Up Complete': checklistItems
};
const readinessWeightedScoreSql = `COALESCE(SUM(CASE
  WHEN event_checklist_items.completed = 1 THEN CASE event_checklist_items.label
    WHEN 'Speaker Confirmed' THEN 10
    WHEN 'Zoom Created' THEN 10
    WHEN 'Bio Collected' THEN 10
    WHEN 'Headshot Collected' THEN 10
    WHEN 'Topic Finalized' THEN 10
    WHEN 'Slides Requested' THEN 10
    WHEN 'Slides Received' THEN 20
    WHEN 'Consent Form Received' THEN 20
    ELSE 0
  END
  ELSE 0
END), 0)`;
const readinessScoreSql = `CASE
  WHEN COUNT(event_checklist_items.id) > 0
    AND COUNT(event_checklist_items.id) = COALESCE(SUM(CASE WHEN event_checklist_items.completed = 1 THEN 1 ELSE 0 END), 0)
    THEN 100
  ELSE MIN(${readinessWeightedScoreSql}, 99)
END`;
async function parseBody(request) {
  const raw = await request.text();
  return parseJson(raw);
}

function parseJson(raw) {
  if (!raw) return {};
  if (raw.length > 1_000_000) throw Object.assign(new Error('Request too large'), { status: 413 });
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function verifyCalendlySignature(request, raw, env) {
  if (!env.CALENDLY_WEBHOOK_SECRET) return;
  const header = request.headers.get('calendly-webhook-signature') || '';
  const parts = Object.fromEntries(header.split(',').map(part => part.trim().split('=')));
  if (!parts.t || !parts.v1) throw Object.assign(new Error('Missing Calendly webhook signature'), { status: 401 });
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.CALENDLY_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const expected = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${parts.t}.${raw}`)));
  if (expected !== parts.v1) throw Object.assign(new Error('Invalid Calendly webhook signature'), { status: 401 });
}

function validateSpeaker(body) {
  if (!body.name?.trim()) throw Object.assign(new Error('Name is required'), { status: 400 });
  if (body.email?.trim() && !/^\S+@\S+\.\S+$/.test(body.email.trim())) {
    throw Object.assign(new Error('Enter a valid email or leave it blank'), { status: 400 });
  }
}

function validateEvent(body) {
  if (!body.event_name?.trim()) throw Object.assign(new Error('Event name is required'), { status: 400 });
  if (body.event_type && !eventTypes.has(body.event_type)) throw Object.assign(new Error('Choose a valid event type'), { status: 400 });
  if (body.status && !eventStatuses.has(body.status)) throw Object.assign(new Error('Choose a valid status'), { status: 400 });
}

function duplicateWarning(message) {
  return Object.assign(new Error(message), { status: 409, warning: true });
}

function constraintMessage(error) {
  const text = String(error.message || '');
  if (text.includes('idx_events_duplicate_guard')) {
    return 'An event with the same name, speaker, date, and time already exists.';
  }
  if (text.includes('speakers.email')) return 'A speaker with this email already exists.';
  return error.message;
}

async function ensureSpeakerIsUnique(env, body, ignoreId = null) {
  if (!body.email?.trim()) return;
  const duplicate = await env.DB.prepare(`SELECT id,name,email FROM speakers
    WHERE lower(email) = lower(?) AND (? IS NULL OR id != ?)
    LIMIT 1`).bind(body.email || '', ignoreId, ignoreId).first();
  if (duplicate) {
    throw duplicateWarning(`A speaker with this email already exists: ${duplicate.name}`);
  }
}

async function ensureEventIsUnique(env, values, ignoreId = null) {
  const duplicate = await env.DB.prepare(`SELECT id,event_name FROM events
    WHERE lower(event_name) = lower(?)
    AND speaker_id = ?
    AND event_date = ?
    AND COALESCE(event_time, '') = COALESCE(?, '')
    AND (? IS NULL OR id != ?)
    LIMIT 1`).bind(values[0], values[2], values[4], values[5] || '', ignoreId, ignoreId).first();
  if (duplicate) {
    throw duplicateWarning('An event with the same name, speaker, date, and time already exists.');
  }
}

function calendlyEnabled(env) {
  return env.ENABLE_CALENDLY === 'true';
}

function calendlyQuestion(payload, names) {
  const wanted = names.map(name => name.toLowerCase());
  const answer = (payload.questions_and_answers || []).find(item => {
    const question = String(item.question || '').toLowerCase();
    return wanted.some(name => question.includes(name));
  });
  return answer?.answer?.trim() || '';
}

function inferCalendlyEventType(value = '') {
  const text = value.toLowerCase();
  if (text.includes('case')) return 'Case Discussion';
  if (text.includes('summit')) return 'Summit Session';
  if (text.includes('workshop') || text.includes('faculty')) return 'Faculty Workshop';
  if (text.includes('post-conference') || text.includes('post conference')) return 'Post-Conference Update';
  return 'Webinar';
}

function calendlyDateTime(startTime, timeZone) {
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error('Calendly event start time is required'), { status: 400 });
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return { event_date: `${parts.year}-${parts.month}-${parts.day}`, event_time: `${parts.hour}:${parts.minute}` };
}

function calendlyEventBody(body) {
  if (body.event && body.event !== 'invitee.created') return { ignored: true, reason: body.event };
  const payload = body.payload || body;
  const scheduled = payload.scheduled_event || {};
  const name = payload.name || [payload.first_name, payload.last_name].filter(Boolean).join(' ').trim();
  const email = payload.email || '';
  if (!name || !email) throw Object.assign(new Error('Calendly invitee name and email are required'), { status: 400 });
  const timeZone = payload.timezone || scheduled.timezone || 'America/Chicago';
  const { event_date, event_time } = calendlyDateTime(scheduled.start_time || payload.start_time, timeZone);
  const scheduledName = scheduled.name || payload.event_type_name || 'Calendly Booking';
  const requestedType = calendlyQuestion(payload, ['event type', 'format']);
  const eventType = eventTypes.has(requestedType) ? requestedType : inferCalendlyEventType(`${requestedType} ${scheduledName}`);
  const topic = calendlyQuestion(payload, ['topic', 'presentation', 'session title']) || scheduledName;
  const location = scheduled.location || payload.location || {};
  return {
    event_name: calendlyQuestion(payload, ['event name', 'program title']) || scheduledName,
    event_type: eventType,
    speaker_name: name,
    speaker_email: email,
    event_date,
    event_time,
    topic,
    zoom_link: location.join_url || location.location || '',
    status: 'Speaker Confirmed',
    calendly_event_uri: scheduled.uri || payload.event || '',
    calendly_invitee_uri: payload.uri || '',
    speaker: {
      name,
      email,
      institution: calendlyQuestion(payload, ['institution', 'organization', 'hospital', 'university']),
      specialty: calendlyQuestion(payload, ['specialty', 'speciality', 'clinical area']),
      notes: `Created from Calendly booking${payload.uri ? `: ${payload.uri}` : ''}`
    }
  };
}

function speakerValues(body) {
  const email = body.email?.trim() || `missing-email-${crypto.randomUUID()}@clinedpulse.invalid`;
  return [
    body.name.trim(),
    email,
    body.institution || '',
    body.specialty || '',
    body.expertise || '',
    body.faculty_profile_url || '',
    body.notes || '',
    body.participation_history || ''
  ];
}

function publicSpeaker(speaker) {
  if (!speaker) return speaker;
  return {
    ...speaker,
    email: /^missing-email-[^@]+@clinedpulse\.invalid$/i.test(speaker.email || '') ? '' : speaker.email
  };
}

async function getSpeaker(env, id) {
  return publicSpeaker(await env.DB.prepare('SELECT * FROM speakers WHERE id = ?').bind(id).first());
}

async function getSpeakerPastEvents(env, id) {
  const { results } = await env.DB.prepare(`SELECT id,event_name,event_type,event_date,event_time,topic,status
    FROM events
    WHERE (speaker_id = ? OR EXISTS (
      SELECT 1 FROM event_speakers WHERE event_speakers.event_id = events.id AND event_speakers.speaker_id = ?
    )) AND event_date < date('now')
    ORDER BY event_date DESC, event_time DESC, id DESC`).bind(id, id).all();
  return results;
}

async function getSpeakerScheduledEvents(env, id) {
  const { results } = await env.DB.prepare(`SELECT id,event_name,event_type,event_date,event_time,topic,status
    FROM events
    WHERE (speaker_id = ? OR EXISTS (
      SELECT 1 FROM event_speakers WHERE event_speakers.event_id = events.id AND event_speakers.speaker_id = ?
    )) AND event_date >= date('now')
    ORDER BY event_date, event_time, id`).bind(id, id).all();
  return results;
}

async function withSpeakerHistory(env, speaker) {
  if (!speaker) return speaker;
  const pastEvents = await getSpeakerPastEvents(env, speaker.id);
  const scheduledEvents = await getSpeakerScheduledEvents(env, speaker.id);
  const topics = [...new Set(pastEvents.map(event => event.topic).filter(Boolean))];
  const participationDates = [...new Set(pastEvents.map(event => event.event_date).filter(Boolean))];
  return {
    ...speaker,
    past_events: pastEvents,
    scheduled_events: scheduledEvents,
    topics_covered: topics,
    participation_dates: participationDates
  };
}

async function resolveEventSpeaker(env, body) {
  if (body.speaker_id) return getSpeaker(env, body.speaker_id);
  const lookup = (body.speaker_email || body.speaker_name || body.speaker || '').trim();
  if (!lookup) return null;
  return publicSpeaker(await env.DB.prepare('SELECT * FROM speakers WHERE lower(email) = lower(?) OR lower(name) = lower(?) ORDER BY name LIMIT 1')
    .bind(lookup, lookup).first());
}

async function resolveEventSpeakers(env, body, hub) {
  const requested = Array.isArray(body.speaker_ids) ? body.speaker_ids : body.speaker_id ? [body.speaker_id] : [];
  const ids = [...new Set(requested.map(value => Number(value)).filter(Number.isInteger))];
  const speakers = [];
  for (const id of ids) {
    const speaker = await getSpeaker(env, id);
    if (speaker && (!hub || speaker.hub_key === hub)) speakers.push(speaker);
  }
  if (!speakers.length) {
    const fallback = await resolveEventSpeaker(env, body);
    if (fallback && (!hub || fallback.hub_key === hub)) speakers.push(fallback);
  }
  return speakers;
}

async function syncEventSpeakers(env, eventId, speakers) {
  const statements = [env.DB.prepare('DELETE FROM event_speakers WHERE event_id = ?').bind(eventId)];
  speakers.forEach((speaker, position) => {
    statements.push(env.DB.prepare('INSERT INTO event_speakers (event_id,speaker_id,position) VALUES (?,?,?)')
      .bind(eventId, speaker.id, position));
  });
  await env.DB.batch(statements);
}

async function getEvent(env, id) {
  return env.DB.prepare(`SELECT events.*, COALESCE((
      SELECT group_concat(name, ', ') FROM (
        SELECT speakers.name name FROM event_speakers
        JOIN speakers ON speakers.id = event_speakers.speaker_id
        WHERE event_speakers.event_id = events.id
        ORDER BY event_speakers.position, speakers.name
      )
    ), speakers.name, events.speaker_name) speaker,
    COUNT(event_checklist_items.id) checklist_total,
    COALESCE(SUM(CASE WHEN event_checklist_items.completed = 1 THEN 1 ELSE 0 END), 0) checklist_done,
    ${readinessScoreSql} readiness_score
    FROM events
    LEFT JOIN speakers ON speakers.id = events.speaker_id
    LEFT JOIN event_checklist_items ON event_checklist_items.event_id = events.id
    WHERE events.id = ?
    GROUP BY events.id`).bind(id).first();
}

async function getChecklist(env, eventId) {
  const { results } = await env.DB.prepare('SELECT * FROM event_checklist_items WHERE event_id = ? ORDER BY position, id')
    .bind(eventId).all();
  return results;
}

async function getEventSpeakers(env, eventId) {
  const { results } = await env.DB.prepare(`SELECT speakers.* FROM event_speakers
    JOIN speakers ON speakers.id = event_speakers.speaker_id
    WHERE event_speakers.event_id = ?
    ORDER BY event_speakers.position, speakers.name`).bind(eventId).all();
  if (results.length) return results.map(publicSpeaker);
  const event = await env.DB.prepare('SELECT speaker_id FROM events WHERE id = ?').bind(eventId).first();
  const fallback = event?.speaker_id ? await getSpeaker(env, event.speaker_id) : null;
  return fallback ? [fallback] : [];
}

async function withChecklist(env, event) {
  return event ? {
    ...event,
    speakers: await getEventSpeakers(env, event.id),
    checklist: await getChecklist(env, event.id)
  } : event;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function defaultChecklistDueDates(eventDate) {
  if (!eventDate) return {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eventDay = new Date(`${eventDate}T00:00:00`);
  const lastDueDay = new Date(eventDay);
  lastDueDay.setDate(lastDueDay.getDate() - 1);
  const end = lastDueDay < today ? eventDay : lastDueDay;
  const availableDays = Math.max(1, Math.floor((end - today) / 86400000));
  const step = Math.max(1, Math.floor(availableDays / checklistItems.length));
  return Object.fromEntries(checklistItems.map((item, index) => {
    const due = new Date(today);
    due.setDate(due.getDate() + step * (index + 1));
    if (due > end) due.setTime(end.getTime());
    return [item, dateOnly(due)];
  }));
}

function checklistDueDates(body) {
  const selected = body.checklist_due_dates && typeof body.checklist_due_dates === 'object' ? body.checklist_due_dates : {};
  const dueDates = Object.fromEntries(checklistItems.map(item => [item, selected[item] || '']));
  return Object.values(dueDates).some(Boolean) ? dueDates : defaultChecklistDueDates(body.event_date);
}

async function createEventChecklist(env, eventId, dueDates = {}) {
  const statements = checklistItems.map((item, index) => env.DB
    .prepare('INSERT OR IGNORE INTO event_checklist_items (event_id,label,position,due_date) VALUES (?,?,?,?)')
    .bind(eventId, item, index + 1, dueDates[item] || null));
  await env.DB.batch(statements);
}

async function updateChecklistDueDates(env, eventId, dueDates = {}) {
  const statements = Object.entries(dueDates)
    .filter(([label]) => checklistItems.includes(label))
    .map(([label, dueDate]) => env.DB
      .prepare('UPDATE event_checklist_items SET due_date=?,updated_at=CURRENT_TIMESTAMP WHERE event_id=? AND label=?')
      .bind(dueDate || null, eventId, label));
  if (statements.length) await env.DB.batch(statements);
}

async function applyStatusChecklist(env, eventId, status) {
  const labels = statusChecklistMap[status] || [];
  if (!labels.length) return;
  const placeholders = labels.map(() => '?').join(',');
  await env.DB.prepare(`UPDATE event_checklist_items SET
    completed=1,
    completed_at=COALESCE(completed_at, CURRENT_TIMESTAMP),
    updated_at=CURRENT_TIMESTAMP
    WHERE event_id=? AND label IN (${placeholders}) AND completed=0`).bind(eventId, ...labels).run();
}

async function overviewTasks(env, hub) {
  const base = `SELECT event_checklist_items.*, events.event_name, events.event_date,
    COALESCE(speakers.name, events.speaker_name) speaker
    FROM event_checklist_items
    JOIN events ON events.id = event_checklist_items.event_id
    LEFT JOIN speakers ON speakers.id = events.speaker_id
    WHERE events.hub_key = ? AND`;
  const [urgent, upcoming, todo] = await Promise.all([
    env.DB.prepare(`${base} event_checklist_items.completed = 0 AND event_checklist_items.due_date IS NOT NULL AND event_checklist_items.due_date <= date('now', '+7 days')
      ORDER BY event_checklist_items.due_date IS NULL, event_checklist_items.due_date, events.event_date, event_checklist_items.position`).bind(hub).all(),
    env.DB.prepare(`${base} event_checklist_items.completed = 0 AND event_checklist_items.due_date IS NOT NULL AND event_checklist_items.due_date BETWEEN date('now', '+8 days') AND date('now', '+21 days')
      ORDER BY event_checklist_items.due_date IS NULL, event_checklist_items.due_date, events.event_date, event_checklist_items.position`).bind(hub).all(),
    env.DB.prepare(`${base} event_checklist_items.completed = 0 AND (event_checklist_items.due_date IS NULL OR event_checklist_items.due_date > date('now', '+21 days'))
      ORDER BY event_checklist_items.due_date IS NULL, event_checklist_items.due_date, events.event_date, event_checklist_items.position`).bind(hub).all()
  ]);
  return { todo: todo.results, urgent: urgent.results, upcoming: upcoming.results };
}

function eventRequestKey(body) {
  const key = String(body.request_key || '').trim();
  if (key && !/^[A-Za-z0-9_-]{8,96}$/.test(key)) {
    throw Object.assign(new Error('Invalid event request key'), { status: 400 });
  }
  return key;
}

async function eventByRequestKey(env, hub, requestKey) {
  if (!requestKey) return null;
  const existing = await env.DB.prepare('SELECT id FROM events WHERE hub_key = ? AND request_key = ?')
    .bind(hub, requestKey).first();
  return existing ? getEvent(env, existing.id) : null;
}

async function eventValues(env, body, hub) {
  validateEvent(body);
  const speakers = await resolveEventSpeakers(env, body, hub);
  const primary = speakers[0];
  return { values: [
    body.event_name.trim(),
    body.event_type || '',
    primary?.id || null,
    primary?.name || '',
    body.event_date || '',
    body.event_time || '',
    body.topic || '',
    body.zoom_link || '',
    body.status || 'Planning'
  ], speakers };
}

async function insertSpeaker(env, speaker, hub = 'heme') {
  return env.DB.prepare(`INSERT INTO speakers
    (name,email,institution,specialty,expertise,faculty_profile_url,notes,participation_history,hub_key)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(...speakerValues(speaker), hub).run();
}

async function ensureCalendlySpeaker(env, speaker) {
  const existing = await env.DB.prepare('SELECT * FROM speakers WHERE lower(email) = lower(?) ORDER BY id LIMIT 1')
    .bind(speaker.email).first();
  if (existing) return existing;
  validateSpeaker(speaker);
  const result = await env.DB.prepare(`INSERT INTO speakers
    (name,email,institution,specialty,faculty_profile_url,notes,participation_history)
    VALUES (?,?,?,?,?,?,?)`).bind(
    speaker.name,
    speaker.email,
    speaker.institution || '',
    speaker.specialty || '',
    '',
    speaker.notes || '',
    ''
  ).run();
  return getSpeaker(env, result.meta.last_row_id);
}

async function createCalendlyEvent(env, body) {
  const event = calendlyEventBody(body);
  if (event.ignored) return event;
  const existing = event.calendly_invitee_uri
    ? await env.DB.prepare('SELECT id FROM events WHERE calendly_invitee_uri = ?')
      .bind(event.calendly_invitee_uri).first()
    : null;
  if (existing) return { duplicate: true, event: await withChecklist(env, await getEvent(env, existing.id)) };
  const speaker = await ensureCalendlySpeaker(env, event.speaker);
  const result = await env.DB.prepare(`INSERT INTO events
    (event_name,event_type,speaker_id,speaker_name,event_date,event_time,topic,zoom_link,status,calendly_event_uri,calendly_invitee_uri)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(
    event.event_name,
    event.event_type,
    speaker.id,
    speaker.name,
    event.event_date,
    event.event_time,
    event.topic,
    event.zoom_link,
    event.status,
    event.calendly_event_uri,
    event.calendly_invitee_uri
  ).run();
  await syncEventSpeakers(env, result.meta.last_row_id, [speaker]);
  await createEventChecklist(env, result.meta.last_row_id, checklistDueDates(event));
  await applyStatusChecklist(env, result.meta.last_row_id, event.status);
  return { created: true, event: await withChecklist(env, await getEvent(env, result.meta.last_row_id)) };
}

function calendlyStatus(request, env) {
  return {
    enabled: true,
    webhook_url: `${new URL(request.url).origin}/api/calendly/webhook`,
    signature_configured: Boolean(env.CALENDLY_WEBHOOK_SECRET),
    listens_for: ['invitee.created'],
    required_questions: ['Topic', 'Event Type', 'Institution', 'Specialty'],
    default_status: 'Speaker Confirmed',
    default_event_type: 'Webinar'
  };
}

function calendlyTestPayload() {
  const stamp = Date.now();
  return {
    event: 'invitee.created',
    payload: {
      uri: `https://api.calendly.com/scheduled_events/clinedpulse-test/invitees/${stamp}`,
      name: 'Dr. Calendly Test',
      email: `calendly.test.${stamp}@example.com`,
      timezone: 'America/Chicago',
      questions_and_answers: [
        { question: 'Institution', answer: 'Calendly Medical Center' },
        { question: 'Specialty', answer: 'Hematology' },
        { question: 'Topic', answer: 'Automated Scheduling Workflow' },
        { question: 'Event Type', answer: 'Webinar' }
      ],
      scheduled_event: {
        uri: `https://api.calendly.com/scheduled_events/clinedpulse-test-${stamp}`,
        name: 'Calendly Integration Test',
        start_time: '2026-12-10T16:30:00.000000Z',
        location: { type: 'zoom', join_url: 'https://zoom.us/j/calendly-test' }
      }
    }
  };
}

async function importSpeakers(env, speakers, hub = 'heme') {
  if (!Array.isArray(speakers)) throw Object.assign(new Error('Speakers must be an array'), { status: 400 });
  if (speakers.length > 1000) throw Object.assign(new Error('Import is limited to 1,000 rows at a time'), { status: 413 });

  const summary = { added: 0, skipped: 0, failed: 0, errors: [] };
  const seen = new Set();
  for (const [index, speaker] of speakers.entries()) {
    try {
      validateSpeaker(speaker);
      const email = speaker.email?.trim().toLowerCase() || '';
      if (email && seen.has(email)) {
        summary.skipped += 1;
        continue;
      }
      if (email) seen.add(email);
      await ensureSpeakerIsUnique(env, speaker);
      await insertSpeaker(env, speaker, hub);
      summary.added += 1;
    } catch (error) {
      if (error.message?.includes('UNIQUE constraint failed')) {
        summary.skipped += 1;
      } else {
        summary.failed += 1;
        summary.errors.push({ row: index + 1, error: error.message });
      }
    }
  }
  return summary;
}

async function importEvents(env, events, hub = 'heme') {
  if (!Array.isArray(events)) throw Object.assign(new Error('Events must be an array'), { status: 400 });
  if (events.length > 1000) throw Object.assign(new Error('Import is limited to 1,000 rows at a time'), { status: 413 });

  const summary = { added: 0, skipped: 0, failed: 0, errors: [] };
  const seen = new Set();
  for (const [index, event] of events.entries()) {
    try {
      const { values, speakers } = await eventValues(env, event, hub);
      const duplicateKey = values.slice(0, 6).join('|').toLowerCase();
      if (seen.has(duplicateKey)) {
        summary.skipped += 1;
        continue;
      }
      seen.add(duplicateKey);
      await ensureEventIsUnique(env, values);
      const result = await env.DB.prepare(`INSERT INTO events
        (event_name,event_type,speaker_id,speaker_name,event_date,event_time,topic,zoom_link,status,hub_key)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(...values, hub).run();
      await syncEventSpeakers(env, result.meta.last_row_id, speakers);
      await createEventChecklist(env, result.meta.last_row_id, checklistDueDates(event));
      await applyStatusChecklist(env, result.meta.last_row_id, values[8]);
      summary.added += 1;
    } catch (error) {
      summary.failed += 1;
      summary.errors.push({ row: index + 1, error: error.message });
    }
  }
  return summary;
}

const emailReviewSelect = `SELECT email_material_reviews.*,
  speakers.name speaker_name,
  events.event_name,
  events.event_date
  FROM email_material_reviews
  LEFT JOIN speakers ON speakers.id = email_material_reviews.speaker_id
  LEFT JOIN events ON events.id = email_material_reviews.event_id`;

async function storeEmailMaterialReviews(env, email) {
  const senderEmail = normalizeEmailAddress(email.sender_email);
  const materials = detectEmailMaterials(email);
  if (!materials.length) return { created: 0, materials: [] };

  const speaker = senderEmail
    ? await env.DB.prepare('SELECT id,name,hub_key FROM speakers WHERE lower(email) = lower(?) LIMIT 1').bind(senderEmail).first()
    : null;
  if (email.require_known_speaker && !speaker) {
    return { created: 0, materials, ignored: 'unknown_speaker' };
  }
  const hub = hubKey(speaker?.hub_key || email.hub_key);
  const matchedEvent = speaker
    ? await env.DB.prepare(`SELECT id,event_name,event_date FROM events
      WHERE (speaker_id = ? OR EXISTS (
        SELECT 1 FROM event_speakers WHERE event_speakers.event_id = events.id AND event_speakers.speaker_id = ?
      )) AND hub_key = ?
      ORDER BY CASE WHEN event_date >= date('now') THEN 0 ELSE 1 END,
        CASE WHEN event_date >= date('now') THEN event_date END ASC,
        event_date DESC, id DESC
      LIMIT 1`).bind(speaker.id, speaker.id, hub).first()
    : null;

  let created = 0;
  for (const material of materials) {
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO email_material_reviews
      (message_key,sender_email,recipient_email,subject,attachment_name,material_type,checklist_label,speaker_id,event_id,hub_key)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(
      email.message_key,
      senderEmail,
      normalizeEmailAddress(email.recipient_email),
      String(email.subject || '').slice(0, 500),
      String(material.attachment_name || '').slice(0, 500),
      material.type,
      material.label,
      speaker?.id || null,
      matchedEvent?.id || null,
      hub
    ).run();
    created += result.meta.changes || 0;
  }
  return { created, materials, speaker, event: matchedEvent };
}

async function listEmailMaterialReviews(env, hub, status = 'pending') {
  const allowedStatus = ['pending', 'received', 'ignored'].includes(status) ? status : 'pending';
  const { results } = await env.DB.prepare(`${emailReviewSelect}
    WHERE email_material_reviews.hub_key = ? AND email_material_reviews.status = ?
    ORDER BY email_material_reviews.created_at DESC, email_material_reviews.id DESC`)
    .bind(hub, allowedStatus).all();
  return results.map(review => ({
    ...review,
    title: materialNotificationTitle(
      review.material_type === 'slides' ? 'Slides' : review.material_type === 'biography' ? 'Biography' : 'Consent Form',
      review.speaker_name
    )
  }));
}

async function reviewEmailMaterial(env, id, hub, action, requestedEventId) {
  if (!['received', 'ignored'].includes(action)) {
    throw Object.assign(new Error('Choose Mark Received or Ignore'), { status: 400 });
  }
  const review = await env.DB.prepare(`SELECT * FROM email_material_reviews
    WHERE id = ? AND hub_key = ? LIMIT 1`).bind(id, hub).first();
  if (!review) throw Object.assign(new Error('Email review not found'), { status: 404 });
  if (review.status !== 'pending') throw Object.assign(new Error('This email has already been reviewed'), { status: 409 });

  if (action === 'ignored') {
    await env.DB.prepare(`UPDATE email_material_reviews SET
      status='ignored',reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='pending'`).bind(id).run();
    return { ok: true, status: 'ignored' };
  }

  const eventId = Number(requestedEventId || review.event_id);
  if (!eventId) throw Object.assign(new Error('Match this email to an event before marking it received'), { status: 400 });
  const checklist = await env.DB.prepare(`SELECT event_checklist_items.id
    FROM event_checklist_items
    JOIN events ON events.id = event_checklist_items.event_id
    WHERE events.id = ? AND events.hub_key = ?
      AND event_checklist_items.label = ?
      AND (? IS NULL OR events.speaker_id = ? OR EXISTS (
        SELECT 1 FROM event_speakers WHERE event_speakers.event_id = events.id AND event_speakers.speaker_id = ?
      ))
    LIMIT 1`).bind(eventId, hub, review.checklist_label, review.speaker_id, review.speaker_id, review.speaker_id).first();
  if (!checklist) throw Object.assign(new Error('A matching event checklist item could not be found'), { status: 404 });

  await env.DB.batch([
    env.DB.prepare(`UPDATE event_checklist_items SET
      completed=1,completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).bind(checklist.id),
    env.DB.prepare(`UPDATE email_material_reviews SET
      status='received',event_id=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='pending'`).bind(eventId, id)
  ]);
  return { ok: true, status: 'received', event_id: eventId, checklist_label: review.checklist_label };
}

async function emailMessageKey(messageId, raw) {
  if (messageId?.trim()) return messageId.trim().slice(0, 500);
  const digest = await crypto.subtle.digest('SHA-256', raw);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function handleApi(request, env, url) {
  const selectedHub = hubKey(url.searchParams.get('hub'));
  const mode = url.searchParams.get('mode') === 'test' ? 'test' : 'live';
  const hub = storageHubKey(selectedHub, mode);
  if (request.method === 'GET' && url.pathname === '/api/overview') {
    const [total, specialties, institutions, recent, eventTotal, upcomingEvents, needsAttention, completedEvents, statusCounts, tasks] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) count FROM speakers WHERE hub_key = ?').bind(hub).first('count'),
      env.DB.prepare("SELECT COUNT(DISTINCT specialty) count FROM speakers WHERE specialty != '' AND hub_key = ?").bind(hub).first('count'),
      env.DB.prepare("SELECT COUNT(DISTINCT institution) count FROM speakers WHERE institution != '' AND hub_key = ?").bind(hub).first('count'),
      env.DB.prepare('SELECT * FROM speakers WHERE hub_key = ? ORDER BY created_at DESC, id DESC LIMIT 5').bind(hub).all(),
      env.DB.prepare('SELECT COUNT(*) count FROM events WHERE hub_key = ?').bind(hub).first('count'),
      env.DB.prepare(`SELECT events.*, COALESCE(speakers.name, events.speaker_name) speaker,
        COUNT(event_checklist_items.id) checklist_total,
        COALESCE(SUM(CASE WHEN event_checklist_items.completed = 1 THEN 1 ELSE 0 END), 0) checklist_done,
        ${readinessScoreSql} readiness_score
        FROM events LEFT JOIN speakers ON speakers.id = events.speaker_id
        LEFT JOIN event_checklist_items ON event_checklist_items.event_id = events.id
        WHERE event_date >= date('now') AND events.hub_key = ?
        GROUP BY events.id
        ORDER BY event_date, event_time, events.id LIMIT 5`).bind(hub).all(),
      env.DB.prepare(`SELECT COUNT(*) count FROM events
        WHERE status IN ('Planning','Speaker Invited','Materials Pending','Zoom Scheduled')
        AND event_date >= date('now') AND hub_key = ?`).bind(hub).first('count'),
      env.DB.prepare("SELECT COUNT(*) count FROM events WHERE status IN ('Completed','Follow-Up Complete') AND hub_key = ?").bind(hub).first('count'),
      env.DB.prepare('SELECT status, COUNT(*) count FROM events WHERE hub_key = ? GROUP BY status ORDER BY count DESC, status').bind(hub).all(),
      overviewTasks(env, hub)
    ]);

    return json({
      speakers: { total, specialties, institutions },
      events: {
        total: eventTotal,
        upcoming: upcomingEvents.results,
        needsAttention,
        completed: completedEvents,
        statusCounts: statusCounts.results,
        tasks,
        todoTasks: tasks.todo.length,
        urgentTasks: tasks.urgent.length,
        upcomingTasks: tasks.upcoming.length
      },
      total,
      specialties,
      institutions,
      recent: recent.results.map(publicSpeaker)
    });
  }

  if (request.method === 'GET' && url.pathname === '/api/speakers') {
    const q = `%${url.searchParams.get('q') || ''}%`;
    const searchBy = url.searchParams.get('searchBy') || 'all';
    const sort = url.searchParams.get('sort') || 'name_asc';
    const orderBy = speakerSorts[sort] || speakerSorts.name_asc;
    const searchColumns = {
      name: ['name'],
      specialty: ['specialty'],
      expertise: ['expertise'],
      institution: ['institution'],
      all: ['name', 'specialty', 'expertise', 'institution']
    }[searchBy] || ['name', 'specialty', 'expertise', 'institution'];
    const where = searchColumns.map(column => `${column} LIKE ?`).join(' OR ');
    const { results } = await env.DB.prepare(`SELECT * FROM speakers WHERE hub_key = ? AND (${where}) ORDER BY ${orderBy}`)
      .bind(hub, ...searchColumns.map(() => q)).all();
    return json(results.map(publicSpeaker));
  }

  if (request.method === 'GET' && url.pathname === '/api/events') {
    const filters = ['events.hub_key = ?'];
    const values = [hub];
    const month = url.searchParams.get('month') || '';
    const type = url.searchParams.get('type') || '';
    const status = url.searchParams.get('status') || '';
    const sort = url.searchParams.get('sort') || 'date_desc';
    const orderBy = eventSorts[sort] || eventSorts.date_desc;
    if (month) {
      filters.push("strftime('%Y-%m', event_date) = ?");
      values.push(month);
    }
    if (type) {
      filters.push('event_type = ?');
      values.push(type);
    }
    if (status) {
      filters.push('status = ?');
      values.push(status);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const statement = env.DB.prepare(`SELECT events.*, COALESCE((
        SELECT group_concat(name, ', ') FROM (
          SELECT speakers.name name FROM event_speakers
          JOIN speakers ON speakers.id = event_speakers.speaker_id
          WHERE event_speakers.event_id = events.id
          ORDER BY event_speakers.position, speakers.name
        )
      ), speakers.name, events.speaker_name) speaker,
      COUNT(event_checklist_items.id) checklist_total,
      COALESCE(SUM(CASE WHEN event_checklist_items.completed = 1 THEN 1 ELSE 0 END), 0) checklist_done,
      ${readinessScoreSql} readiness_score
      FROM events
      LEFT JOIN speakers ON speakers.id = events.speaker_id
      LEFT JOIN event_checklist_items ON event_checklist_items.event_id = events.id
      ${where}
      GROUP BY events.id
      ORDER BY ${orderBy}`);
    const { results } = values.length ? await statement.bind(...values).all() : await statement.all();
    return json(results);
  }

  if (request.method === 'GET' && url.pathname === '/api/calendly/status') {
    if (!calendlyEnabled(env)) return json({ error: 'Not found' }, 404);
    return json(calendlyStatus(request, env));
  }

  if (request.method === 'GET' && url.pathname === '/api/email-materials') {
    return json(await listEmailMaterialReviews(env, hub, url.searchParams.get('status') || 'pending'));
  }

  if (request.method === 'POST' && url.pathname === '/api/email-materials/ingest') {
    const raw = await request.text();
    const verification = await verifyWebhookSignature({
      secret: env.EMAIL_INGEST_SECRET,
      timestamp: request.headers.get('x-clinedpulse-timestamp'),
      signature: request.headers.get('x-clinedpulse-signature'),
      body: raw
    });
    if (!verification.ok) {
      const status = verification.reason === 'not_configured' ? 503 : 401;
      throw Object.assign(new Error('Email ingestion authorization failed'), { status });
    }
    const body = parseJson(raw);
    const result = await storeEmailMaterialReviews(env, { ...body, require_known_speaker: true });
    return json(result, 202);
  }

  const emailReviewMatch = url.pathname.match(/^\/api\/email-materials\/(\d+)\/review$/);
  if (emailReviewMatch && request.method === 'PUT') {
    const body = await parseBody(request);
    return json(await reviewEmailMaterial(env, emailReviewMatch[1], hub, body.action, body.event_id));
  }

  if (request.method === 'POST' && url.pathname === '/api/speakers') {
    const body = await parseBody(request);
    validateSpeaker(body);
    await ensureSpeakerIsUnique(env, body);
    const result = await insertSpeaker(env, body, hub);
    return json(await getSpeaker(env, result.meta.last_row_id), 201);
  }

  if (request.method === 'POST' && url.pathname === '/api/speakers/import') {
    const body = await parseBody(request);
    return json(await importSpeakers(env, body.speakers, hub), 201);
  }

  if (request.method === 'POST' && url.pathname === '/api/calendly/webhook') {
    if (!calendlyEnabled(env)) return json({ error: 'Not found' }, 404);
    const raw = await request.text();
    await verifyCalendlySignature(request, raw, env);
    const result = await createCalendlyEvent(env, parseJson(raw));
    return json(result, result.ignored ? 202 : result.duplicate ? 200 : 201);
  }

  if (request.method === 'POST' && url.pathname === '/api/calendly/test') {
    if (!calendlyEnabled(env)) return json({ error: 'Not found' }, 404);
    return json({ ...await createCalendlyEvent(env, calendlyTestPayload()), test: true }, 201);
  }

  if (request.method === 'POST' && url.pathname === '/api/events') {
    const body = await parseBody(request);
    const requestKey = eventRequestKey(body);
    const existing = await eventByRequestKey(env, hub, requestKey);
    if (existing) return json(await withChecklist(env, existing));
    const { values, speakers } = await eventValues(env, body, hub);
    await ensureEventIsUnique(env, values);
    let result;
    try {
      result = await env.DB.prepare(`INSERT INTO events
        (event_name,event_type,speaker_id,speaker_name,event_date,event_time,topic,zoom_link,status,hub_key,request_key)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(...values, hub, requestKey).run();
    } catch (error) {
      const retried = await eventByRequestKey(env, hub, requestKey);
      if (retried) return json(await withChecklist(env, retried));
      throw error;
    }
    await syncEventSpeakers(env, result.meta.last_row_id, speakers);
    await createEventChecklist(env, result.meta.last_row_id, checklistDueDates(body));
    await applyStatusChecklist(env, result.meta.last_row_id, values[8]);
    return json(await withChecklist(env, await getEvent(env, result.meta.last_row_id)), 201);
  }

  if (request.method === 'POST' && url.pathname === '/api/events/import') {
    const body = await parseBody(request);
    return json(await importEvents(env, body.events, hub), 201);
  }

  const match = url.pathname.match(/^\/api\/speakers\/(\d+)$/);
  if (match && request.method === 'GET') {
    const speaker = await getSpeaker(env, match[1]);
    return speaker ? json(await withSpeakerHistory(env, speaker)) : json({ error: 'Speaker not found' }, 404);
  }

  if (match && request.method === 'PUT') {
    const body = await parseBody(request);
    validateSpeaker(body);
    await ensureSpeakerIsUnique(env, body, match[1]);
    const result = await env.DB.prepare(`UPDATE speakers SET
      name=?,email=?,institution=?,specialty=?,expertise=?,faculty_profile_url=?,notes=?,participation_history=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).bind(...speakerValues(body), match[1]).run();
    return result.meta.changes
      ? json(await getSpeaker(env, match[1]))
      : json({ error: 'Speaker not found' }, 404);
  }

  if (match && request.method === 'DELETE') {
    const result = await env.DB.prepare('DELETE FROM speakers WHERE id = ?').bind(match[1]).run();
    return result.meta.changes ? json({ ok: true }) : json({ error: 'Speaker not found' }, 404);
  }

  const eventMatch = url.pathname.match(/^\/api\/events\/(\d+)$/);
  if (eventMatch && request.method === 'GET') {
    const event = await getEvent(env, eventMatch[1]);
    return event ? json(await withChecklist(env, event)) : json({ error: 'Event not found' }, 404);
  }

  if (eventMatch && request.method === 'PUT') {
    const body = await parseBody(request);
    const { values, speakers } = await eventValues(env, body, hub);
    await ensureEventIsUnique(env, values, eventMatch[1]);
    const result = await env.DB.prepare(`UPDATE events SET
      event_name=?,event_type=?,speaker_id=?,speaker_name=?,event_date=?,event_time=?,topic=?,zoom_link=?,status=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).bind(...values, eventMatch[1]).run();
    if (result.meta.changes) {
      await syncEventSpeakers(env, eventMatch[1], speakers);
      await updateChecklistDueDates(env, eventMatch[1], checklistDueDates(body));
      await applyStatusChecklist(env, eventMatch[1], values[8]);
    }
    return result.meta.changes
      ? json(await withChecklist(env, await getEvent(env, eventMatch[1])))
      : json({ error: 'Event not found' }, 404);
  }

  const checklistMatch = url.pathname.match(/^\/api\/events\/(\d+)\/checklist\/(\d+)$/);
  if (checklistMatch && request.method === 'PUT') {
    const body = await parseBody(request);
    const completed = body.completed ? 1 : 0;
    const result = await env.DB.prepare(`UPDATE event_checklist_items SET
      completed=?,completed_at=CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND event_id=?`).bind(completed, completed, checklistMatch[2], checklistMatch[1]).run();
    return result.meta.changes
      ? json(await withChecklist(env, await getEvent(env, checklistMatch[1])))
      : json({ error: 'Checklist item not found' }, 404);
  }

  if (eventMatch && request.method === 'DELETE') {
    const result = await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(eventMatch[1]).run();
    return result.meta.changes ? json({ ok: true }) : json({ error: 'Event not found' }, 404);
  }

  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(JSON.stringify({
        message: 'request failed',
        method: request.method,
        path: url.pathname,
        error: String(error?.message || error)
      }));
      const status = error.message?.includes('UNIQUE constraint failed') ? 409 : error.status || 500;
      return json({ error: constraintMessage(error) }, status);
    }
  },

  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();
    const parsed = await PostalMime.parse(raw);
    await storeEmailMaterialReviews(env, {
      message_key: await emailMessageKey(message.headers.get('message-id'), raw),
      sender_email: message.from,
      recipient_email: message.to,
      subject: parsed.subject || message.headers.get('subject') || '',
      text: parsed.text || '',
      attachments: parsed.attachments || []
    });
  }
};
