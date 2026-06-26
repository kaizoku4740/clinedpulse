import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './lib/database.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const port = Number(process.env.PORT || 3000);

const json = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

const parseBody = async req => {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw Object.assign(new Error('Request too large'), { status: 413 });
  }
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
};

const getSpeaker = id => db.prepare('SELECT * FROM speakers WHERE id = ?').get(id);
const fields = body => [
  body.name.trim(), body.email.trim(), body.institution || '', body.specialty || '',
  body.faculty_profile_url || '', body.notes || '', body.participation_history || ''
];

function validate(body) {
  if (!body.name?.trim()) throw Object.assign(new Error('Name is required'), { status: 400 });
  if (!/^\S+@\S+\.\S+$/.test(body.email || '')) throw Object.assign(new Error('A valid email is required'), { status: 400 });
}

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/overview') {
    const total = db.prepare('SELECT COUNT(*) count FROM speakers').get().count;
    const specialties = db.prepare("SELECT COUNT(DISTINCT specialty) count FROM speakers WHERE specialty != ''").get().count;
    const institutions = db.prepare("SELECT COUNT(DISTINCT institution) count FROM speakers WHERE institution != ''").get().count;
    const recent = db.prepare('SELECT * FROM speakers ORDER BY created_at DESC, id DESC LIMIT 5').all();
    return json(res, 200, { total, specialties, institutions, recent });
  }

  if (req.method === 'GET' && url.pathname === '/api/speakers') {
    const q = `%${url.searchParams.get('q') || ''}%`;
    const rows = db.prepare(`SELECT * FROM speakers
      WHERE name LIKE ? OR email LIKE ? OR specialty LIKE ? OR institution LIKE ?
      ORDER BY name`).all(q, q, q, q);
    return json(res, 200, rows);
  }

  if (req.method === 'POST' && url.pathname === '/api/speakers') {
    const body = await parseBody(req); validate(body);
    const result = db.prepare(`INSERT INTO speakers
      (name,email,institution,specialty,faculty_profile_url,notes,participation_history)
      VALUES (?,?,?,?,?,?,?)`).run(...fields(body));
    return json(res, 201, getSpeaker(result.lastInsertRowid));
  }

  const match = url.pathname.match(/^\/api\/speakers\/(\d+)$/);
  if (match && req.method === 'GET') {
    const speaker = getSpeaker(match[1]);
    return speaker ? json(res, 200, speaker) : json(res, 404, { error: 'Speaker not found' });
  }

  if (match && req.method === 'PUT') {
    const body = await parseBody(req); validate(body);
    const result = db.prepare(`UPDATE speakers SET
      name=?,email=?,institution=?,specialty=?,faculty_profile_url=?,notes=?,participation_history=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).run(...fields(body), match[1]);
    return result.changes ? json(res, 200, getSpeaker(match[1])) : json(res, 404, { error: 'Speaker not found' });
  }

  return json(res, 404, { error: 'Not found' });
}

async function serveStatic(res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const safe = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
  const file = join(publicDir, safe);
  if (!file.startsWith(publicDir)) return json(res, 403, { error: 'Forbidden' });
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': `${types[extname(file)] || 'application/octet-stream'}; charset=utf-8` });
    res.end(content);
  } catch { json(res, 404, { error: 'Not found' }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    const status = error.code?.startsWith('SQLITE_CONSTRAINT') ? 409 : error.status || 500;
    json(res, status, { error: status === 409 ? 'A speaker with this email already exists' : error.message });
  }
});

server.listen(port, () => console.log(`ClinEdPulse Speaker Database running at http://localhost:${port}`));
