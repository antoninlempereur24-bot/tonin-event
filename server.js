// Tonin Event — back-end (Express + Multer)
// Stockage : fichier JSON (data/db.json) + photos sur disque (uploads/)
// Les événements sont privés : on y accède uniquement avec leur code.

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------- Codes d'événement ---------- */
// Sans caractères ambigus (0/O, 1/I/L)
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

function randomCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

// "k7m-2qx", " K7M 2QX " => "K7M2QX"
const normalizeCode = (s) =>
  String(s || '').toUpperCase().split('').filter((c) => CODE_ALPHABET.includes(c)).join('');

/* ---------- Mini base de données JSON ---------- */
let db = { events: [] };
try {
  if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch (err) {
  console.error('Impossible de lire db.json, nouvelle base créée.', err);
}
if (!Array.isArray(db.events)) db.events = [];

function uniqueCode() {
  let code;
  do { code = randomCode(); } while (db.events.some((e) => e.code === code));
  return code;
}

// Migration : les événements créés avant l'arrivée des codes en reçoivent un
let migrated = false;
db.events.forEach((e) => { if (!e.code) { e.code = uniqueCode(); migrated = true; } });

let saveTimer = null;
function saveDb() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(db, null, 2), (err) => {
      if (err) return console.error('Erreur de sauvegarde', err);
      fs.rename(tmp, DB_FILE, (e) => e && console.error(e));
    });
  }, 100);
}
if (migrated) saveDb();

const newId = (n = 6) => crypto.randomBytes(n).toString('hex');
const clean = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
const findByCode = (raw) => {
  const code = normalizeCode(raw);
  return code.length === CODE_LENGTH ? db.events.find((e) => e.code === code) : undefined;
};

/* ---------- Upload des photos ---------- */
const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + newId(8) + ALLOWED[file.mimetype]),
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 10 }, // 15 Mo / photo, 10 photos max
  fileFilter: (req, file, cb) => {
    if (ALLOWED[file.mimetype]) return cb(null, true);
    cb(new Error('Format non supporté (JPG, PNG, WEBP, GIF, HEIC uniquement).'));
  },
});

/* ---------- App ---------- */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') }));

// Fichiers du site : dans public/ (recommandé), ou à défaut à côté de server.js
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

const findSiteFile = (name) =>
  [path.join(PUBLIC_DIR, name), path.join(__dirname, name)].find((p) => fs.existsSync(p));

['index.html', 'style.css', 'script.js'].forEach((name) => {
  const routes = name === 'index.html' ? ['/', '/index.html'] : ['/' + name];
  app.get(routes, (req, res, next) => {
    const file = findSiteFile(name);
    if (file) return res.sendFile(file);
    if (name !== 'index.html') return next();
    res.status(500).type('html').send(`<!doctype html><meta charset="utf-8">
      <body style="font-family:system-ui;max-width:640px;margin:60px auto;padding:0 16px;line-height:1.6">
      <h1>Tonin Event : fichiers du site introuvables</h1>
      <p>Le serveur fonctionne, mais <code>index.html</code> est introuvable. Organise le projet ainsi :</p>
      <pre style="background:#effcfb;padding:16px;border-radius:12px">tonin-event/
├── server.js
├── package.json
└── public/
    ├── index.html
    ├── style.css
    └── script.js</pre>
      <p>Dossier cherché : <code>${PUBLIC_DIR}</code></p></body>`);
  });
});

/* ---------- Limitation des essais de codes (anti-devinette) ---------- */
const hits = new Map(); // ip -> { count, reset }
function limiter(max, windowMs) {
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    let h = hits.get(key);
    if (!h || now > h.reset) { h = { count: 0, reset: now + windowMs }; hits.set(key, h); }
    h.count++;
    if (h.count > max) return res.status(429).json({ error: 'Trop d\'essais. Réessaie dans une minute.' });
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now > v.reset) hits.delete(k); }, 60000).unref();
const codeLimiter = limiter(60, 60 * 1000);

const publicEvent = (e, withPhotos = false) => {
  const base = {
    id: e.id,
    code: e.code,
    name: e.name,
    description: e.description,
    creator: e.creator,
    createdAt: e.createdAt,
    photoCount: e.photos.length,
    cover: e.photos.length ? e.photos[e.photos.length - 1].url : null,
  };
  if (withPhotos) base.photos = [...e.photos].reverse(); // plus récentes en premier
  return base;
};

// "Mes événements" : le navigateur envoie les codes qu'il connaît (pas de liste publique)
app.get('/api/events', codeLimiter, (req, res) => {
  const codes = String(req.query.codes || '').split(',').slice(0, 50);
  const seen = new Set();
  const list = [];
  for (const c of codes) {
    const e = findByCode(c);
    if (e && !seen.has(e.code)) { seen.add(e.code); list.push(publicEvent(e)); }
  }
  res.json(list);
});

// Création d'un événement => génère son code
app.post('/api/events', limiter(30, 60 * 1000), (req, res) => {
  const name = clean(req.body.name, 80);
  const description = clean(req.body.description, 500);
  const creator = clean(req.body.creator, 40);
  if (!name) return res.status(400).json({ error: "Le nom de l'événement est requis." });
  if (!creator) return res.status(400).json({ error: 'Ton prénom est requis.' });

  const event = {
    id: newId(4),
    code: uniqueCode(),
    name,
    description,
    creator,
    createdAt: new Date().toISOString(),
    photos: [],
  };
  db.events.push(event);
  saveDb();
  res.status(201).json(publicEvent(event, true));
});

// Rejoindre / ouvrir un événement avec son code
app.get('/api/events/:code', codeLimiter, (req, res) => {
  const event = findByCode(req.params.code);
  if (!event) return res.status(404).json({ error: 'Code invalide : aucun événement trouvé.' });
  res.json(publicEvent(event, true));
});

// Upload de photos dans un événement (le code fait office de clé d'accès)
app.post('/api/events/:code/photos', codeLimiter, (req, res) => {
  const event = findByCode(req.params.code);
  if (!event) return res.status(404).json({ error: 'Code invalide : aucun événement trouvé.' });

  upload.array('photos', 10)(req, res, (err) => {
    const files = req.files || [];
    const discard = () => files.forEach((f) => fs.unlink(f.path, () => {}));

    if (err) {
      discard();
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Photo trop lourde (15 Mo maximum).'
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? '10 photos maximum à la fois.'
        : err.message;
      return res.status(400).json({ error: msg });
    }

    const author = clean(req.body.author, 40);
    if (!author) { discard(); return res.status(400).json({ error: 'Ton prénom est requis pour poster.' }); }
    if (!files.length) return res.status(400).json({ error: 'Aucune photo reçue.' });

    const added = files.map((f) => ({
      id: newId(5),
      url: '/uploads/' + f.filename,
      author,
      eventId: event.id,
      eventName: event.name,
      createdAt: new Date().toISOString(),
    }));
    event.photos.push(...added);
    saveDb();
    res.status(201).json({ added: added.length, event: publicEvent(event, true) });
  });
});

// Erreurs génériques
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur.' });
});

// 0.0.0.0 => accessible depuis d'autres appareils / en ligne
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Tonin Event est en ligne : http://localhost:${PORT}`);
});
