/* Dixit — motor de regras (puro: sem DOM, sem rede, sem imagens).
   As cartas são só identificadores; quem mostra as imagens é a interface.

   Mantido do original: pontuação (todos ou ninguém acertam: narrador 0 e demais +2; senão narrador
   e quem acertou +3; +1 por voto recebido na própria carta), mão de 6 cartas (7 no modo de 2 cartas),
   baralho que se reembaralha com o descarte, meta de pontos.
   Novo: 3 a 6 jogadores, botão "pronto" para avançar, pontuação detalhada por jogador,
   anfitrião pode destravar quem está offline.                                                      */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    var L = root.Ludoteca = root.Ludoteca || {};
    L.Dixit = Object.assign(L.Dixit || {}, api);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var MIN_PLAYERS = 3, MAX_PLAYERS = 6;

  function shuffle(a, rng) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function cleanClue(s) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80); }

  /* Recomendação oficial: com 3 jogadores cada um joga 2 cartas. */
  function defaultCpt(nPlayers) { return nPlayers === 3 ? 2 : 1; }
  function handSize(cpt) { return cpt === 1 ? 6 : 7; }
  /* Mínimo de cartas para a partida não ficar repetitiva: mãos + duas rodadas de reposição. */
  function minCards(nPlayers, cpt) { return nPlayers * handSize(cpt) + 2 * nPlayers * cpt; }

  /* opts: { players:[{id,name,color}], cards:[ids], cpt:1|2, target:number, rng } */
  function createEngine(opts) {
    var rng = opts.rng || Math.random;
    var n = opts.players.length;
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error('Dixit suporta de ' + MIN_PLAYERS + ' a ' + MAX_PLAYERS + ' jogadores.');
    var cpt = opts.cpt === 2 ? 2 : opts.cpt === 1 ? 1 : defaultCpt(n);
    var settings = { cpt: cpt, target: clamp(parseInt(opts.target, 10) || 30, 10, 60) };
    var H = handSize(cpt);
    if (opts.cards.length < n * H + n * cpt) throw new Error('Baralho pequeno demais para ' + n + ' jogadores.');

    var S = {
      phase: 'give_clue', turn: 1, st: 0,
      players: [], deck: shuffle(opts.cards.slice(), rng), discard: [],
      clue: '', stCard: null, submitted: {}, table: [], votes: {}, round: null, ready: {},
      winners: null, log: [],
    };
    shuffle(opts.players.slice(), rng).forEach(function (p) {
      S.players.push({ id: p.id, name: p.name, color: p.color, score: 0, hand: [] });
    });

    function P(id) { return S.players.filter(function (p) { return p.id === id; })[0]; }
    function ST() { return S.players[S.st]; }
    function others() { return S.players.filter(function (p) { return p.id !== ST().id; }); }
    function err(m) { return { error: m }; }
    function log(t) { S.log.push(t); if (S.log.length > 30) S.log.shift(); }

    function draw(k) {
      var out = [];
      for (var i = 0; i < k; i++) {
        if (!S.deck.length) { S.deck = shuffle(S.discard, rng); S.discard = []; }
        if (!S.deck.length) break;
        out.push(S.deck.pop());
      }
      return out;
    }
    S.players.forEach(function (p) { p.hand = draw(H); });
    log(ST().name + ' é o(a) primeiro(a) narrador(a)');

    /* ── fases ── */
    function buildTable() {
      var list = [];
      Object.keys(S.submitted).forEach(function (pid) {
        S.submitted[pid].forEach(function (c) { list.push({ card: c, owner: pid }); });
      });
      shuffle(list, rng);
      list.forEach(function (e, i) { e.pos = i + 1; });
      S.table = list; S.votes = {};
      S.phase = 'vote';
    }

    function score() {
      var st = ST(), voters = others();
      var correct = voters.filter(function (p) { return S.votes[p.id] === S.stCard; }).map(function (p) { return p.id; });
      var allOrNone = correct.length === 0 || correct.length === voters.length;
      var r = {};
      S.players.forEach(function (p) { r[p.id] = { base: 0, bonus: 0, total: 0 }; });
      if (allOrNone) voters.forEach(function (p) { r[p.id].base = 2; });
      else { r[st.id].base = 3; correct.forEach(function (id) { r[id].base = 3; }); }
      Object.keys(S.votes).forEach(function (vid) {
        var e = S.table.filter(function (x) { return x.card === S.votes[vid]; })[0];
        if (e && e.owner !== st.id) r[e.owner].bonus++;
      });
      S.players.forEach(function (p) { r[p.id].total = r[p.id].base + r[p.id].bonus; p.score += r[p.id].total; });
      S.round = { points: r, allOrNone: allOrNone, correct: correct };
      S.table.forEach(function (e) { S.discard.push(e.card); });
      S.phase = 'results'; S.ready = {};
      log('Rodada ' + S.turn + ': ' + (allOrNone ? 'todos ou ninguém acertaram a carta do narrador' : correct.length + ' acertaram a carta do narrador'));
    }

    function nextRound() {
      var top = Math.max.apply(null, S.players.map(function (p) { return p.score; }));
      if (top >= settings.target) {
        S.winners = S.players.filter(function (p) { return p.score === top; }).map(function (p) { return p.id; });
        S.phase = 'game_over';
        return;
      }
      S.players.forEach(function (p) { Array.prototype.push.apply(p.hand, draw(cpt)); });
      S.st = (S.st + 1) % n; S.turn++;
      S.clue = ''; S.stCard = null; S.submitted = {}; S.table = []; S.votes = {}; S.round = null; S.ready = {};
      S.phase = 'give_clue';
      log(ST().name + ' é o(a) narrador(a)');
    }

    function everyone(map) { return others().every(function (p) { return map[p.id] !== undefined; }); }

    /* ── ações ── */
    var A = {
      clue: function (id, a) {
        if (S.phase !== 'give_clue') return err('Agora não é hora de dar a pista.');
        if (ST().id !== id) return err('Só o(a) narrador(a) dá a pista.');
        var me = P(id), text = cleanClue(a.text);
        if (!text) return err('Escreva uma pista.');
        if (me.hand.indexOf(a.card) < 0) return err('Escolha uma carta da sua mão.');
        me.hand.splice(me.hand.indexOf(a.card), 1);
        S.clue = text; S.stCard = a.card; S.submitted = {}; S.submitted[id] = [a.card];
        S.phase = 'pick_card';
        log(me.name + ' deu a pista: “' + text + '”');
        return { ok: true };
      },

      pick: function (id, a) {
        if (S.phase !== 'pick_card') return err('Agora não é hora de escolher cartas.');
        if (ST().id === id) return err('O(a) narrador(a) já escolheu a carta.');
        if (S.submitted[id]) return err('Você já enviou.');
        var me = P(id), cs = Array.isArray(a.cards) ? a.cards : [];
        if (cs.length !== cpt) return err('Escolha ' + cpt + (cpt === 1 ? ' carta.' : ' cartas.'));
        var seen = {};
        for (var i = 0; i < cs.length; i++) {
          if (me.hand.indexOf(cs[i]) < 0 || seen[cs[i]]) return err('Seleção inválida.');
          seen[cs[i]] = true;
        }
        cs.forEach(function (c) { me.hand.splice(me.hand.indexOf(c), 1); });
        S.submitted[id] = cs.slice();
        if (everyone(S.submitted)) buildTable();
        return { ok: true };
      },

      vote: function (id, a) {
        if (S.phase !== 'vote') return err('Agora não é hora de votar.');
        if (ST().id === id) return err('O(a) narrador(a) não vota.');
        if (S.votes[id] !== undefined) return err('Você já votou.');
        var e = S.table.filter(function (x) { return x.card === a.card; })[0];
        if (!e) return err('Carta inválida.');
        if (e.owner === id) return err('Você não pode votar na sua própria carta.');
        S.votes[id] = a.card;
        if (everyone(S.votes)) score();
        return { ok: true };
      },

      /* "Pronto para a próxima rodada". ctx.connected = ids que ainda estão online (opcional). */
      ready: function (id, a, ctx) {
        if (S.phase !== 'results') return err('Ainda não é hora.');
        S.ready[id] = true;
        var online = ctx && ctx.connected ? ctx.connected : null;
        var need = S.players.filter(function (p) { return !online || online.indexOf(p.id) >= 0; });
        if (need.every(function (p) { return S.ready[p.id]; })) nextRound();
        return { ok: true };
      },
    };

    function apply(id, a, ctx) {
      if (!a || typeof a.a !== 'string' || !A[a.a]) return err('Ação desconhecida.');
      if (S.phase === 'game_over') return err('A partida já acabou.');
      if (!P(id)) return err('Jogador desconhecido.');
      return A[a.a](id, a, ctx);
    }

    /* Quem o jogo está esperando agora. */
    function waitingOn() {
      switch (S.phase) {
        case 'give_clue': return [ST().id];
        case 'pick_card': return others().filter(function (p) { return !S.submitted[p.id]; }).map(function (p) { return p.id; });
        case 'vote': return others().filter(function (p) { return S.votes[p.id] === undefined; }).map(function (p) { return p.id; });
        case 'results': return S.players.filter(function (p) { return !S.ready[p.id]; }).map(function (p) { return p.id; });
        default: return [];
      }
    }

    /* O anfitrião joga por quem está offline (ou demorando). */
    function hostSkip(id) {
      var p = P(id);
      if (!p || S.phase === 'game_over') return err('Nada a fazer.');
      if (waitingOn().indexOf(id) < 0) return err('Esse jogador não está sendo esperado.');
      if (S.phase === 'give_clue') {
        log('⏭ ' + p.name + ' estava offline: a vez de narrar passou adiante');
        S.st = (S.st + 1) % n; S.turn++;
        return { ok: true };
      }
      if (S.phase === 'pick_card') {
        var hand = p.hand.slice(), pick = [];
        for (var i = 0; i < cpt; i++) pick.push(hand.splice(Math.floor(rng() * hand.length), 1)[0]);
        log('⏭ O anfitrião escolheu cartas por ' + p.name);
        return A.pick(id, { cards: pick });
      }
      if (S.phase === 'vote') {
        var opts2 = S.table.filter(function (e) { return e.owner !== id; });
        log('⏭ O anfitrião votou por ' + p.name);
        return A.vote(id, { card: opts2[Math.floor(rng() * opts2.length)].card });
      }
      if (S.phase === 'results') {
        S.ready[id] = true;
        if (S.players.every(function (q) { return S.ready[q.id]; })) nextRound();
        return { ok: true };
      }
      return err('Nada a fazer.');
    }

    /* Chamado quando alguém sai da sala: se só faltava essa pessoa dizer "pronto", avança. */
    function recheck(ctx) {
      if (S.phase !== 'results' || !ctx || !ctx.connected) return false;
      var need = S.players.filter(function (p) { return ctx.connected.indexOf(p.id) >= 0; });
      if (need.length && need.every(function (p) { return S.ready[p.id]; })) { nextRound(); return true; }
      return false;
    }

    /* Avança a tela de resultados à força (botão do anfitrião). */
    function forceNext() {
      if (S.phase !== 'results') return err('Ainda não é hora.');
      nextRound();
      return { ok: true };
    }

    /* Visão filtrada: cada jogador só vê a própria mão e, na hora certa, de quem é cada carta. */
    function view(id) {
      var me = P(id), st = ST(), isSt = st.id === id;
      var showOwners = S.phase === 'results' || S.phase === 'game_over';
      var table = [];
      if (S.phase === 'vote') table = S.table.map(function (e) { return { card: e.card, pos: e.pos }; });
      else if (showOwners && S.table.length) {
        table = S.table.map(function (e) {
          return { card: e.card, pos: e.pos, owner: e.owner, voters: Object.keys(S.votes).filter(function (v) { return S.votes[v] === e.card; }) };
        });
      }
      var v = {
        phase: S.phase, turn: S.turn, settings: settings, storyteller: st.id, clue: S.clue,
        players: S.players.map(function (p) {
          return { id: p.id, name: p.name, color: p.color, score: p.score, cardCount: p.hand.length,
            submitted: !!S.submitted[p.id], voted: S.votes[p.id] !== undefined, ready: !!S.ready[p.id] };
        }),
        hand: me ? me.hand.slice() : [],
        table: table,
        myTable: S.phase === 'vote' && me ? S.table.filter(function (e) { return e.owner === id; }).map(function (e) { return e.card; }) : [],
        myPick: S.submitted[id] ? S.submitted[id].slice() : [],
        myVote: S.votes[id] === undefined ? null : S.votes[id],
        stCard: showOwners || (isSt && S.phase !== 'give_clue') ? S.stCard : null,
        round: showOwners ? S.round : null,
        deck: S.deck.length, discard: S.discard.length,
        winners: S.winners, log: S.log.slice(-8),
      };
      v.need = neededCards(v);
      return v;
    }

    /* Cartas cujas imagens esta pessoa precisa ter agora. */
    function neededCards(v) {
      var seen = {}, out = [];
      function add(c) { if (c !== null && c !== undefined && !seen[c]) { seen[c] = true; out.push(c); } }
      v.hand.forEach(add); v.myPick.forEach(add); v.table.forEach(function (e) { add(e.card); }); add(v.stCard);
      return out;
    }

    return { state: S, settings: settings, apply: apply, view: view, hostSkip: hostSkip, forceNext: forceNext, recheck: recheck, waitingOn: waitingOn };
  }

  return { createEngine: createEngine, defaultCpt: defaultCpt, handSize: handSize, minCards: minCards, MIN_PLAYERS: MIN_PLAYERS, MAX_PLAYERS: MAX_PLAYERS };
});
