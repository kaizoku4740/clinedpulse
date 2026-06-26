const json = (data, status = 200) => Response.json(data, { status });

async function parseBody(request) {
  const raw = await request.text();
  if (!raw) return {};
  if (raw.length > 1_000_000) throw Object.assign(new Error('Request too large'), { status: 413 });
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

function validateSpeaker(body) {
  if (!body.name?.trim()) throw Object.assign(new Error('Name is required'), { status: 400 });
  if (!/^\S+@\S+\.\S+$/.test(body.email || '')) {
    throw Object.assign(new Error('A valid email is required'), { status: 400 });
  }
}

function speakerValues(body) {
  return [
    body.name.trim(),
    body.email.trim(),
    body.institution || '',
    body.specialty || '',
    body.faculty_profile_url || '',
    body.notes || '',
    body.participation_history || ''
  ];
}

async function getSpeaker(env, id) {
  return env.DB.prepare('SELECT * FROM speakers WHERE id = ?').bind(id).first();
}

async function handleApi(request, env, url) {
  if (request.method === 'GET' && url.pathname === '/api/overview') {
    const [total, specialties, institutions, recent] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) count FROM speakers').first('count'),
      env.DB.prepare("SELECT COUNT(DISTINCT specialty) count FROM speakers WHERE specialty != ''").first('count'),
      env.DB.prepare("SELECT COUNT(DISTINCT institution) count FROM speakers WHERE institution != ''").first('count'),
      env.DB.prepare('SELECT * FROM speakers ORDER BY created_at DESC, id DESC LIMIT 5').all()
    ]);

    return json({ total, specialties, institutions, recent: recent.results });
  }

  if (request.method === 'GET' && url.pathname === '/api/speakers') {
    const q = `%${url.searchParams.get('q') || ''}%`;
    const searchBy = url.searchParams.get('searchBy') || 'all';
    const searchColumns = {
      name: ['name'],
      specialty: ['specialty'],
      institution: ['institution'],
      all: ['name', 'specialty', 'institution']
    }[searchBy] || ['name', 'specialty', 'institution'];
    const where = searchColumns.map(column => `${column} LIKE ?`).join(' OR ');
    const { results } = await env.DB.prepare(`SELECT * FROM speakers WHERE ${where} ORDER BY name`)
      .bind(...searchColumns.map(() => q)).all();
    return json(results);
  }

  if (request.method === 'POST' && url.pathname === '/api/speakers') {
    const body = await parseBody(request);
    validateSpeaker(body);
    const result = await env.DB.prepare(`INSERT INTO speakers
      (name,email,institution,specialty,faculty_profile_url,notes,participation_history)
      VALUES (?,?,?,?,?,?,?)`).bind(...speakerValues(body)).run();
    return json(await getSpeaker(env, result.meta.last_row_id), 201);
  }

  const match = url.pathname.match(/^\/api\/speakers\/(\d+)$/);
  if (match && request.method === 'GET') {
    const speaker = await getSpeaker(env, match[1]);
    return speaker ? json(speaker) : json({ error: 'Speaker not found' }, 404);
  }

  if (match && request.method === 'PUT') {
    const body = await parseBody(request);
    validateSpeaker(body);
    const result = await env.DB.prepare(`UPDATE speakers SET
      name=?,email=?,institution=?,specialty=?,faculty_profile_url=?,notes=?,participation_history=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).bind(...speakerValues(body), match[1]).run();
    return result.meta.changes
      ? json(await getSpeaker(env, match[1]))
      : json({ error: 'Speaker not found' }, 404);
  }

  if (match && request.method === 'DELETE') {
    const result = await env.DB.prepare('DELETE FROM speakers WHERE id = ?').bind(match[1]).run();
    return result.meta.changes ? json({ ok: true }) : json({ error: 'Speaker not found' }, 404);
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
      const status = error.message?.includes('UNIQUE constraint failed') ? 409 : error.status || 500;
      return json({
        error: status === 409 ? 'A speaker with this email already exists' : error.message
      }, status);
    }
  }
};
