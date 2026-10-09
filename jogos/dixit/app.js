/* Dixit — interface e rede.
   O anfitrião guarda o baralho e roda o motor (engine.js). A cada mudança manda a cada jogador
   a sua visão do jogo e, só então, as imagens das cartas que ele ainda não tem.                  */
(function () {
  'use strict';

  var L = window.Ludoteca, X = L.Dixit, Deck = L.Deck, util = L.util, Net = L.Net, esc = util.esc;
  var GAME = 'dixit';
  var root = document.getElementById('app');
  var debug = !!util.param('debug');

  /* ── opções da sala (só o anfitrião mexe) ── */
  var cfg = { cpt: 'auto', target: 30 };
  var deck = null, deckMsg = '', deckProg = null;
  var lobby = null;

  /* ── partida ── */
  var S = null, V = null, engine = null, myId = null;
  var hostCards = {}, partsCache = {};            // anfitrião: carta → imagem pronta / pedaços já em base64
  var urls = {}, asm = {};                         // todos: carta → blob URL / imagem sendo montada
  var have = {}, queue = {}, pumping = false;      // anfitrião: o que cada jogador já recebeu / fila de envio
  var ui = { key: '', sel: [], mode: '', waitSince: 0, needKey: '', cache: {}, barKey: '' };

  var $ = function (id) { return document.getElementById(id); };
  function setHtml(id, html) {                     // só mexe no DOM se mudou (evita piscar as imagens)
    var el = $(id);
    if (el && ui.cache[id] !== html) { el.innerHTML = html; ui.cache[id] = html; }
    return el;
  }

  var ZOOM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21M10.5 7.5v6M7.5 10.5h6"/></svg>';

  /* ════════════════════════════ sala ════════════════════════════ */
  function resolveCpt(n) { return cfg.cpt === 'auto' ? X.defaultCpt(n) : cfg.cpt; }
  function connectedCount(session) { return session.players.filter(function (p) { return p.connected; }).length; }

  lobby = L.Lobby({
    root: root, game: GAME, title: 'Dixit', emoji: '🌙', tagline: 'Imaginação e pistas', accent: '#b98cff',
    min: X.MIN_PLAYERS, max: X.MAX_PLAYERS, startLabel: 'Começar o jogo',
    settings: deckSettings,
    startBlock: function (session) {
      var n = connectedCount(session), cpt = resolveCpt(n);
      if (!deck) return 'Carregue o baralho para começar';
      var need = X.minCards(n, cpt);
      return deck.cards.length < need ? 'Faltam cartas: precisa de ' + need + ' (tem ' + deck.cards.length + ')' : null;
    },
    startData: function (session) {
      return { cpt: resolveCpt(connectedCount(session)), target: cfg.target, deckSize: deck.cards.length };
    },
    onStart: begin,
  });

  function deckSettings(session, el) {
    function mb(b) { return (b / 1048576).toFixed(1).replace('.', ','); }
    function seg(key, val, label) {
      var on = String(cfg[key]) === String(val);
      return '<button class="btn ' + (on ? 'btn-primary' : 'btn-ghost') + '" data-dx="set" data-k="' + key + '" data-v="' + val + '">' + label + '</button>';
    }
    function info() {
      if (deckProg) return 'Preparando as cartas… ' + deckProg.i + ' de ' + deckProg.n;
      if (deck) return '<b>' + deck.cards.length + ' cartas</b> prontas (' + mb(Deck.bytes(deck)) + ' MB)' +
        (deck.skipped && deck.skipped.length ? ' · ' + deck.skipped.length + ' arquivo(s) ignorado(s)' : '');
      return esc(deckMsg) || 'Nenhum baralho carregado ainda.';
    }
    function draw() {
      var cpt = resolveCpt(connectedCount(session));
      el.innerHTML =
        '<div class="stack">' +
          '<div class="field"><label>Baralho de cartas</label><div class="deck-box">' +
            '<p class="small" id="dx-info">' + info() + '</p>' +
            (deckProg ? '<progress id="dx-prog" max="' + deckProg.n + '" value="' + deckProg.i + '"></progress>' : '') +
            '<div class="row wrap"><button class="btn btn-primary grow" data-dx="pick"' + (deckProg ? ' disabled' : '') + '>' + (deck ? 'Trocar imagens' : 'Escolher imagens') + '</button>' +
              (deck && !deckProg ? '<button class="btn btn-ghost" data-dx="forget">Esquecer</button>' : '') + '</div>' +
            '<input type="file" id="dx-file" accept="image/*" multiple hidden>' +
            '<p class="small muted">Escolha todas as imagens das cartas de uma vez. Elas ficam só neste aparelho e são enviadas aos outros jogadores durante a partida.</p>' +
          '</div></div>' +
          '<div class="field"><label>Cartas que cada pessoa joga por rodada</label><div class="seg">' + seg('cpt', 'auto', 'Automático') + seg('cpt', 1, '1 carta') + seg('cpt', 2, '2 cartas') + '</div>' +
            '<p class="small muted" style="margin-top:6px">Automático: 2 cartas com 3 jogadores, 1 com 4 ou mais. Neste momento: ' + cpt + '.</p></div>' +
          '<div class="field"><label>Meta de pontos</label><div class="stepper"><button class="btn btn-ghost" data-dx="target" data-v="-5" aria-label="Menos 5">−</button><b>' + cfg.target +
            '</b><button class="btn btn-ghost" data-dx="target" data-v="5" aria-label="Mais 5">+</button></div></div>' +
        '</div>';
    }
    function progress() {
      var t = $('dx-info'), p = $('dx-prog');
      if (t) t.textContent = info();
      if (p && deckProg) { p.max = deckProg.n; p.value = deckProg.i; }
    }
    function useFiles(files) {
      if (!files || !files.length) return;
      deckProg = { i: 0, n: files.length }; deckMsg = ''; draw(); lobby && lobby.refresh();
      Deck.fromFiles(files, function (i, n) { deckProg = { i: i, n: n }; progress(); }).then(function (d) {
        deck = d; deckProg = null; Deck.save(d); draw(); lobby.refresh();
      }, function (e) { deckProg = null; deckMsg = e.message; draw(); lobby.refresh(); });
    }

    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-dx]');
      if (!b) return;
      switch (b.getAttribute('data-dx')) {
        case 'pick': el.querySelector('#dx-file').click(); break;
        case 'forget': deck = null; Deck.clear(); draw(); lobby.refresh(); break;
        case 'set': cfg[b.getAttribute('data-k')] = b.getAttribute('data-v') === 'auto' ? 'auto' : +b.getAttribute('data-v'); draw(); lobby.refresh(); break;
        case 'target': cfg.target = Math.max(10, Math.min(60, cfg.target + (+b.getAttribute('data-v')))); draw(); break;
      }
    });
    el.addEventListener('change', function (e) { if (e.target.id === 'dx-file') { useFiles(e.target.files); e.target.value = ''; } });
    session.on('players', function () { if (!deckProg && $('dx-info')) draw(); });
    draw();

    if (!deck) Deck.load().then(function (d) {                 // baralho guardado em partidas anteriores
      if (d && !deck && $('dx-info')) { deck = d; draw(); lobby.refresh(); }
    });
  }

  /* ════════════════════════════ partida ════════════════════════════ */
  function begin(session, data) {
    S = session; myId = S.me.id;
    root.classList.add('wide');
    root.innerHTML = skeleton();
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKey);
    $('dx-lb').addEventListener('click', closeLb);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLb(); });

    S.on('message', onMessage);
    S.on('status', onStatus);
    S.on('players', function () { if (V) render(); recheck(); });

    if (S.isHost) {
      deck.cards.forEach(function (c) { hostCards[c.id] = c; });
      engine = X.createEngine({
        players: S.players.map(function (p) { return { id: p.id, name: p.name, color: p.color }; }),
        cards: deck.cards.map(function (c) { return c.id; }), cpt: data.cpt, target: data.target,
      });
      S.host.on('message', onHostMessage);
      S.host.on('rejoin', function (p) { resetHave(p.id); sendView(p.id); });
      setInterval(function () { if (V) renderMain(); }, 5000);     // libera o "pular" depois de 1 min de espera
      broadcast();
    } else {
      S.send({ a: 'sync' });
    }
  }

  function skeleton() {
    return '<div class="dx">' +
      '<div id="dx-banner"></div>' +
      '<div class="dx-top"><div class="dx-score" id="dx-score"></div><div class="dx-deck" id="dx-deck"></div></div>' +
      '<div class="dx-clue" id="dx-clue"></div>' +
      '<div id="dx-main" class="stack" style="gap:12px"></div>' +
      '<div class="dx-bar" id="dx-bar"></div>' +
    '</div>';
  }

  /* ── anfitrião ── */
  function connectedIds() { return S.players.filter(function (p) { return p.connected !== false; }).map(function (p) { return p.id; }); }
  function broadcast() { S.host.players().forEach(function (p) { sendView(p.id); }); }
  function recheck() { if (engine && engine.recheck({ connected: connectedIds() })) broadcast(); }

  function sendView(pid) {
    var v = engine.view(pid);
    S.host.send(pid, { t: 'state', s: v });
    if (pid !== myId) queueImages(pid, v.need);
  }
  function resetHave(pid) { have[pid] = {}; queue[pid] = []; }
  function queueImages(pid, ids) {
    have[pid] = have[pid] || {}; queue[pid] = queue[pid] || [];
    ids.forEach(function (c) {
      if (have[pid][c] || !hostCards[c]) return;
      have[pid][c] = true;
      if (!partsCache[c]) partsCache[c] = Deck.parts(hostCards[c]);
      Array.prototype.push.apply(queue[pid], partsCache[c]);
    });
    pump();
  }
  function pump() {                                // manda aos poucos, sem encher o canal do jogador
    var more = false;
    Object.keys(queue).forEach(function (pid) {
      var q = queue[pid];
      while (q.length && S.host.buffered(pid) < 256 * 1024) {
        if (!S.host.send(pid, q.shift())) { resetHave(pid); return; }   // caiu: refaz quando voltar
      }
      if (q.length) more = true;
    });
    if (more && !pumping) { pumping = true; setTimeout(function () { pumping = false; pump(); }, 40); }
  }

  function onHostMessage(p, d) {
    if (!engine || !d || typeof d.a !== 'string') return;
    var r;
    if (d.a === 'sync') { resetHave(p.id); sendView(p.id); return; }
    if (d.a === 'skip') { if (!p.isHost) return; r = engine.hostSkip(d.id); }
    else if (d.a === 'next') { if (!p.isHost) return; r = engine.forceNext(); }
    else r = engine.apply(p.id, d, { connected: connectedIds() });
    if (r.error) { S.host.send(p.id, { t: 'err', msg: r.error }); return; }
    broadcast();
  }

  /* ── todos ── */
  function onMessage(d) {
    if (!d) return;
    if (d.t === 'state') { V = d.s; render(); }
    else if (d.t === 'img') addPart(d);
    else if (d.t === 'err') { util.toast(d.msg, 'err'); paintSel(); }
  }
  function onStatus(st, reason) {
    var b = $('dx-banner');
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

  /* ── imagens ── */
  function addPart(m) {
    var a = asm[m.c] || (asm[m.c] = { n: m.n, mime: m.m, parts: [], got: 0 });
    if (a.parts[m.i] === undefined) { a.parts[m.i] = Deck.fromB64(m.d); a.got++; }
    if (a.got === a.n) {
      delete asm[m.c];
      urls[m.c] = URL.createObjectURL(new Blob(a.parts, { type: a.mime }));
      hydrate(m.c);
    }
  }
  function urlFor(c) {
    if (urls[c]) return urls[c];
    if (S && S.isHost && hostCards[c]) return (urls[c] = Deck.url(hostCards[c]));
    return null;
  }
  function hydrate(only) {
    var imgs = root.querySelectorAll('img[data-c]');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i], c = +img.getAttribute('data-c');
      if ((only && c !== only) || img.getAttribute('src')) continue;
      var u = urlFor(c);
      if (u) { img.src = u; img.parentNode.classList.add('ok'); }
    }
    var lb = $('dx-lb');
    if (lb && !lb.hidden) { var li = lb.querySelector('img[data-c]'); if (li && !li.getAttribute('src') && urlFor(+li.getAttribute('data-c'))) li.src = urlFor(+li.getAttribute('data-c')); }
  }

  /* ════════════════════════════ leitura do estado ════════════════════════════ */
  function P(id) { return V.players.filter(function (p) { return p.id === id; })[0]; }
  function nm(id) { var p = P(id); return p ? esc(p.name) : '?'; }
  function online(id) { var p = S.players.filter(function (x) { return x.id === id; })[0]; return !p || p.connected !== false; }
  function isSt() { return V.storyteller === myId; }
  function waitingIds() {
    var st = V.storyteller;
    switch (V.phase) {
      case 'give_clue': return [st];
      case 'pick_card': return V.players.filter(function (p) { return p.id !== st && !p.submitted; }).map(function (p) { return p.id; });
      case 'vote': return V.players.filter(function (p) { return p.id !== st && !p.voted; }).map(function (p) { return p.id; });
      case 'results': return V.players.filter(function (p) { return !p.ready; }).map(function (p) { return p.id; });
      default: return [];
    }
  }
  function skipBtns() {
    if (!S.isHost) return '';
    return waitingIds().filter(function (id) { return id !== myId && (!online(id) || Date.now() - ui.waitSince > 60000); }).map(function (id) {
      return '<button class="btn btn-ghost block" style="margin-top:8px" data-d="skip" data-id="' + esc(id) + '">Pular ' + nm(id) + (online(id) ? ' (demorando)' : ' (offline)') + '</button>';
    }).join('');
  }
  function progress(list, okFn) {
    return '<div class="dx-prog">' + list.map(function (p) { return '<span class="' + (okFn(p) ? 'ok' : '') + '">' + (okFn(p) ? '✓ ' : '… ') + esc(p.name) + '</span>'; }).join('') + '</div>';
  }

  /* ════════════════════════════ desenho ════════════════════════════ */
  function render() {
    if (!V) return;
    var key = V.turn + ':' + V.phase;
    if (key !== ui.key) { ui.key = key; ui.sel = []; ui.waitSince = Date.now(); }
    renderTop(); renderClue(); renderMain(); renderBar(); effects();
  }

  function renderTop() {
    setHtml('dx-score', V.players.map(function (p) {
      var st = p.id === V.storyteller && V.phase !== 'game_over';
      return '<div class="dx-chip' + (st ? ' st' : '') + (online(p.id) ? '' : ' off') + '"><span class="dot" style="background:' + esc(p.color) + '"></span>' +
        esc(p.name) + (p.id === myId ? ' <small>você</small>' : '') + (st ? ' <small>narra</small>' : '') + (online(p.id) ? '' : ' <small>offline</small>') + ' <b>' + p.score + '</b></div>';
    }).join(''));
    $('dx-deck').textContent = 'Monte ' + V.deck;
  }

  function renderClue() {
    var el = $('dx-clue'), who = nm(V.storyteller), h = '', mine = isSt();
    if (V.phase === 'game_over') h = '<div class="who">Fim de jogo</div>';
    else if (V.phase === 'give_clue') h = '<div class="who">Rodada ' + V.turn + '</div><div class="txt" style="font-size:1.1rem;color:var(--text)">' + (mine ? 'Você é o(a) narrador(a)' : who + ' está pensando na pista…') + '</div>';
    else h = '<div class="who">Pista ' + (mine ? 'sua' : 'de ' + who) + ' · rodada ' + V.turn + '</div><div class="txt">“' + esc(V.clue) + '”</div>';
    el.className = 'dx-clue' + (mine && V.phase !== 'game_over' ? ' me' : '');
    setHtml('dx-clue', h);
  }

  function card(c, o) {
    o = o || {};
    var cls = 'cd' + (o.pick ? ' pick' : '') + (o.cls ? ' ' + o.cls : '');
    return '<div class="' + cls + '" data-card="' + c + '"' + (o.pick ? ' role="button" tabindex="0"' : '') + '>' +
      '<div class="art"><img data-c="' + c + '" alt="' + (o.pos ? 'Carta ' + o.pos : 'Carta') + '" draggable="false"></div>' +
      '<button class="zoom" data-z="' + c + '" aria-label="Ampliar carta">' + ZOOM + '</button>' +
      (o.tag ? '<span class="tag ' + (o.tagCls || '') + '">' + esc(o.tag) + '</span>' : '') +
      (o.pos ? '<span class="pos">' + o.pos + '</span>' : '') + (o.extra || '') + '</div>';
  }
  function grid(list, fn, small) { return '<div class="dx-grid' + (small ? ' small' : '') + '">' + list.map(fn).join('') + '</div>'; }
  function viewHand(small) { return '<div class="dx-sub">Suas cartas</div>' + grid(V.hand, function (c) { return card(c); }, small); }

  function renderMain() {
    if (!V) return;
    var me = P(myId), st = V.storyteller, mine = isSt(), cpt = V.settings.cpt, h = '';
    ui.mode = '';

    switch (V.phase) {
      case 'give_clue':
        if (mine) {
          ui.mode = 'clue';
          h = '<div class="dx-panel"><h2>Sua vez de narrar</h2><p>Escolha uma carta e escreva uma pista: uma palavra, uma frase, um som… Nem óbvia demais, nem misteriosa demais.</p></div>' +
            '<div class="dx-sub">Suas cartas</div>' + grid(V.hand, function (c) { return card(c, { pick: true }); });
        } else {
          h = '<div class="dx-panel"><h2>Aguardando</h2><p>' + nm(st) + ' está escolhendo uma carta e pensando na pista.</p>' + skipBtns() + '</div>' + viewHand(true);
        }
        break;

      case 'pick_card':
        if (!mine && !me.submitted) {
          ui.mode = 'pick';
          h = '<div class="dx-panel"><h2>Escolha ' + cpt + (cpt === 1 ? ' carta' : ' cartas') + '</h2><p>Qual das suas cartas combina com a pista de ' + nm(st) + '? Tente confundir os outros sem entregar demais.</p></div>' +
            '<div class="dx-sub">Suas cartas</div>' + grid(V.hand, function (c) { return card(c, { pick: true }); });
        } else {
          var others = V.players.filter(function (p) { return p.id !== st; });
          h = '<div class="dx-panel"><h2>' + (mine ? 'Aguardando os outros' : 'Enviado!') + '</h2><p>' + (mine ? 'Cada jogador está escolhendo uma carta que combine com a sua pista.' : 'Aguardando os outros jogadores.') + '</p>' +
            progress(others, function (p) { return p.submitted; }) + skipBtns() + '</div>' +
            '<div class="dx-sub">' + (V.myPick.length > 1 ? 'Cartas que você enviou' : 'Carta que você enviou') + '</div>' +
            grid(V.myPick, function (c) { return card(c, { tag: mine ? 'Sua carta' : '', tagCls: 'st' }); }, true);
        }
        break;

      case 'vote':
        var canVote = !mine && V.myVote === null;
        if (canVote) ui.mode = 'vote';
        var voters = V.players.filter(function (p) { return p.id !== st; });
        h = '<div class="dx-panel"><h2>' + (canVote ? 'Qual é a carta do narrador?' : mine ? 'Aguardando os votos' : 'Voto registrado') + '</h2>' +
          '<p>' + (canVote ? 'Você não pode votar nas suas próprias cartas.' : mine ? 'A sua carta está marcada em verde.' : 'Aguardando os outros jogadores votarem.') + '</p>' +
          progress(voters, function (p) { return p.voted; }) + (canVote ? '' : skipBtns()) + '</div>' +
          grid(V.table, function (e) {
            var own = V.myTable.indexOf(e.card) >= 0, stc = mine && e.card === V.stCard, voted = V.myVote === e.card;
            return card(e.card, {
              pos: e.pos, pick: canVote && !own,
              cls: (own ? 'mine' : '') + (stc ? ' stc' : '') + (voted ? ' voted' : ''),
              tag: own ? 'Sua' : stc ? 'Sua carta' : voted ? 'Seu voto' : '', tagCls: stc ? 'st' : own ? 'me' : '',
            });
          });
        break;

      case 'results':
        h = resultsHtml();
        break;

      case 'game_over':
        h = overHtml();
        break;
    }
    setHtml('dx-main', h);
    paintSel(); hydrate();
  }

  function resultsHtml() {
    var r = V.round, st = V.storyteller;
    var cards = grid(V.table, function (e) {
      var o = P(e.owner), isStc = e.card === V.stCard;
      var dots = e.voters.map(function (id) { var p = P(id); return '<i style="background:' + esc(p.color) + '" title="' + esc(p.name) + '"></i>'; }).join('');
      var extra = '<div class="owner"><div class="voters">' + dots + '</div><div class="o"><i style="background:' + esc(o.color) + '"></i>' + esc(o.name) + '</div></div>';
      return card(e.card, { pos: e.pos, cls: isStc ? 'stc' : '', tag: isStc ? 'Narrador' : '', tagCls: 'st', extra: extra });
    });
    var pts = V.players.map(function (p) {
      var x = r.points[p.id], pst = p.id === st, correct = r.correct.indexOf(p.id) >= 0, parts = [];
      if (pst) parts.push(x.base > 0 ? 'narrador: parte do grupo acertou (+3)' : 'narrador: todos ou ninguém acertaram (0)');
      else if (r.allOrNone) parts.push('todos ou ninguém acertaram a carta do narrador (+2)');
      else parts.push(correct ? 'acertou a carta do narrador (+3)' : 'não acertou a carta do narrador (0)');
      if (x.bonus) parts.push(x.bonus + (x.bonus === 1 ? ' voto' : ' votos') + ' nas suas cartas (+' + x.bonus + ')');
      return '<div class="dx-pt"><span class="dot" style="background:' + esc(p.color) + '"></span><div class="tx"><b>' + esc(p.name) + (pst ? ' · narrador' : '') + '</b><small>' + parts.join(' · ') + '</small></div>' +
        '<div><div class="d' + (x.total ? '' : ' z') + '">' + (x.total ? '+' + x.total : '0') + '</div><div class="tot">' + p.score + ' no total</div></div></div>';
    }).join('');
    return '<div class="dx-sub">Cartas da rodada</div>' + cards +
      '<div class="dx-panel"><h2>Pontos da rodada</h2><div class="dx-points">' + pts + '</div></div>';
  }

  function overHtml() {
    var sorted = V.players.slice().sort(function (a, b) { return b.score - a.score; });
    var names = V.winners.map(function (id) { return nm(id); }).join(' e ');
    var list = sorted.map(function (p, i) {
      return '<div class="dx-pt"><span class="dot" style="background:' + esc(p.color) + '"></span><div class="tx"><b>' + (i + 1) + 'º · ' + esc(p.name) + '</b></div><div class="d">' + p.score + '</div></div>';
    }).join('');
    return '<div class="dx-over"><h2>' + (V.winners.indexOf(myId) >= 0 ? 'Você venceu!' : names + (V.winners.length > 1 ? ' empataram!' : ' venceu!')) + '</h2>' +
      '<p class="muted">Meta de ' + V.settings.target + ' pontos atingida.</p><div class="dx-rank">' + list + '</div>' +
      '<button class="btn btn-primary block" data-d="again">Nova partida</button>' +
      '<a class="btn btn-ghost block" style="margin-top:8px" href="../../index.html">Voltar ao menu</a></div>';
  }

  /* ── barra de ação fixa ── */
  function barMode() {
    var me = P(myId);
    if (V.phase === 'give_clue' && isSt()) return 'clue';
    if (V.phase === 'pick_card' && !isSt() && !me.submitted) return 'pick';
    if (V.phase === 'vote' && !isSt() && V.myVote === null) return 'vote';
    if (V.phase === 'results') return me.ready ? 'wait' : 'ready';
    return '';
  }
  function renderBar() {
    var mode = barMode(), key = ui.key + ':' + mode;
    var keep = mode === 'clue' || mode === 'pick' || mode === 'vote';
    if (keep && ui.barKey === key) { paintSel(); return; }          // mantém o que foi digitado
    ui.barKey = keep ? key : '';
    var h = '';
    if (mode === 'clue') h = '<div class="row"><input id="dx-clue-in" class="input grow" maxlength="80" placeholder="Escreva a sua pista" autocomplete="off" enterkeyhint="send" aria-label="Pista"><button class="btn btn-primary" data-d="clue" disabled>Enviar</button></div>';
    else if (mode === 'pick') h = '<button class="btn btn-primary block" data-d="pick" disabled>Enviar</button>';
    else if (mode === 'vote') h = '<button class="btn btn-primary block" data-d="vote" disabled>Votar</button>';
    else if (mode === 'ready') h = '<button class="btn btn-primary block" data-d="ready">Próxima rodada</button>' + (S.isHost ? '<button class="btn btn-ghost block" data-d="next">Avançar agora para todos</button>' : '');
    else if (mode === 'wait') {
      var n = V.players.length, k = V.players.filter(function (p) { return p.ready; }).length;
      h = '<button class="btn block" disabled>Aguardando os outros (' + k + ' de ' + n + ')</button>' + (S.isHost ? '<button class="btn btn-ghost block" data-d="next">Avançar agora para todos</button>' : '');
    }
    ui.cache['dx-bar'] = undefined;
    setHtml('dx-bar', h);
    paintSel();
  }

  /* ── seleção de cartas ── */
  function selectCard(c) {
    if (ui.mode === 'pick') {
      var i = ui.sel.indexOf(c), cpt = V.settings.cpt;
      if (i >= 0) ui.sel.splice(i, 1); else if (ui.sel.length < cpt) ui.sel.push(c); else { ui.sel.shift(); ui.sel.push(c); }
    } else if (ui.mode === 'clue' || ui.mode === 'vote') ui.sel = [c];
    paintSel();
  }
  function paintSel() {
    var cds = root.querySelectorAll('#dx-main .cd[data-card]');
    for (var i = 0; i < cds.length; i++) cds[i].classList.toggle('sel', ui.sel.indexOf(+cds[i].getAttribute('data-card')) >= 0);
    var bar = $('dx-bar'); if (!bar || !V) return;
    var cpt = V.settings.cpt;
    var bc = bar.querySelector('[data-d="clue"]'), bp = bar.querySelector('[data-d="pick"]'), bv = bar.querySelector('[data-d="vote"]');
    if (bc) { var inp = $('dx-clue-in'); bc.disabled = !(ui.sel.length === 1 && inp && inp.value.trim()); }
    if (bp) {
      bp.disabled = ui.sel.length !== cpt;
      bp.textContent = cpt === 1 ? 'Enviar carta' : ui.sel.length === cpt ? 'Enviar as ' + cpt + ' cartas' : 'Escolha ' + cpt + ' cartas (' + ui.sel.length + ' de ' + cpt + ')';
    }
    if (bv) bv.disabled = ui.sel.length !== 1;
  }

  /* ── aviso quando é a sua vez de agir ── */
  function effects() {
    var m = barMode(), key = ui.key + ':' + (m === 'clue' || m === 'pick' || m === 'vote' ? m : '');
    if (key !== ui.needKey) {
      ui.needKey = key;
      if (m === 'clue' || m === 'pick' || m === 'vote') { util.vibrate([70, 40, 70]); util.toast(m === 'clue' ? 'Você é o(a) narrador(a)!' : m === 'pick' ? 'Escolha a sua carta.' : 'Hora de votar!', 'ok'); }
    }
  }

  /* ── ampliar carta ── */
  function openLb(c) {
    var lb = $('dx-lb'), u = urlFor(c);
    lb.innerHTML = '<button class="x" aria-label="Fechar">✕</button><img data-c="' + c + '" alt="Carta ampliada"' + (u ? ' src="' + u + '"' : '') + '>';
    lb.hidden = false;
  }
  function closeLb() { var lb = $('dx-lb'); if (lb) { lb.hidden = true; lb.innerHTML = ''; } }

  /* ════════════════════════════ eventos ════════════════════════════ */
  function onInput(e) { if (e.target.id === 'dx-clue-in') paintSel(); }
  function onKey(e) {
    if (e.target.id === 'dx-clue-in' && e.key === 'Enter') { var b = root.querySelector('[data-d="clue"]'); if (b && !b.disabled) b.click(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('pick')) { e.preventDefault(); e.target.click(); }
  }
  function onClick(e) {
    var z = e.target.closest('[data-z]');
    if (z) { e.stopPropagation(); openLb(+z.getAttribute('data-z')); return; }
    var cd = e.target.closest('.cd');
    if (cd && root.contains(cd)) {
      if (cd.classList.contains('pick')) selectCard(+cd.getAttribute('data-card')); else openLb(+cd.getAttribute('data-card'));
      return;
    }
    var el = e.target.closest('[data-d]');
    if (!el || !root.contains(el) || el.disabled) return;
    switch (el.getAttribute('data-d')) {
      case 'clue': act('clue', { card: ui.sel[0], text: $('dx-clue-in').value }); el.disabled = true; break;
      case 'pick': act('pick', { cards: ui.sel.slice() }); el.disabled = true; break;
      case 'vote': act('vote', { card: ui.sel[0] }); el.disabled = true; break;
      case 'ready': act('ready'); el.disabled = true; break;
      case 'next': act('next'); break;
      case 'skip': act('skip', { id: el.getAttribute('data-id') }); break;
      case 'again': Net.forget(GAME); try { S.leave(); } catch (err) { /* já saiu */ } location.reload(); break;
    }
  }

  // Gancho só para testes automatizados (?debug=1): não altera o jogo.
  if (debug) window.__dx = { get V() { return V; }, get E() { return engine; }, get S() { return S; }, get deck() { return deck; }, act: function (a, x) { act(a, x); } };
})();
