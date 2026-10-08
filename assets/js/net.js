/* Camada de rede da Ludoteca (peer-to-peer via WebRTC/PeerJS).

   O navegador de quem cria a sala é o "servidor": ele guarda o estado do jogo e
   fala com cada jogador por uma conexão direta. O PeerJS só ajuda a descobrir o outro
   lado (sinalização); as mensagens do jogo não passam por ele.

   Os jogos só usam esta API — se um dia trocarmos o PeerJS por outro serviço,
   só este arquivo muda.

   ── Uso ───────────────────────────────────────────────────────────────────────
   const s = await Ludoteca.Net.createRoom({ game: 'detetive', name: 'Ana', max: 6 });
   const s = await Ludoteca.Net.joinRoom  ({ game: 'detetive', name: 'Bia', code: 'KQTM' });

   Sessão (igual para anfitrião e convidados — o anfitrião também é jogador):
     s.isHost, s.code, s.game, s.me, s.players, s.status, s.rtt
     s.send(data)            → manda ao anfitrião (que é quem decide as regras). Devolve false se offline.
     s.on('message', fn)     → fn(data) vindo do anfitrião
     s.on('players', fn)     → fn(lista)  [{id,name,color,isHost,connected,rtt,route}]
     s.on('status', fn)      → fn('online'|'reconnecting'|'closed', motivo)
     s.on('start', fn)       → fn(dados) quando o anfitrião inicia a partida
     s.leave()

   Só no anfitrião: s.host
     host.on('join'|'rejoin'|'disconnect'|'leave', fn)   fn(jogador)
     host.on('message', fn)                              fn(jogador, data)
     host.send(id, data) · host.broadcast(data) · host.kick(id) · host.start(dados)
     host.setAcceptNew(bool)

   Mensagens devem ser pequenas (< ~48 KB). Dados grandes (imagens) precisam ser fatiados.   */
(function (global) {
  'use strict';

  var L = global.Ludoteca = global.Ludoteca || {};
  var util = L.util;

  var PROTO = 1;
  var PREFIX = 'ludoteca1-';
  var COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];
  var PING_EVERY = 4000;
  var DEAD_AFTER = 15000;          // sem sinal por tanto tempo → conexão considerada caída
  var LOBBY_GRACE = 20000;         // no lobby, quem some por mais que isso sai da sala
  var RECONNECT_WINDOW = 120000;   // quanto tempo o convidado insiste em voltar
  var DIAL_TIMEOUT = 14000;
  var MAX_MSG = 48 * 1024;

  /* ── utilidades internas ─────────────────────────────────────────────────── */
  function Emitter() { this._h = {}; }
  Emitter.prototype.on = function (e, fn) { (this._h[e] = this._h[e] || []).push(fn); return this; };
  Emitter.prototype.off = function (e, fn) {
    this._h[e] = (this._h[e] || []).filter(function (f) { return f !== fn; }); return this;
  };
  Emitter.prototype.emit = function (e) {
    var args = Array.prototype.slice.call(arguments, 1);
    (this._h[e] || []).slice().forEach(function (fn) {
      try { fn.apply(null, args); } catch (err) { console.error('[net] erro no handler de "' + e + '"', err); }
    });
  };

  function NetError(code, message) {
    var e = new Error(message || code);
    e.code = code;
    return e;
  }

  var ERR_TEXT = {
    'not-found': 'Sala não encontrada. Confira o código.',
    'timeout': 'A conexão demorou demais. Verifique a internet e tente de novo.',
    'full': 'A sala está cheia.',
    'closed': 'Essa partida já começou.',
    'version': 'Versão diferente do app. Recarregue a página.',
    'network': 'Sem conexão com a internet.',
    'broker': 'Não consegui falar com o servidor de conexão. Tente de novo em instantes.',
    'code-taken': 'Não consegui reservar um código de sala. Tente de novo.',
    'kicked': 'Você foi removido da sala.',
    'host-left': 'O anfitrião encerrou a sala.',
    'lost': 'A conexão com a sala foi perdida.',
    'bad': 'Resposta inválida da sala.',
  };

  function mapPeerError(type) {
    if (type === 'peer-unavailable') return 'not-found';
    if (type === 'network') return 'network';
    if (type === 'unavailable-id') return 'code-taken';
    return 'broker';
  }

  /* Servidor de sinalização. Vazio = nuvem pública do PeerJS (grátis, sem conta).
     Para auto-hospedar: Net.broker = { host:'meu-servidor.exemplo', port:443, path:'/', secure:true }
     Para testes locais:  adicione ?broker=localhost:9000 na URL. */
  var Net = L.Net = { PROTO: PROTO, COLORS: COLORS, broker: {}, ERR_TEXT: ERR_TEXT };

  function peerOpts() {
    var o = { debug: 1 };
    var b = Net.broker || {};
    var q = util.param('broker');
    if (q) {
      var parts = q.split(':');
      b = { host: parts[0], port: parseInt(parts[1] || '9000', 10), path: '/', secure: false };
    }
    if (b.host) { o.host = b.host; o.port = b.port; o.path = b.path || '/'; o.secure = !!b.secure; }
    return o;
  }

  function roomId(game, code) { return PREFIX + game + '-' + code; }

  /* Descobre se a conexão é direta, na mesma rede ou passa por servidor de relay (TURN). */
  function routeOf(conn) {
    var pc = conn && conn.peerConnection;
    if (!pc || !pc.getStats) return Promise.resolve(null);
    return pc.getStats().then(function (stats) {
      var byId = {}, pairId = null, nominated = [];
      stats.forEach(function (r) {
        byId[r.id] = r;
        if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId;
        if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') nominated.push(r);
      });
      var pair = pairId ? byId[pairId] : nominated[0];
      if (!pair) return null;
      var l = byId[pair.localCandidateId], r = byId[pair.remoteCandidateId];
      var lt = l && l.candidateType, rt = r && r.candidateType;
      if (lt === 'relay' || rt === 'relay') return 'relay';
      if (lt === 'host' && rt === 'host') return 'lan';
      return 'direct';
    }).catch(function () { return null; });
  }
  Net.routeLabel = function (r) {
    return { lan: 'mesma rede', direct: 'direta', relay: 'via relay' }[r] || '';
  };

  /* Guarda a sala atual para voltar sozinho se a página recarregar. */
  Net.remember = function (game, info) {
    info.t = Date.now();
    util.store.set('sessao:' + game, info);
  };
  Net.recall = function (game) {
    var r = util.store.get('sessao:' + game, null);
    return r && Date.now() - r.t < 12 * 3600 * 1000 ? r : null;
  };
  Net.forget = function (game) { util.store.del('sessao:' + game); };

  function pub(p) {
    return { id: p.id, name: p.name, color: p.color, isHost: p.isHost, connected: p.connected, rtt: p.rtt || 0, route: p.route || null };
  }

  /* ════════════════════════════════════════════════════════════════════════════
     ANFITRIÃO
     ════════════════════════════════════════════════════════════════════════════ */
  Net.createRoom = function (o) {
    o = o || {};
    var game = o.game || 'jogo';
    var forced = !!o.code;
    var code = o.code ? util.cleanCode(o.code) : util.genCode(4);
    var attempts = 0;

    return new Promise(function (resolve, reject) {
      function attempt() {
        attempts++;
        var done = false;
        var peer = new Peer(roomId(game, code), peerOpts());
        var timer = setTimeout(function () { fail(NetError('broker')); }, DIAL_TIMEOUT);

        function fail(err) {
          if (done) return; done = true; clearTimeout(timer);
          try { peer.destroy(); } catch (e) { /* ok */ }
          reject(err);
        }
        peer.on('open', function () {
          if (done) return; done = true; clearTimeout(timer);
          resolve(buildHost(peer, game, code, o));
        });
        peer.on('error', function (err) {
          if (done) return;
          if (err.type === 'unavailable-id' && attempts < (forced ? 12 : 6)) {
            // Código já usado. Ao retomar uma sala própria, o registro antigo some em alguns segundos.
            done = true; clearTimeout(timer);
            try { peer.destroy(); } catch (e) { /* ok */ }
            if (!forced) code = util.genCode(4);
            return setTimeout(attempt, forced ? 2500 : 0);
          }
          fail(NetError(mapPeerError(err.type), err.message));
        });
      }
      attempt();
    });
  };

  function buildHost(peer, game, code, o) {
    var s = new Emitter();       // interface de sessão (igual à dos convidados)
    var host = new Emitter();    // interface exclusiva do anfitrião
    var players = [];
    var byId = {};
    var closed = false, started = false, startData = null, acceptNew = true;
    var max = o.max || 8;
    var colorCursor = 0;

    function uniqueName(name) {
      var base = util.cleanName(name) || 'Jogador', n = base, i = 2;
      while (players.some(function (p) { return p.name.toLowerCase() === n.toLowerCase(); })) n = base + ' ' + i++;
      return n;
    }
    function addPlayer(id, name, conn, isHost) {
      var p = {
        id: id, name: uniqueName(name), color: COLORS[colorCursor++ % COLORS.length], isHost: isHost,
        conn: conn, connected: true, lastSeen: Date.now(), rtt: 0, route: null, dropTimer: null,
      };
      players.push(p); byId[id] = p;
      return p;
    }
    function removePlayer(p) {
      clearTimeout(p.dropTimer);
      players = players.filter(function (x) { return x !== p; });
      delete byId[p.id];
    }
    function snapshot() { return players.map(pub); }
    function raw(p, obj) {
      if (!p.conn || !p.connected) return false;
      try { p.conn.send(obj); return true; } catch (e) { return false; }
    }
    function broadcastPlayers() {
      var list = snapshot();
      s.players = list;
      s.emit('players', list);
      players.forEach(function (p) { if (!p.isHost) raw(p, { k: 'players', list: list }); });
    }
    function later(fn) { setTimeout(fn, 0); }

    var me = addPlayer(o.pid || util.uid(), o.name || 'Anfitrião', null, true);

    /* ── conexões de entrada ── */
    peer.on('connection', function (conn) {
      var bound = null;
      var helloTimer = setTimeout(function () { if (!bound) { try { conn.close(); } catch (e) { /* ok */ } } }, 8000);
      conn.on('data', function (m) {
        if (!m || typeof m !== 'object') return;
        if (!bound) {
          if (m.k === 'hello') { clearTimeout(helloTimer); bound = onHello(conn, m); }
          return;
        }
        onClientMsg(bound, conn, m);
      });
      conn.on('close', function () { clearTimeout(helloTimer); if (bound) dropConn(bound, conn); });
      conn.on('error', function () { if (bound) dropConn(bound, conn); });
    });

    function reject(conn, reason) {
      try { conn.send({ k: 'reject', reason: reason }); } catch (e) { /* ok */ }
      setTimeout(function () { try { conn.close(); } catch (e) { /* ok */ } }, 300);
      return null;
    }

    function onHello(conn, m) {
      if (closed) return reject(conn, 'host-left');
      if (m.v !== PROTO) return reject(conn, 'version');
      var pid = typeof m.pid === 'string' && m.pid.length > 0 && m.pid.length <= 64 ? m.pid : null;
      if (!pid) return reject(conn, 'bad');

      var p = byId[pid];
      if (p && p.isHost) return reject(conn, 'bad');
      if (p) {                                   // quem já estava na sala voltando
        clearTimeout(p.dropTimer);
        var old = p.conn;
        p.conn = conn; p.connected = true; p.lastSeen = Date.now();
        if (old && old !== conn) { try { old.close(); } catch (e) { /* ok */ } }
        host.emit('rejoin', pub(p));
      } else {                                   // jogador novo
        if (!acceptNew || started) return reject(conn, 'closed');
        if (players.length >= max) return reject(conn, 'full');
        p = addPlayer(pid, m.name, conn, false);
        host.emit('join', pub(p));
      }
      raw(p, { k: 'welcome', v: PROTO, game: game, code: code, you: pub(p), players: snapshot(), started: started, startData: startData });
      broadcastPlayers();
      return p;
    }

    function dropConn(p, conn) {
      if (p.conn !== conn) return;               // era uma conexão antiga já substituída
      p.conn = null; p.connected = false;
      host.emit('disconnect', pub(p));
      if (!started) {                            // no lobby ninguém fica "fantasma"
        p.dropTimer = setTimeout(function () {
          if (!p.connected && byId[p.id]) { removePlayer(p); host.emit('leave', pub(p)); broadcastPlayers(); }
        }, LOBBY_GRACE);
      }
      broadcastPlayers();
    }

    function onClientMsg(p, conn, m) {
      if (p.conn !== conn) return;
      p.lastSeen = Date.now();
      if (m.k === 'ping') {
        raw(p, { k: 'pong', t: m.t });
        if (typeof m.rtt === 'number' && m.rtt >= 0) p.rtt = Math.min(m.rtt, 9999) | 0;
      } else if (m.k === 'msg') {
        host.emit('message', pub(p), m.d);
      } else if (m.k === 'bye') {
        p.conn = null; p.connected = false;
        try { conn.close(); } catch (e) { /* ok */ }
        if (!started) { removePlayer(p); host.emit('leave', pub(p)); }
        else host.emit('disconnect', pub(p));
        broadcastPlayers();
      }
    }

    /* ── vigia: derruba quem parou de dar sinal e mede a rota de cada um ── */
    var sweep = setInterval(function () {
      var now = Date.now();
      players.forEach(function (p) {
        if (!p.isHost && p.connected && now - p.lastSeen > DEAD_AFTER) {
          var c = p.conn; try { c.close(); } catch (e) { /* ok */ } dropConn(p, c);
        }
      });
    }, 5000);
    var routeTimer = setInterval(function () {
      var changed = false, pending = 0;
      players.forEach(function (p) {
        if (p.isHost || !p.connected) return;
        pending++;
        routeOf(p.conn).then(function (r) {
          if (r !== p.route) { p.route = r; changed = true; }
          if (--pending === 0 && changed) broadcastPlayers();
        });
      });
    }, 10000);

    /* ── perda de contato com o servidor de sinalização (as conexões abertas continuam) ── */
    var brokerRetry = null;
    peer.on('disconnected', function () {
      if (closed || brokerRetry) return;
      brokerRetry = setInterval(function () {
        if (closed || !peer.disconnected) { clearInterval(brokerRetry); brokerRetry = null; return; }
        try { peer.reconnect(); } catch (e) { /* tenta de novo */ }
      }, 3000);
    });
    peer.on('error', function (err) { console.warn('[net] anfitrião:', err.type, err.message); });

    /* ── interface do anfitrião ── */
    host.players = function () { return snapshot(); };
    host.find = function (id) { return byId[id] ? pub(byId[id]) : null; };
    host.send = function (id, data) {
      var p = byId[id];
      if (!p) return false;
      if (p.isHost) { later(function () { s.emit('message', data); }); return true; }
      return raw(p, { k: 'msg', d: data });
    };
    host.broadcast = function (data) {
      players.forEach(function (p) { host.send(p.id, data); });
    };
    host.kick = function (id) {
      var p = byId[id];
      if (!p || p.isHost) return;
      raw(p, { k: 'kicked' });
      var c = p.conn;
      p.conn = null; p.connected = false;      // o "close" que vem a seguir não deve virar "disconnect"
      removePlayer(p);
      setTimeout(function () { try { c && c.close(); } catch (e) { /* ok */ } }, 300);
      host.emit('leave', pub(p));
      broadcastPlayers();
    };
    host.setAcceptNew = function (b) { acceptNew = !!b; };
    host.start = function (data) {
      started = true; startData = data == null ? null : data; acceptNew = false;
      players.forEach(function (p) { clearTimeout(p.dropTimer); if (!p.isHost) raw(p, { k: 'start', d: startData }); });
      s.started = true; s.startData = startData;
      later(function () { s.emit('start', startData); });
    };

    /* ── interface de sessão (o anfitrião como jogador) ── */
    s.isHost = true; s.game = game; s.code = code; s.status = 'online'; s.rtt = 0; s.started = false;
    s.me = pub(me); s.players = snapshot(); s.host = host; s.startData = null;
    s.send = function (data) {
      if (closed) return false;
      later(function () { host.emit('message', pub(me), data); });
      return true;
    };
    s.leave = function () {
      if (closed) return;
      closed = true;
      clearInterval(sweep); clearInterval(routeTimer); clearInterval(brokerRetry);
      players.forEach(function (p) { if (!p.isHost) raw(p, { k: 'closed', reason: 'host-left' }); });
      setTimeout(function () { try { peer.destroy(); } catch (e) { /* ok */ } }, 400);
      s.status = 'closed';
      s.emit('status', 'closed', 'left');
    };
    s.debugDrop = function () { /* o anfitrião não "cai" de propósito */ };
    return s;
  }

  /* ════════════════════════════════════════════════════════════════════════════
     CONVIDADO
     ════════════════════════════════════════════════════════════════════════════ */
  Net.joinRoom = function (o) {
    o = o || {};
    var game = o.game || 'jogo';
    var code = util.cleanCode(o.code);
    var name = util.cleanName(o.name) || 'Jogador';
    var pid = o.pid || util.uid();

    var s = new Emitter();
    s.isHost = false; s.game = game; s.code = code; s.status = 'connecting'; s.rtt = 0;
    s.me = { id: pid, name: name }; s.players = []; s.started = false; s.startData = null;

    var peer = null, conn = null, closed = false, joined = false;
    var retryTimer = null, backoff = 1000, lostSince = 0;
    var pingTimer = null, lastPong = 0, lastRtt = 0;

    function setStatus(st, info) {
      if (s.status === st) return;
      s.status = st;
      s.emit('status', st, info);
    }

    function cleanup() {
      clearInterval(pingTimer); pingTimer = null;
      if (conn) { var c = conn; conn = null; try { c.close(); } catch (e) { /* ok */ } }
      if (peer) { var p = peer; peer = null; try { p.destroy(); } catch (e) { /* ok */ } }
    }

    return new Promise(function (resolve, reject) {

      function terminal(reason) {
        closed = true; cleanup();
        removeHooks();
        if (!joined) reject(NetError(reason));
        else { s.status = 'closed'; s.emit('status', 'closed', reason); }
      }

      function dialFailed(reason) {
        cleanup();
        if (closed) return;
        if (!joined) return terminal(reason);                       // primeira tentativa: quem chamou decide
        if (!lostSince) lostSince = Date.now();
        if (Date.now() - lostSince > RECONNECT_WINDOW) return terminal('lost');
        setStatus('reconnecting');
        clearTimeout(retryTimer);
        retryTimer = setTimeout(dial, backoff);
        backoff = Math.min(backoff * 2, 8000);
      }

      function dial() {
        if (closed) return;
        clearTimeout(retryTimer);
        cleanup();
        var settled = false;
        var timer = setTimeout(function () { fail('timeout'); }, DIAL_TIMEOUT);
        function fail(reason) {
          if (settled) return; settled = true; clearTimeout(timer);
          dialFailed(reason);
        }

        var myPeer = peer = new Peer(peerOpts());
        myPeer.on('error', function (err) {
          if (peer !== myPeer) return;
          if (!settled) return fail(mapPeerError(err.type));
          console.warn('[net] convidado:', err.type, err.message);
        });
        myPeer.on('open', function () {
          if (peer !== myPeer || closed) return;
          var c = conn = myPeer.connect(roomId(game, code), { reliable: true, serialization: 'json' });
          c.on('open', function () { c.send({ k: 'hello', v: PROTO, pid: pid, name: name }); });
          c.on('data', function (m) {
            if (conn !== c || !m || typeof m !== 'object') return;
            if (!settled) {
              if (m.k === 'welcome') { settled = true; clearTimeout(timer); onWelcome(m); }
              else if (m.k === 'reject') {
                settled = true; clearTimeout(timer);
                // Voltando para uma partida em andamento e sendo recusado = a sala não é mais a mesma.
                terminal(m.reason === 'host-left' ? 'host-left' : m.reason || 'bad');
              }
              return;
            }
            onMsg(m);
          });
          c.on('close', function () { if (conn === c) { if (!settled) fail('not-found'); else onLost(); } });
          c.on('error', function () { if (conn === c) { if (!settled) fail('broker'); else onLost(); } });
        });
      }

      function onWelcome(m) {
        backoff = 1000; lostSince = 0;
        if (m.you) s.me = m.you;
        s.players = m.players || [];
        lastPong = Date.now();
        clearInterval(pingTimer);
        pingTimer = setInterval(pingTick, PING_EVERY);
        var first = !joined;
        joined = true;
        setStatus('online');
        s.emit('players', s.players);
        if (first) resolve(s);
        if (m.started && !s.started) { s.started = true; s.startData = m.startData; s.emit('start', m.startData); }
      }

      function pingTick() {
        if (!conn || !conn.open) return;
        if (Date.now() - lastPong > DEAD_AFTER) return onLost();
        try { conn.send({ k: 'ping', t: Date.now(), rtt: lastRtt }); } catch (e) { /* ok */ }
      }

      function onMsg(m) {
        switch (m.k) {
          case 'msg': s.emit('message', m.d); break;
          case 'players': s.players = m.list || []; s.emit('players', s.players); break;
          case 'start': if (!s.started) { s.started = true; s.startData = m.d; s.emit('start', m.d); } break;
          case 'pong':
            lastPong = Date.now(); lastRtt = Math.max(0, lastPong - m.t); s.rtt = lastRtt; s.emit('rtt', lastRtt); break;
          case 'kicked': terminal('kicked'); break;
          case 'closed': terminal('host-left'); break;
        }
      }

      function onLost() {
        if (closed || s.status === 'reconnecting') return;
        clearInterval(pingTimer); pingTimer = null;
        lostSince = Date.now();
        setStatus('reconnecting');
        cleanup();
        clearTimeout(retryTimer);
        retryTimer = setTimeout(dial, 600);
      }

      /* Voltou para a aba ou a internet: não espera o próximo ciclo para tentar. */
      function nudge() {
        if (closed || s.status !== 'reconnecting') return;
        backoff = 1000; clearTimeout(retryTimer); dial();
      }
      function onVisible() { if (document.visibilityState === 'visible') nudge(); }
      function removeHooks() {
        document.removeEventListener('visibilitychange', onVisible);
        global.removeEventListener('online', nudge);
      }
      document.addEventListener('visibilitychange', onVisible);
      global.addEventListener('online', nudge);

      /* ── interface de sessão ── */
      s.send = function (data) {
        if (!conn || !conn.open || s.status !== 'online') return false;
        try {
          if (JSON.stringify(data).length > MAX_MSG) console.warn('[net] mensagem grande demais (' + MAX_MSG + ' bytes). Fatie os dados.');
          conn.send({ k: 'msg', d: data });
          return true;
        } catch (e) { return false; }
      };
      s.leave = function () {
        if (closed) return;
        closed = true; removeHooks(); clearTimeout(retryTimer);
        try { conn && conn.send({ k: 'bye' }); } catch (e) { /* ok */ }
        setTimeout(cleanup, 300);
        s.status = 'closed';
        s.emit('status', 'closed', 'left');
      };
      /* Só para testes: simula perda de conexão para exercitar a reconexão automática. */
      s.debugDrop = function () { if (conn) { try { conn.close(); } catch (e) { /* ok */ } } };
      s.route = function () { return routeOf(conn); };

      dial();
    });
  };
})(window);
