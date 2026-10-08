/* Detetive — interface e ligação com a rede.
   O anfitrião roda o motor (engine.js) e manda a cada jogador a sua própria visão do jogo;
   os convidados só mandam ações ({a:'roll'}, {a:'move',r,c}…) e desenham o que recebem.   */
(function () {
  'use strict';

  var L = window.Ludoteca, D = L.Detetive, util = L.util, Net = L.Net, esc = util.esc;
  var root = document.getElementById('app');
  var GAME = 'detetive';
  var debug = !!util.param('debug');           // ?debug=1 permite começar sozinho (para testes)

  var cfg = { dice: 2, noRepeat: true };
  var S = null;                                 // sessão de rede
  var V = null;                                 // última visão recebida do anfitrião
  var engine = null;                            // só no anfitrião
  var myId = null;
  var ui = { sheet: null, pick: {}, confirm: false, rollId: null, turnKey: null, needDisprove: false,
             waitKey: '', waitSince: 0, notes: {}, tokens: {} };

  var ROOM_COLORS = [
    ['#1e0c04', '#b05520', '#d4834a'], ['#13072a', '#7b30b0', '#b87ad8'], ['#04201c', '#14917a', '#5ec9b6'],
    ['#061808', '#1e7a3a', '#6ac87a'], ['#1a1408', '#a07010', '#c8a030'], ['#06091c', '#245a9a', '#5090d0'],
    ['#141416', '#505060', '#a0a0a8'], ['#1c0606', '#902020', '#d04040'], ['#081a06', '#1a6a1a', '#70c460'],
  ];
  var PHASE = {
    roll: '🎲 Rolar os dados', move: '🚶 Mover', action: '💬 Ação', after: '➡ Fim de turno',
    disprove: '🃏 Refutação', post_suggest: '🔍 Resultado', game_over: '🏁 Fim de jogo',
  };

  var $ = function (id) { return document.getElementById(id); };
  var icon = function (c) { return D.ICONS[c] || ''; };

  // Gancho só para testes automatizados (?debug=1): não altera o jogo.
  if (debug) window.__det = { get V() { return V; }, get E() { return engine; }, act: function (a, x) { act(a, x); } };

  /* ════════════════════════════ sala ════════════════════════════ */
  L.Lobby({
    root: root, game: GAME, title: 'Detetive', emoji: '🔍', tagline: 'Quem, com o quê, onde?', accent: '#ff5c6c',
    min: debug ? 1 : 3, max: 6, startLabel: 'Começar o jogo',
    settings: lobbySettings,
    startData: function () { return { dice: cfg.dice, noRepeat: cfg.noRepeat }; },
    onStart: begin,
  });

  function lobbySettings(session, el) {
    function seg(key, val, label) {
      var on = String(cfg[key]) === String(val);
      return '<button class="btn ' + (on ? 'btn-primary' : 'btn-ghost') + ' grow" data-set="' + key + '" data-v="' + val + '">' + label + '</button>';
    }
    function draw() {
      el.innerHTML =
        '<div class="stack">' +
          '<div class="field"><label>Dados de movimento</label><div class="row">' + seg('dice', 2, '2 dados') + seg('dice', 1, '1 dado') + '</div>' +
          '<p class="small muted" style="margin-top:6px">Com 2 dados quase qualquer aposento fica ao alcance. Com 1 dado, andar pela mansão passa a importar.</p></div>' +
          '<div class="field"><label>Sugerir de novo no mesmo aposento</label><div class="row">' + seg('noRepeat', true, 'Só depois de sair') + seg('noRepeat', false, 'Liberado') + '</div></div>' +
        '</div>';
    }
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-set]');
      if (!b) return;
      var k = b.getAttribute('data-set'), v = b.getAttribute('data-v');
      cfg[k] = k === 'dice' ? parseInt(v, 10) : v === 'true';
      draw();
    });
    draw();
  }

  /* ════════════════════════════ partida ════════════════════════════ */
  function begin(session, data) {
    S = session; myId = S.me.id;
    cfg = Object.assign({}, cfg, data || {});
    ui.notes = util.store.get('notas:' + S.code + ':' + myId, {}) || {};
    root.classList.add('wide');
    root.innerHTML = skeleton();
    buildBoard();
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

    S.on('message', onMessage);
    S.on('status', onStatus);
    S.on('players', render);

    if (S.isHost) {
      engine = D.createEngine({
        players: S.players.map(function (p) { return { id: p.id, name: p.name, color: p.color }; }),
        dice: cfg.dice, noRepeat: cfg.noRepeat,
      });
      S.host.on('message', onHostMessage);
      S.host.on('rejoin', function (p) { sendView(p.id); });
      setInterval(function () { if (V) renderActions(); }, 5000);   // libera o "pular" depois de 1 min de espera
      broadcast();
    } else {
      S.send({ a: 'sync' });
    }
  }

  function skeleton() {
    return '<div class="det">' +
      '<div id="d-banner"></div>' +
      '<div class="d-top" id="d-top"></div>' +
      '<div class="d-players" id="d-players"></div>' +
      '<div class="det-cols">' +
        '<div class="det-main"><div class="d-board" id="d-board"><div class="d-grid" id="d-grid"></div><div class="d-tokens" id="d-tokens"></div></div></div>' +
        '<div class="det-side">' +
          '<div class="d-msg" id="d-msg" role="status" aria-live="polite"></div>' +
          '<div class="d-actions" id="d-actions"></div>' +
          '<div><div class="d-h">Minhas cartas</div><div class="d-hand" id="d-hand"></div></div>' +
          '<div><div class="d-h">Acontecimentos</div><div class="d-log" id="d-log"></div></div>' +
        '</div>' +
      '</div>' +
      '<nav class="d-nav" aria-label="Menu do jogo">' +
        '<button data-d="open" data-s="notebook"><span>📒</span>Caderneta</button>' +
        '<button data-d="open" data-s="history"><span>📜</span>Histórico <i class="n" id="n-hist"></i></button>' +
        '<button data-d="open" data-s="players"><span>👥</span>Jogadores</button>' +
        '<button data-d="open" data-s="help"><span>❓</span>Regras</button>' +
      '</nav>' +
    '</div><div id="d-sheet"></div>';
  }

  /* ── rede: anfitrião ── */
  function sendView(id) { S.host.send(id, { t: 'state', s: engine.view(id) }); }
  function broadcast() { S.host.players().forEach(function (p) { sendView(p.id); }); }

  function onHostMessage(p, d) {
    if (!engine || !d || typeof d.a !== 'string') return;
    if (d.a === 'sync') { sendView(p.id); return; }
    var r;
    if (d.a === 'skipwait') {
      if (!p.isHost) return;
      r = engine.hostSkip();
    } else {
      r = engine.apply(p.id, d);
    }
    if (r.error) { S.host.send(p.id, { t: 'err', msg: r.error }); return; }
    broadcast();
  }

  /* ── rede: todos ── */
  function onMessage(d) {
    if (!d) return;
    if (d.t === 'state') { V = d.s; render(); }
    else if (d.t === 'err') util.toast(d.msg, 'err');
  }

  function onStatus(st, reason) {
    var b = $('d-banner');
    if (st === 'reconnecting' && b) b.innerHTML = '<div class="banner">Conexão perdida. Reconectando…</div>';
    else if (st === 'online') { if (b) b.innerHTML = ''; if (!S.isHost) S.send({ a: 'sync' }); }
    else if (st === 'closed' && reason !== 'left') {
      util.toast(Net.ERR_TEXT[reason] || 'A sala foi encerrada.', 'err');
      Net.forget(GAME);
      setTimeout(function () { location.reload(); }, 1800);
    }
  }

  function act(a, extra) {
    if (!S.send(Object.assign({ a: a }, extra || {}))) util.toast('Sem conexão agora. Tentando reconectar…', 'err');
  }

  /* ════════════════════════════ ajudantes de leitura ════════════════════════════ */
  function P(id) { return V.players.filter(function (p) { return p.id === id; })[0]; }
  function online(id) {
    var p = S.players.filter(function (x) { return x.id === id; })[0];
    return !p || p.connected !== false;
  }
  function nm(id) { var p = P(id); return p ? esc(p.name) : '?'; }
  function myPos() { return P(myId).pos; }
  function roomName(pos) { var i = D.roomAt(pos[0], pos[1]); return i >= 0 ? D.ROOMS[i] : null; }
  function diceSum() { return (V.dice || []).reduce(function (a, b) { return a + b; }, 0); }
  function waitingId() { return V.phase === 'disprove' ? V.waitingFor : V.phase === 'game_over' ? null : V.current; }
  function catClass(c) { return { suspect: 's', weapon: 'w', room: 'r' }[D.categoryOf(c)]; }
  function cardChip(c) { return '<span class="chip-card ' + catClass(c) + '">' + icon(c) + ' ' + esc(c) + '</span>'; }

  function analysis() {
    return D.analyze({
      players: V.players.map(function (p) { return { id: p.id, cardCount: p.cardCount }; }),
      me: myId, myCards: V.me.cards, history: V.history, shown: V.me.shown,
    });
  }

  /* ════════════════════════════ desenho ════════════════════════════ */
  function render() {
    if (!V) return;
    renderTop(); renderPlayers(); syncBoard(); renderMsg(); renderActions(); renderHand(); renderLog();
    $('n-hist').textContent = V.history.length ? '(' + V.history.length + ')' : '';
    renderSheet();
    effects();
  }

  function dieSvg(n) {
    var dots = { 1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]],
      5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]], 6: [[28, 28], [72, 28], [28, 50], [72, 50], [28, 72], [72, 72]] }[n] || [];
    return '<svg viewBox="0 0 100 100" aria-label="dado ' + n + '"><rect x="4" y="4" width="92" height="92" rx="22" fill="#1e2030" stroke="#c9a84c" stroke-width="5"/>' +
      dots.map(function (d) { return '<circle cx="' + d[0] + '" cy="' + d[1] + '" r="9" fill="#f5c842"/>'; }).join('') + '</svg>';
  }

  function renderTop() {
    var cur = P(V.current), mine = V.current === myId;
    var rolling = V.dice && ui.rollId !== null && V.rollId !== ui.rollId;
    ui.rollId = V.rollId;
    var dice = V.dice ? V.dice.map(dieSvg).join('') : '';
    $('d-top').innerHTML =
      '<div class="d-turn"><span class="dot" style="background:' + esc(cur.color) + '"></span><div><b>' +
        (V.phase === 'game_over' ? 'Fim de jogo' : mine ? 'Sua vez' : 'Vez de ' + esc(cur.name)) +
        '</b><small>' + PHASE[V.phase] + '</small></div></div>' +
      '<div class="d-dice' + (rolling ? ' roll' : '') + '" aria-live="polite">' + dice + '</div>';
  }

  function renderPlayers() {
    $('d-players').innerHTML = V.players.map(function (p) {
      var cls = 'd-chip' + (p.id === V.current && V.phase !== 'game_over' ? ' cur' : '') + (p.eliminated ? ' out' : '') + (online(p.id) ? '' : ' off');
      return '<div class="' + cls + '"><span class="dot" style="background:' + esc(p.color) + '"></span>' + esc(p.name) +
        (p.id === myId ? ' <small>você</small>' : '') + (online(p.id) ? '' : ' 📴') + ' <small>🃏' + p.cardCount + '</small></div>';
    }).join('');
  }

  /* ── tabuleiro ── */
  function buildBoard() {
    var h = '';
    for (var r = 0; r < 5; r++) for (var c = 0; c < 5; c++) {
      var ri = D.roomAt(r, c);
      if (ri >= 0) {
        var col = ROOM_COLORS[ri];
        h += '<div class="d-cell room" data-r="' + r + '" data-c="' + c + '" style="--rbg:' + col[0] + ';--rbd:' + col[1] + ';--rtx:' + col[2] + '">' +
          '<div class="in"><span class="ico">' + icon(D.ROOMS[ri]) + '</span><span class="nm">' + esc(D.ROOM_SHORT[ri]) + '</span>' +
          (D.SECRET[ri] !== undefined ? '<span class="key" title="passagem secreta">🔑</span>' : '') + '</div></div>';
      } else {
        h += '<div class="d-cell cor" data-r="' + r + '" data-c="' + c + '"><div class="in"></div></div>';
      }
    }
    $('d-grid').innerHTML = h;
  }

  function pawnSvg(color, letter) {
    return '<svg viewBox="0 0 26 34" aria-hidden="true"><ellipse cx="13" cy="31.5" rx="8" ry="2.2" fill="rgba(0,0,0,.5)"/>' +
      '<path d="M7,14 C6,20 5,26 4.5,30 L21.5,30 C21,26 20,20 19,14 C17,11.5 14.5,11 13,11 C11.5,11 9,11.5 7,14Z" fill="' + esc(color) + '" stroke="rgba(0,0,0,.4)" stroke-width=".9"/>' +
      '<circle cx="13" cy="7.5" r="6" fill="' + esc(color) + '" stroke="rgba(0,0,0,.4)" stroke-width=".9"/>' +
      '<circle cx="10.6" cy="5.2" r="2" fill="rgba(255,255,255,.35)"/>' +
      '<text x="13" y="10.6" text-anchor="middle" font-size="7.5" font-weight="900" fill="#fff" font-family="Arial,sans-serif">' + esc(letter) + '</text></svg>';
  }

  function syncBoard() {
    var reach = {};
    V.reachable.forEach(function (x) { reach[x[0] + ',' + x[1]] = true; });
    var cells = $('d-grid').children;
    for (var i = 0; i < cells.length; i++) {
      var el = cells[i], on = !!reach[el.getAttribute('data-r') + ',' + el.getAttribute('data-c')];
      el.classList.toggle('reach', on);
      if (on) { el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0'); el.setAttribute('aria-label', 'Andar para esta casa'); }
      else { el.removeAttribute('role'); el.removeAttribute('tabindex'); el.removeAttribute('aria-label'); }
    }
    var layer = $('d-tokens'), groups = {};
    V.players.forEach(function (p) { var k = p.pos.join(','); (groups[k] = groups[k] || []).push(p.id); });
    V.players.forEach(function (p) {
      var el = ui.tokens[p.id];
      if (!el) {
        el = ui.tokens[p.id] = document.createElement('div');
        el.className = 'pawn';
        el.innerHTML = pawnSvg(p.color, (p.name || '?').charAt(0).toUpperCase());
        layer.appendChild(el);
      }
      var g = groups[p.pos.join(',')], n = g.length, i = g.indexOf(p.id);
      el.style.setProperty('--x', p.pos[1]);
      el.style.setProperty('--y', p.pos[0]);
      var inRoom = D.roomAt(p.pos[0], p.pos[1]) >= 0;      // em aposento: menor e mais baixo, para não cobrir o nome
      el.style.setProperty('--dx', ((i - (n - 1) / 2) * (n <= 2 ? 15 : 11)) + 'px');
      el.style.setProperty('--dy', ((i % 2) * 4 + (inRoom ? 9 : 0)) + 'px');
      el.style.setProperty('--k', (n === 1 ? 1 : n <= 3 ? 0.8 : 0.66) * (inRoom ? 0.82 : 1));
      el.classList.toggle('cur', p.id === V.current && V.phase !== 'game_over');
      el.classList.toggle('out', p.eliminated);
      el.classList.toggle('mine', p.id === myId);
      el.title = p.name;
    });
  }

  /* ── mensagem de apoio ── */
  function renderMsg() {
    var el = $('d-msg'), cur = P(V.current), mine = V.current === myId, t = '';
    var offTag = function (id) { return online(id) ? '' : ' (offline)'; };
    switch (V.phase) {
      case 'roll': t = mine ? '🎲 Role os dados para começar o seu turno.' : '⏳ Aguardando ' + esc(cur.name) + ' rolar' + offTag(cur.id); break;
      case 'move': t = mine ? '🚶 Você tirou ' + diceSum() + '. Toque numa casa verde para andar.' : '🚶 ' + esc(cur.name) + ' está andando…'; break;
      case 'action':
        t = mine ? (roomName(cur.pos) ? '💬 Aposento: ' + esc(roomName(cur.pos)) + '. Sugira, acuse ou encerre o turno.' : '➡ No corredor: acuse ou encerre o turno.')
                 : '⏳ ' + esc(cur.name) + ' está decidindo…' + offTag(cur.id);
        break;
      case 'after': t = mine ? '✅ Sugestão feita. Acuse ou encerre o turno.' : '⏳ ' + esc(cur.name) + ' está finalizando o turno…' + offTag(cur.id); break;
      case 'disprove':
        t = V.waitingFor === myId ? '🃏 Sua vez de refutar: mostre uma carta.' : '🃏 ' + nm(V.waitingFor) + ' está escolhendo uma carta' + offTag(V.waitingFor) + '…';
        break;
      case 'post_suggest': t = V.suggestion.by === myId ? '🔍 Veja o resultado da sua sugestão.' : '⏳ ' + nm(V.suggestion.by) + ' está vendo o resultado…'; break;
      case 'game_over': t = '🏁 Fim de jogo'; break;
    }
    el.className = 'd-msg' + (mine || V.waitingFor === myId ? ' mine' : '');
    el.innerHTML = t;
  }

  /* ── ações ── */
  function bt(cls, d, label, extra) { return '<button class="btn ' + cls + ' block" data-d="' + d + '"' + (extra || '') + '>' + label + '</button>'; }

  function renderActions() {
    var el = $('d-actions'), h = '', mine = V.current === myId, me = P(myId);
    if (V.phase === 'game_over') { el.innerHTML = overPanel(); return; }

    if (V.phase === 'disprove' && V.waitingFor === myId) {
      h += '<div class="d-choice"><b>Mostre uma carta a ' + nm(V.suggestion.by) + ':</b>' +
        V.options.map(function (c) {
          return '<button class="d-card" data-d="disprove" data-v="' + esc(c) + '"><span class="i">' + icon(c) + '</span>' + esc(c) + '</button>';
        }).join('') + '</div>';
    } else if (V.phase === 'post_suggest' && V.suggestion && V.suggestion.by === myId) {
      var sg = V.suggestion;
      h += '<div class="d-result">' +
        (V.shown ? nm(V.shown.by) + ' mostrou:<span class="big">' + icon(V.shown.card) + '</span><b>' + esc(V.shown.card) + '</b>'
                 : '<span class="big">🤷</span><b>Ninguém conseguiu refutar!</b><br><small class="muted">Nenhuma das 3 cartas está com os outros jogadores.</small>') +
        '<div class="small muted" style="margin-top:8px">' + icon(sg.suspect) + ' ' + esc(sg.suspect) + ' · ' + icon(sg.weapon) + ' ' + esc(sg.weapon) + ' · ' + icon(sg.room) + ' ' + esc(sg.room) + '</div></div>' +
        bt('btn-gold', 'endsug', 'Entendi');
    } else if (mine && !me.eliminated) {
      var accuse = '<button class="btn btn-soft" data-d="open" data-s="accuse">🚨 Acusar</button>';
      var secret = V.canSecret ? '<button class="btn btn-soft" data-d="secret">🔑 Passagem secreta</button>' : '';
      if (V.phase === 'roll') {
        h += bt('btn-gold', 'roll', '🎲 Rolar os dados') + '<div class="row2">' + secret + accuse + '</div>';
      } else if (V.phase === 'move') {
        h += '<div class="row2"><button class="btn btn-soft" data-d="skip">↩ Ficar aqui</button>' + secret + '</div>' + accuse.replace('class="btn btn-soft"', 'class="btn btn-soft block"');
      } else if (V.phase === 'action') {
        var inRoom = !!roomName(myPos());
        h += (V.canSuggest ? bt('btn-gold', 'open', '💬 Sugerir', ' data-s="suggest"')
                           : '<button class="btn block" disabled>' + (inRoom ? '💬 Sugerir (já sugeriu aqui — saia e volte)' : '💬 Sugerir (entre num aposento)') + '</button>') +
          '<div class="row2">' + accuse + '<button class="btn btn-soft" data-d="end">➡ Encerrar turno</button></div>';
      } else if (V.phase === 'after') {
        h += '<div class="row2">' + accuse + '<button class="btn btn-gold" data-d="end">➡ Encerrar turno</button></div>';
      }
    } else if (me.eliminated) {
      h += '<p class="muted center small">Você foi eliminado(a), mas continua refutando as sugestões dos outros com as suas cartas.</p>';
    }

    // anfitrião destrava a mesa se quem deveria agir sumiu
    if (S.isHost) {
      var w = waitingId();
      var key = V.phase + '|' + V.current + '|' + V.waitingFor + '|' + V.turn;
      if (key !== ui.waitKey) { ui.waitKey = key; ui.waitSince = Date.now(); }
      if (w && w !== myId && (!online(w) || Date.now() - ui.waitSince > 60000)) {
        h += '<button class="btn btn-ghost block" data-d="skipwait">⏭ Pular ' + nm(w) + (online(w) ? ' (demorando)' : ' (offline)') + '</button>';
      }
    }
    el.innerHTML = h;
  }

  function overPanel() {
    var w = V.winner ? P(V.winner) : null, env = V.envelope;
    var title = !w ? '😔 Ninguém resolveu o mistério' : w.id === myId ? '🏆 Você resolveu o mistério!' : '🏆 ' + esc(w.name) + ' venceu!';
    var sub = V.winReason === 'last' ? 'Foi o(a) último(a) investigador(a) em pé.' : V.winReason === 'solved' ? 'Acusação certeira.' : '';
    var row = function (c, label) { return '<div class="env-row"><span class="i">' + icon(c) + '</span><div><small>' + label + '</small><b>' + esc(c) + '</b></div></div>'; };
    return '<div class="d-over"><h2>' + title + '</h2><p class="muted small">' + sub + '</p>' +
      '<div style="margin:10px 0"><div class="small muted" style="margin-bottom:4px">O envelope secreto continha:</div>' +
      row(env.suspect, 'Culpado') + row(env.weapon, 'Arma') + row(env.room, 'Local') + '</div>' +
      '<button class="btn btn-gold block" data-d="again">Nova partida</button>' +
      '<a class="btn btn-ghost block" style="margin-top:8px" href="../../index.html">Voltar ao menu</a></div>';
  }

  function renderHand() {
    $('d-hand').innerHTML = V.me.cards.map(cardChip).join('') || '<span class="muted small">Sem cartas</span>';
  }

  function renderLog() {
    $('d-log').innerHTML = V.log.slice().reverse().slice(0, 6).map(function (e) { return '<div>' + esc(e.text) + '</div>'; }).join('') ||
      '<div>Nada aconteceu ainda.</div>';
  }

  /* ── vibração e aviso quando é com você ── */
  function effects() {
    var key = V.current + ':' + V.turn;
    if (V.phase !== 'game_over' && V.current === myId && ui.turnKey !== key) { util.vibrate([80, 40, 80]); util.toast('É a sua vez!', 'ok'); }
    ui.turnKey = key;
    var need = V.phase === 'disprove' && V.waitingFor === myId;
    if (need && !ui.needDisprove) { util.vibrate(120); util.toast('Você precisa mostrar uma carta.', 'ok'); }
    ui.needDisprove = need;
  }

  /* ════════════════════════════ folhas ════════════════════════════ */
  function closeSheet() { ui.sheet = null; ui.pick = {}; ui.confirm = false; renderSheet(); }

  function grid(key, list) {
    return '<div class="opt-grid">' + list.map(function (v) {
      return '<button class="opt' + (ui.pick[key] === v ? ' sel' : '') + '" data-d="pick" data-k="' + key + '" data-v="' + esc(v) + '">' + icon(v) + ' ' + esc(v) + '</button>';
    }).join('') + '</div>';
  }

  function renderSheet() {
    var host = $('d-sheet');
    if (!host) return;
    if (ui.sheet === 'suggest' && !(V && V.canSuggest)) ui.sheet = null;
    if (ui.sheet === 'accuse' && !(V && V.current === myId && ['roll', 'move', 'action', 'after'].indexOf(V.phase) >= 0 && !P(myId).eliminated)) ui.sheet = null;
    if (!ui.sheet || !V) { host.innerHTML = ''; host.removeAttribute('data-open'); return; }

    var titles = { notebook: '📒 Caderneta', history: '📜 Histórico', players: '👥 Jogadores', help: '❓ Como jogar', suggest: '💬 Fazer uma sugestão', accuse: '🚨 Acusação final' };
    var body = { notebook: sheetNotebook, history: sheetHistory, players: sheetPlayers, help: sheetHelp, suggest: sheetSuggest, accuse: sheetAccuse }[ui.sheet]();
    var prev = host.querySelector('.sheet-body');
    var scroll = prev ? prev.scrollTop : 0;
    var fresh = host.getAttribute('data-open') !== ui.sheet;
    host.setAttribute('data-open', ui.sheet);
    host.innerHTML = '<div class="sheet-back" data-d="close"></div><div class="sheet' + (fresh ? ' enter' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(titles[ui.sheet]) + '">' +
      '<div class="sheet-head"><h2>' + titles[ui.sheet] + '</h2><button class="icon-btn" data-d="close" aria-label="Fechar">✕</button></div>' +
      '<div class="sheet-body">' + body + '</div></div>';
    if (!fresh) host.querySelector('.sheet-body').scrollTop = scroll;
  }

  function sheetSuggest() {
    var room = roomName(myPos()), ok = ui.pick.suspect && ui.pick.weapon;
    return '<p class="muted">Aposento atual: <b>' + icon(room) + ' ' + esc(room) + '</b>. Cada jogador, na ordem, mostra uma carta se tiver alguma das três.</p>' +
      '<div><h3>Suspeito</h3>' + grid('suspect', D.SUSPECTS) + '</div>' +
      '<div><h3>Arma</h3>' + grid('weapon', D.WEAPONS) + '</div>' +
      '<button class="btn btn-gold block" data-d="dosuggest"' + (ok ? '' : ' disabled') + '>Sugerir</button>';
  }

  function sheetAccuse() {
    var ok = ui.pick.suspect && ui.pick.weapon && ui.pick.room;
    return '<div class="banner" style="background:#3a1318;border-color:#7a2d36;color:#ffb3ba">Se errar, você é eliminado(a)! Só acuse com certeza.</div>' +
      '<div><h3>Culpado</h3>' + grid('suspect', D.SUSPECTS) + '</div>' +
      '<div><h3>Arma</h3>' + grid('weapon', D.WEAPONS) + '</div>' +
      '<div><h3>Aposento</h3>' + grid('room', D.ROOMS) + '</div>' +
      '<button class="btn btn-red block" data-d="doaccuse"' + (ok ? '' : ' disabled') + '>' + (ui.confirm ? 'Tenho certeza — acusar!' : '🚨 Acusar') + '</button>';
  }

  /* ── caderneta com dedução automática ── */
  var FLAGS = ['', '✗', '★'];

  function sheetNotebook() {
    var an = analysis();
    var cols = V.players;
    var head = '<div class="nb-head" style="--ncol:' + (cols.length + 1) + '"><span></span>' +
      cols.map(function (p) { return '<span title="' + esc(p.name) + '"><i style="background:' + esc(p.color) + '"></i>' + esc(p.name.charAt(0).toUpperCase()) + '</span>'; }).join('') +
      '<span title="Envelope"><i style="background:#ff5c6c"></i>Env</span></div>';

    function section(title, list) {
      return '<div><h3>' + title + '</h3><div class="nb-table">' + head + list.map(function (c) {
        var holder = an.holder[c], poss = an.possible[c];
        var cells = cols.map(function (p) {
          if (holder === p.id) return '<span class="nb-cell ' + (p.id === myId ? 'me' : 'yes') + '">' + (p.id === myId ? '●' : '✓') + '</span>';
          if (poss.indexOf(p.id) >= 0) return '<span class="nb-cell">·</span>';
          return '<span class="nb-cell no">✕</span>';
        }).join('');
        var env = holder === D.ENV ? '<span class="nb-cell env-yes">🔒</span>' : poss.indexOf(D.ENV) >= 0 ? '<span class="nb-cell">?</span>' : '<span class="nb-cell no">✕</span>';
        var out = poss.indexOf(D.ENV) < 0;
        var flag = FLAGS[ui.notes[c] || 0];
        return '<div class="nb-row' + (out ? ' out' : '') + (holder === D.ENV ? ' envsure' : '') + '" style="--ncol:' + (cols.length + 1) + '">' +
          '<button class="nb-name" data-d="nbnote" data-v="' + esc(c) + '"><span>' + icon(c) + '</span><span class="t">' + esc(c) + '</span>' + (flag ? '<span class="flag">' + flag + '</span>' : '') + '</button>' +
          cells + env + '</div>';
      }).join('') + '</div></div>';
    }

    var sum = function (k, label) {
      var e = an.env[k];
      return label + ': ' + (e.solved ? '<b>' + icon(e.solved) + ' ' + esc(e.solved) + '</b>' : '<span class="muted">' + e.candidates.length + ' possíveis</span>');
    };
    return '<div class="nb-sum">' + sum('suspect', 'Culpado') + '<br>' + sum('weapon', 'Arma') + '<br>' + sum('room', 'Local') + '</div>' +
      '<p class="nb-note"><b>●</b> sua carta &nbsp; <b>✓</b> tem a carta &nbsp; <b>·</b> talvez tenha &nbsp; <b>✕</b> não tem &nbsp; <b>🔒</b> está no envelope. Nome riscado = fora do envelope. A dedução usa só o que você pode saber. Toque num nome para marcar ✗ ou ★ por conta própria.</p>' +
      section('🕵️ Suspeitos', D.SUSPECTS) + section('🔪 Armas', D.WEAPONS) + section('🏛️ Aposentos', D.ROOMS) +
      (an.inconsistent ? '<p class="nb-note">⚠️ A dedução encontrou informações contraditórias; confie na sua anotação.</p>' : '');
  }

  function sheetHistory() {
    if (!V.history.length) return '<p class="muted center">Ainda não houve sugestões.</p>';
    return V.history.slice().reverse().map(function (h) {
      if (h.type === 'accuse') {
        return '<div class="h-item acc"><span class="who">#' + h.n + ' 🚨 ' + nm(h.by) + '</span> acusou ' + icon(h.suspect) + ' ' + esc(h.suspect) + ' + ' + icon(h.weapon) + ' ' + esc(h.weapon) + ' + ' + icon(h.room) + ' ' + esc(h.room) + ' e errou.</div>';
      }
      var seen = V.me.shown.filter(function (s) { return s.n === h.n; })[0];
      var reps = h.replies.map(function (r) {
        if (r.r === 'pass') return '<span>' + nm(r.pid) + ' passou</span>';
        return '<span class="show' + (seen ? ' seen' : '') + '">' + nm(r.pid) + ' mostrou ' + (seen ? esc(seen.card) + ' (você viu)' : 'uma carta') + '</span>';
      }).join('');
      if (!h.replies.some(function (r) { return r.r === 'show'; })) reps += '<span>ninguém refutou</span>';
      return '<div class="h-item"><span class="who">#' + h.n + ' ' + nm(h.by) + '</span> sugeriu ' + icon(h.suspect) + ' ' + esc(h.suspect) + ' + ' + icon(h.weapon) + ' ' + esc(h.weapon) + ' + ' + icon(h.room) + ' ' + esc(h.room) +
        '<div class="rep">' + reps + '</div></div>';
    }).join('');
  }

  function sheetPlayers() {
    return '<div class="players">' + V.players.map(function (p) {
      var where = roomName(p.pos);
      var badges = (p.id === myId ? '<span class="badge soft">você</span>' : '') + (p.id === V.current && V.phase !== 'game_over' ? '<span class="badge">vez</span>' : '') +
        (p.eliminated ? '<span class="badge soft">eliminado</span>' : '') + (online(p.id) ? '' : '<span class="badge soft">offline</span>');
      return '<div class="player"><span class="dot" style="background:' + esc(p.color) + '"></span><span class="name">' + esc(p.name) +
        '<br><small class="muted">' + (where ? icon(where) + ' ' + esc(where) : 'no corredor') + ' · 🃏 ' + p.cardCount + '</small></span>' + badges + '</div>';
    }).join('') + '</div>' +
    '<a class="btn btn-ghost block" href="../../index.html">Voltar ao menu (você mantém a sua vaga)</a>';
  }

  function sheetHelp() {
    return '<div class="rules stack">' +
      '<div><h3>🎯 Objetivo</h3><p>Descobrir <b>quem</b> cometeu o crime, com <b>qual arma</b> e em <b>qual aposento</b> — antes dos outros. Essas 3 cartas estão num envelope secreto; as demais foram distribuídas entre os jogadores.</p></div>' +
      '<div><h3>🎲 Seu turno</h3><ul><li>Role os dados (ou use a passagem secreta, se estiver num canto).</li><li>Toque numa casa verde para andar. Entrar num aposento encerra o movimento.</li><li>Num aposento, faça <b>uma sugestão</b> por turno.</li><li>Depois, acuse (se tiver certeza) ou encerre o turno.</li></ul></div>' +
      '<div><h3>💬 Sugestão</h3><p>Você escolhe suspeito e arma; o aposento é o seu. Na ordem, cada jogador que tiver alguma das 3 cartas mostra <b>uma</b> só para você. Quem não tem nada passa sozinho — e todos veem quem passou e quem mostrou. O jogo faz isso automaticamente; só pergunta quando há mais de uma carta para escolher.</p></div>' +
      '<div><h3>🔑 Passagens secretas</h3><p>Ligam os cantos opostos: Cozinha ↔ Varanda e Conservatório ↔ Hall. Valem no lugar de andar.</p></div>' +
      '<div><h3>🚨 Acusação</h3><p>Dá para acusar a qualquer momento da sua vez, citando os 3 itens. Se acertar, vence. Se errar, é eliminado — mas continua mostrando cartas para os outros. O último jogador sobrando vence.</p></div>' +
      '<div><h3>📒 Caderneta</h3><p>Preenche sozinha com tudo o que você pode deduzir (suas cartas, o que lhe mostraram, quem passou, quem mostrou, acusações erradas). Mesmo assim, anote suas suspeitas tocando nos nomes.</p></div>' +
    '</div>';
  }

  /* ════════════════════════════ eventos ════════════════════════════ */
  function onClick(e) {
    var cell = e.target.closest('.d-cell.reach');
    if (cell) { act('move', { r: +cell.getAttribute('data-r'), c: +cell.getAttribute('data-c') }); return; }
    var el = e.target.closest('[data-d]');
    if (!el || !root.contains(el)) return;
    var d = el.getAttribute('data-d');
    switch (d) {
      case 'roll': case 'skip': case 'secret': case 'end': case 'endsug': case 'skipwait': act(d); break;
      case 'open': ui.sheet = el.getAttribute('data-s'); ui.pick = {}; ui.confirm = false; renderSheet(); break;
      case 'close': closeSheet(); break;
      case 'pick': ui.pick[el.getAttribute('data-k')] = el.getAttribute('data-v'); ui.confirm = false; renderSheet(); break;
      case 'dosuggest':
        if (ui.pick.suspect && ui.pick.weapon) { act('suggest', { suspect: ui.pick.suspect, weapon: ui.pick.weapon }); closeSheet(); }
        break;
      case 'doaccuse':
        if (!(ui.pick.suspect && ui.pick.weapon && ui.pick.room)) break;
        if (!ui.confirm) { ui.confirm = true; renderSheet(); break; }
        act('accuse', { suspect: ui.pick.suspect, weapon: ui.pick.weapon, room: ui.pick.room });
        closeSheet();
        break;
      case 'disprove': act('disprove', { card: el.getAttribute('data-v') }); break;
      case 'nbnote': {
        var c = el.getAttribute('data-v');
        ui.notes[c] = ((ui.notes[c] || 0) + 1) % FLAGS.length;
        util.store.set('notas:' + S.code + ':' + myId, ui.notes);
        renderSheet();
        break;
      }
      case 'again': Net.forget(GAME); try { S.leave(); } catch (err) { /* já saiu */ } location.reload(); break;
    }
  }

  function onKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var cell = e.target.closest && e.target.closest('.d-cell.reach');
    if (cell) { e.preventDefault(); cell.click(); }
  }
})();
