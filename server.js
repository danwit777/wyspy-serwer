// Wyspy Owoców Mocy 3D — serwer multiplayer
// Serwuje grę (public/index.html) i przekazuje stan graczy między przeglądarkami (WebSocket /ws).
// Uruchomienie: npm install && npm start   (port: zmienna PORT, domyślnie 8080)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const PUB = path.join(__dirname, 'public');
const ROOM_CAP = 8;          // twardy limit osób w jednym pokoju (gra sama wpuszcza 4 do świata, resztę przenosi do kolejnego)
const MAX_CONN = 200;        // limit połączeń na cały serwer
const MAX_MSG = 16 * 1024;   // maks. rozmiar jednej wiadomości (bajty)
const MAX_RATE = 40;         // maks. wiadomości na sekundę od jednego gracza
const ROOM_RE = /^[a-z0-9-]{1,24}$/;

// --- pliki gry: shim wstrzykujemy do index.html przed pierwszym <script>
function loadIndex() {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  const tag = '<script src="/mp-shim.js"></script>';
  const i = html.indexOf('<script');
  return i >= 0 ? html.slice(0, i) + tag + '\n' + html.slice(i) : html + tag;
}
let INDEX = loadIndex();
fs.watchFile(path.join(PUB, 'index.html'), { interval: 2000 }, () => { try { INDEX = loadIndex(); console.log('index.html przeładowany'); } catch (e) { console.error(e); } });

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok ' + clients.size); }
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    return res.end(INDEX);
  }
  const file = path.normalize(path.join(PUB, decodeURIComponent(url)));
  if (!file.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

// --- pokoje: name -> Map(id -> {ws, p})
const rooms = new Map();
const clients = new Map(); // ws -> {id, rooms:Set, n, t}
let nextId = 1;

function sendTo(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(room, obj, except) {
  const r = rooms.get(room); if (!r) return;
  const s = JSON.stringify(obj);
  for (const [id, m] of r) if (id !== except && m.ws.readyState === 1) m.ws.send(s);
}
function leave(c, room) {
  const r = rooms.get(room); if (!r || !r.has(c.id)) return;
  r.delete(c.id); c.rooms.delete(room);
  if (r.size === 0) rooms.delete(room); else broadcast(room, { t: 'gone', room, peer: c.id });
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG });
wss.on('connection', (ws) => {
  if (clients.size >= MAX_CONN) { ws.close(1013, 'pelny'); return; }
  const c = { id: String(nextId++), rooms: new Set(), n: 0, t: Date.now() };
  clients.set(ws, c);
  sendTo(ws, { t: 'hello', id: c.id });
  ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (buf) => {
    const now = Date.now();
    if (now - c.t > 1000) { c.t = now; c.n = 0; }
    if (++c.n > MAX_RATE) return; // za szybko — wiadomość pomijamy
    let m; try { m = JSON.parse(buf.toString()); } catch (e) { return; }
    if (!m || typeof m !== 'object' || typeof m.room !== 'string' || !ROOM_RE.test(m.room)) return;
    const room = m.room;
    if (m.t === 'join') {
      let r = rooms.get(room);
      if (!r) { r = new Map(); rooms.set(room, r); }
      if (!r.has(c.id) && r.size >= ROOM_CAP) { sendTo(ws, { t: 'err', room, code: 'limit_reached' }); return; }
      const p = m.p && typeof m.p === 'object' ? m.p : null;
      r.set(c.id, { ws, p }); c.rooms.add(room);
      sendTo(ws, { t: 'joined', room, list: [...r].map(([peer, q]) => ({ peer, p: q.p })) });
      broadcast(room, { t: 'pres', room, peer: c.id, p }, c.id);
    } else if (m.t === 'pres') {
      const r = rooms.get(room); const me = r && r.get(c.id); if (!me) return;
      me.p = m.p && typeof m.p === 'object' ? m.p : null;
      broadcast(room, { t: 'pres', room, peer: c.id, p: me.p }, c.id);
    } else if (m.t === 'leave') {
      leave(c, room);
    }
  });
  ws.on('close', () => { for (const room of [...c.rooms]) leave(c, room); clients.delete(ws); });
  ws.on('error', () => {});
});

// zrywanie martwych połączeń
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch (e) {} } }, 15000);

server.listen(PORT, () => console.log(`Wyspy Owoców Mocy — serwer działa: http://localhost:${PORT}`));
