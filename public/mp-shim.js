// Wyspy Owoców Mocy — łącznik multiplayer dla własnego serwera.
// Udaje ten sam interfejs „room”, którego gra używa w wersji na Claude:
// presence(stan), peers(), onPeers(fn, onErr), join(nazwa), leave().
(function () {
  if (window.claude && typeof window.claude.use === 'function') return; // gra działa w Claude — nic nie podmieniamy
  window.__MP_SERVER = true;
  window.__MP_LINK = location.origin + location.pathname;

  var WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  var ws = null, myId = null, ready = null, rooms = {};

  function connectOnce() {
    return new Promise(function (resolve, reject) {
      var s, opened = false, done = false;
      try { s = new WebSocket(WS_URL); } catch (e) { reject({ code: 'upstream_error' }); return; }
      var timer = setTimeout(function () { if (!opened) { done = true; try { s.close(); } catch (e) { } reject({ code: 'upstream_error' }); } }, 6000);
      s.onmessage = function (ev) {
        var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'hello') { if (done) return; clearTimeout(timer); ws = s; myId = String(m.id); opened = true; resolve(); return; }
        var r = rooms[m.room]; if (!r) return;
        if (m.t === 'joined') { r._peers = {}; (m.list || []).forEach(function (q) { r._peers[q.peer] = q.p; }); r._joined = true; if (r._onJoin) { r._onJoin(); r._onJoin = null; r._onFail = null; } r._fire(); }
        else if (m.t === 'pres') { r._peers[m.peer] = mergeEv(r._peers[m.peer], m.p); r._fire(); }
        else if (m.t === 'gone') { delete r._peers[m.peer]; r._fire(); }
        else if (m.t === 'err') { if (r._onFail) { r._onFail({ code: m.code || 'upstream_error' }); r._onFail = null; r._onJoin = null; } else r._err({ code: m.code || 'upstream_error' }); }
      };
      s.onclose = function () {
        clearTimeout(timer);
        if (!opened) { if (!done) { done = true; reject({ code: 'upstream_error' }); } return; }
        if (ws === s) { ws = null; ready = null; }
        Object.keys(rooms).forEach(function (k) { var r = rooms[k]; if (r._joined) { r._joined = false; r._peers = {}; r._err({ code: 'upstream_error' }); } });
      };
      s.onerror = function () { };
    });
  }
  function connect() {
    if (ready) return ready;
    ready = (function attempt(i) {
      return connectOnce().catch(function (e) {
        if (i >= 4) throw e;
        return new Promise(function (res) { setTimeout(res, 600 * Math.pow(2, i)); }).then(function () { return attempt(i + 1); });
      });
    })(0);
    ready.catch(function () { ready = null; });
    return ready;
  }
  // Zdarzenia (ataki, trafienia) jadą w stanie gracza. Gdy komputer odbiorcy jest wolny i nie zdąży odczytać
  // poprzedniego stanu, dokładamy jego zdarzenia do nowego — gra i tak pomija te, które już widziała (po numerze).
  function mergeEv(old, p) {
    if (!old || !p || !Array.isArray(old.e) || !Array.isArray(p.e)) return p;
    var seen = {}, all = [];
    old.e.concat(p.e).forEach(function (q) { if (Array.isArray(q) && typeof q[0] === 'number' && !seen[q[0]]) { seen[q[0]] = 1; all.push(q); } });
    all.sort(function (a, b) { return a[0] - b[0]; });
    if (all.length > 120) all = all.slice(all.length - 120);
    var out = {}; for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) out[k] = p[k];
    out.e = all; return out;
  }
  function send(o) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(o)); } catch (e) { } } }

  function makeRoom(name) {
    var r = {
      _name: name, _peers: {}, _me: null, _subs: [], _errs: [], _joined: false,
      _fire: function () { var l = r.peers(); r._subs.slice().forEach(function (f) { try { f(l); } catch (e) { } }); },
      _err: function (e) { r._errs.slice().forEach(function (f) { try { f(e); } catch (x) { } }); },
      presence: function (st) {
        r._me = st;
        if (myId) r._peers[myId] = st;
        if (!r._joined) return r._ensure().then(function () { send({ t: 'pres', room: name, p: st }); });
        send({ t: 'pres', room: name, p: st }); return Promise.resolve();
      },
      peers: function () {
        var out = []; for (var id in r._peers) { if (!Object.prototype.hasOwnProperty.call(r._peers, id)) continue;
          out.push({ peer: id, kind: 'user', isMe: id === myId, sameTab: id === myId, presence: r._peers[id] }); }
        return out;
      },
      onPeers: function (fn, onErr) {
        r._subs.push(fn); if (onErr) r._errs.push(onErr); r._ensure().catch(function (e) { if (onErr) onErr(e); });
        return function () { r._subs = r._subs.filter(function (f) { return f !== fn; }); if (onErr) r._errs = r._errs.filter(function (f) { return f !== onErr; }); };
      },
      _ensure: function () {
        if (r._joined) return Promise.resolve();
        if (r._joining) return r._joining;
        r._joining = connect().then(function () {
          return new Promise(function (res, rej) {
            var t = setTimeout(function () { if (r._onJoin) { r._onJoin = null; r._onFail = null; rej({ code: 'upstream_error' }); } }, 8000);
            r._onJoin = function () { clearTimeout(t); res(); }; r._onFail = function (e) { clearTimeout(t); rej(e); };
            send({ t: 'join', room: name, p: r._me });
          });
        }).then(function () { r._joining = null; }, function (e) { r._joining = null; throw e; });
        return r._joining;
      },
      join: function (sub) {
        var nm = String(sub || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'swiat-1';
        var q = rooms[nm] || (rooms[nm] = makeRoom(nm));
        return q._ensure().then(function () { return q; });
      },
      leave: function () { send({ t: 'leave', room: name }); r._joined = false; r._peers = {}; delete rooms[name]; return Promise.resolve(); }
    };
    return r;
  }

  window.__mpDebug = function () { return { id: myId, ws: ws ? ws.readyState : -1, pending: !!ready, rooms: Object.keys(rooms).map(function (k) { var r = rooms[k]; return [k, r._joined, !!r._joining, Object.keys(r._peers).length]; }) }; };
  var lobby = null;
  window.claude = {
    use: function (n) {
      if (n !== 'room') return Promise.resolve(null);
      return connect().then(function () { if (!lobby) lobby = rooms['lobby'] = makeRoom('lobby'); return lobby; }, function () { return null; });
    }
  };
})();
