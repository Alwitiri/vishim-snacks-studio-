// Vishim Snack Studio — zero-dependency Node server (website + admin API)
// Run: node server.js   (Node 18+)
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SEED_FILE = path.join(ROOT, 'seed.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads'); // served at /uploads/
const MAX_BODY = 6 * 1024 * 1024; // 6 MB (image uploads are sent as base64)
const SESSION_TTL = 1000 * 60 * 60 * 12; // 12 hours
// Login is OFF by default: /admin opens directly for anyone.
// Set REQUIRE_LOGIN=1 (and ADMIN_PASSWORD) on the host to turn the password login back on.
const LOGIN_REQUIRED = process.env.REQUIRE_LOGIN === '1';
// On hosts with temporary disks (e.g. Render), never allow claiming the admin via the web:
// the password must come from the ADMIN_PASSWORD environment variable.
const WEB_SETUP_DISABLED = !!(process.env.RENDER || process.env.DISABLE_WEB_SETUP);

/* ---------------------------------------------------------------- storage */

let db;
let writing = Promise.resolve();

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.copyFileSync(SEED_FILE, DB_FILE);
    console.log('Created', DB_FILE, 'from seed.json');
  }
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db.admin = db.admin || {};
  db.menu = db.menu || [];
  db.reviews = db.reviews || [];
  db.categories = db.categories || [];
  // Optional: set/override admin password from environment
  if (process.env.ADMIN_PASSWORD) {
    db.admin.passwordHash = hashPassword(process.env.ADMIN_PASSWORD);
    saveDb();
  }
}

function saveDb() {
  const snapshot = JSON.stringify(db, null, 2);
  writing = writing.then(async () => {
    const tmp = DB_FILE + '.tmp';
    await fsp.writeFile(tmp, snapshot);
    await fsp.rename(tmp, DB_FILE);
  }).catch((e) => console.error('DB write failed', e));
  return writing;
}

const uid = () => crypto.randomBytes(6).toString('hex');

/* ---------------------------------------------------------------- auth */

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

const sessions = new Map(); // token -> expiry
function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  return token;
}
function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
function isAuthed(req) {
  if (!LOGIN_REQUIRED) return true;
  const t = getCookie(req, 'vss_session');
  if (!t || !sessions.has(t)) return false;
  if (sessions.get(t) < Date.now()) { sessions.delete(t); return false; }
  sessions.set(t, Date.now() + SESSION_TTL);
  return true;
}
function sessionCookie(token, maxAgeSec) {
  return `vss_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
}

// naive in-memory rate limiter
const hits = new Map();
function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  const rec = hits.get(key) || { n: 0, reset: now + windowMs };
  if (now > rec.reset) { rec.n = 0; rec.reset = now + windowMs; }
  rec.n++;
  hits.set(key, rec);
  return rec.n > limit;
}

/* ---------------------------------------------------------------- helpers */

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, min = 0, max = 100000) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};
const bool = (v) => v === true || v === 'true' || v === 1;
// Only allow images we serve ourselves
const imgPath = (v) => {
  const s = str(v, 300);
  return /^\/(assets\/img|uploads)\/[\w.-]+$/.test(s) ? s : '';
};

function cleanMenuItem(b, existing = {}) {
  return {
    id: existing.id || uid(),
    name: str(b.name, 80) || existing.name || 'Untitled',
    category: str(b.category, 40) || 'Momos',
    price: num(b.price, 0, 100000),
    description: str(b.description, 240),
    veg: bool(b.veg),
    available: b.available === undefined ? true : bool(b.available),
    popular: bool(b.popular),
    image: imgPath(b.image),
    order: num(b.order ?? existing.order ?? db.menu.length, 0, 100000),
  };
}

function cleanReview(b, existing = {}) {
  return {
    id: existing.id || uid(),
    name: str(b.name, 60) || 'Guest',
    rating: Math.round(num(b.rating, 1, 5)),
    text: str(b.text, 600),
    avatar: imgPath(b.avatar),
    status: ['approved', 'pending', 'hidden'].includes(b.status) ? b.status : (existing.status || 'pending'),
    createdAt: existing.createdAt || new Date().toISOString(),
  };
}

const SETTINGS_FIELDS = {
  name: 80, tagline: 120, heroTitle: 60, heroScript: 60, heroSubtitle: 200,
  phone: 30, addressShort: 80, addressLine2: 80, addressFull: 200, priceRange: 30,
  hoursText: 60, mapsUrl: 500, aboutText: 800, aboutScript: 80, footerMotto: 60,
  noticeText: 200,
};

function publicData() {
  const { admin, ...rest } = db; // never leak the hash
  return {
    settings: rest.settings,
    categories: rest.categories,
    menu: rest.menu.filter((m) => m.available).sort((a, b) => a.order - b.order),
    reviews: rest.reviews.filter((r) => r.status === 'approved')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
  };
}

/* ---------------------------------------------------------------- API */

async function handleApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  const ip = req.socket.remoteAddress || 'x';

  // CSRF hardening: state-changing requests must be JSON (forces CORS preflight cross-site)
  if (m !== 'GET' && !(req.headers['content-type'] || '').includes('application/json')) {
    return send(res, 415, { error: 'Content-Type must be application/json' });
  }

  /* ---- public ---- */
  if (p === '/api/public' && m === 'GET') return send(res, 200, publicData());

  if (p === '/api/reviews' && m === 'POST') {
    if (rateLimited('review:' + ip, 3, 60 * 60 * 1000)) return send(res, 429, { error: 'Too many reviews from you. Please try later.' });
    const b = await readBody(req);
    if (str(b.website)) return send(res, 200, { ok: true }); // honeypot
    if (!str(b.name) || str(b.text).length < 5) return send(res, 400, { error: 'Please add your name and a short review.' });
    const r = cleanReview({ ...b, avatar: '', status: 'pending' });
    db.reviews.push(r);
    await saveDb();
    return send(res, 201, { ok: true });
  }

  /* ---- auth ---- */
  if (p === '/api/auth/status' && m === 'GET') {
    return send(res, 200, { configured: !!db.admin.passwordHash, loggedIn: isAuthed(req), setupDisabled: LOGIN_REQUIRED && WEB_SETUP_DISABLED && !db.admin.passwordHash, loginRequired: LOGIN_REQUIRED });
  }
  if (p === '/api/auth/setup' && m === 'POST') {
    if (db.admin.passwordHash) return send(res, 409, { error: 'Admin already set up' });
    if (WEB_SETUP_DISABLED) return send(res, 403, { error: 'Set the ADMIN_PASSWORD environment variable on your host to enable the admin panel.' });
    const b = await readBody(req);
    if (str(b.password, 200).length < 8) return send(res, 400, { error: 'Password must be at least 8 characters' });
    db.admin.passwordHash = hashPassword(str(b.password, 200));
    await saveDb();
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(createSession(), SESSION_TTL / 1000) });
  }
  if (p === '/api/auth/login' && m === 'POST') {
    if (rateLimited('login:' + ip, 10, 15 * 60 * 1000)) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
    const b = await readBody(req);
    if (!verifyPassword(str(b.password, 200), db.admin.passwordHash)) return send(res, 401, { error: 'Wrong password' });
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(createSession(), SESSION_TTL / 1000) });
  }
  if (p === '/api/auth/logout' && m === 'POST') {
    sessions.delete(getCookie(req, 'vss_session'));
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  /* ---- admin (auth required below) ---- */
  if (!p.startsWith('/api/admin/')) return send(res, 404, { error: 'Not found' });
  if (!isAuthed(req)) return send(res, 401, { error: 'Please log in' });

  if (p === '/api/admin/data' && m === 'GET') {
    const { admin, ...rest } = db;
    return send(res, 200, rest);
  }

  if (p === '/api/admin/password' && m === 'POST') {
    const b = await readBody(req);
    if (!verifyPassword(str(b.current, 200), db.admin.passwordHash)) return send(res, 400, { error: 'Current password is wrong' });
    if (str(b.next, 200).length < 8) return send(res, 400, { error: 'New password must be at least 8 characters' });
    db.admin.passwordHash = hashPassword(str(b.next, 200));
    sessions.clear();
    await saveDb();
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(createSession(), SESSION_TTL / 1000) });
  }

  if (p === '/api/admin/settings' && m === 'PUT') {
    const b = await readBody(req);
    for (const [k, max] of Object.entries(SETTINGS_FIELDS)) if (k in b) db.settings[k] = str(b[k], max);
    if ('temporarilyClosed' in b) db.settings.temporarilyClosed = bool(b.temporarilyClosed);
    await saveDb();
    return send(res, 200, db.settings);
  }

  if (p === '/api/admin/categories' && m === 'PUT') {
    const b = await readBody(req);
    if (!Array.isArray(b.categories)) return send(res, 400, { error: 'categories[] required' });
    db.categories = b.categories.slice(0, 8).map((c) => ({
      id: str(c.id, 40) || uid(), name: str(c.name, 40) || 'Category', image: imgPath(c.image),
    }));
    await saveDb();
    return send(res, 200, db.categories);
  }

  if (p === '/api/admin/menu' && m === 'POST') {
    const item = cleanMenuItem(await readBody(req));
    db.menu.push(item);
    await saveDb();
    return send(res, 201, item);
  }
  let mm = p.match(/^\/api\/admin\/menu\/([\w-]+)$/);
  if (mm) {
    const idx = db.menu.findIndex((x) => x.id === mm[1]);
    if (idx < 0) return send(res, 404, { error: 'Item not found' });
    if (m === 'PUT') {
      const b = await readBody(req);
      db.menu[idx] = cleanMenuItem({ ...db.menu[idx], ...b }, db.menu[idx]);
      await saveDb();
      return send(res, 200, db.menu[idx]);
    }
    if (m === 'DELETE') {
      db.menu.splice(idx, 1);
      await saveDb();
      return send(res, 200, { ok: true });
    }
  }

  if (p === '/api/admin/reviews' && m === 'POST') {
    const b = await readBody(req);
    const r = cleanReview({ ...b, status: b.status || 'approved' });
    db.reviews.push(r);
    await saveDb();
    return send(res, 201, r);
  }
  mm = p.match(/^\/api\/admin\/reviews\/([\w-]+)$/);
  if (mm) {
    const idx = db.reviews.findIndex((x) => x.id === mm[1]);
    if (idx < 0) return send(res, 404, { error: 'Review not found' });
    if (m === 'PUT') {
      const b = await readBody(req);
      db.reviews[idx] = cleanReview({ ...db.reviews[idx], ...b }, db.reviews[idx]);
      await saveDb();
      return send(res, 200, db.reviews[idx]);
    }
    if (m === 'DELETE') {
      db.reviews.splice(idx, 1);
      await saveDb();
      return send(res, 200, { ok: true });
    }
  }

  if (p === '/api/admin/upload' && m === 'POST') {
    const b = await readBody(req);
    const match = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(b.dataUrl || '');
    if (!match) return send(res, 400, { error: 'Upload a PNG, JPG, WEBP or GIF image' });
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const name = `${Date.now()}-${uid()}.${ext}`;
    await fsp.writeFile(path.join(UPLOAD_DIR, name), Buffer.from(match[2], 'base64'));
    return send(res, 201, { url: `/uploads/${name}` });
  }

  return send(res, 404, { error: 'Not found' });
}

/* ---------------------------------------------------------------- static */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/admin') { res.writeHead(301, { Location: '/admin/' }); return res.end(); }
  if (rel.endsWith('/')) rel += 'index.html';
  const isUpload = rel.startsWith('/uploads/');
  const base = isUpload ? UPLOAD_DIR : PUBLIC_DIR;
  const file = path.normalize(path.join(base, isUpload ? rel.slice('/uploads'.length) : rel));
  if (!file.startsWith(base + path.sep)) return send(res, 403, 'Forbidden');
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) throw new Error('not file');
    const ext = path.extname(file).toLowerCase();
    const isAsset = /\/(assets|uploads)\//.test(rel);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': isAsset ? 'public, max-age=604800' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch {
    send(res, 404, 'Not found');
  }
}

/* ---------------------------------------------------------------- server */

loadDb();

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return await serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
  }
}).listen(PORT, () => {
  console.log(`Vishim Snack Studio running at http://localhost:${PORT}`);
  console.log(`Admin panel:                  http://localhost:${PORT}/admin/`);
  if (!LOGIN_REQUIRED) console.log('Admin login is OFF: anyone can open /admin/. Set REQUIRE_LOGIN=1 to require a password.');
  else if (!db.admin.passwordHash) console.log('No admin password yet — open the admin panel to create one.');
});
