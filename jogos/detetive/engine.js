/* Detetive — motor de regras (puro: sem DOM e sem rede).
   Roda no navegador do anfitrião e nos testes em Node (tests/detetive.test.js).

   Mudanças em relação ao jogo original (Python):
   - 3 a 6 jogadores (o original parava em 4);
   - uma sugestão por turno (o original permitia sugerir sem limite);
   - refutação automática: quem não tem nenhuma das cartas passa sozinho e quem tem
     só uma a mostra sozinho — só se espera alguém quando há escolha de verdade;
   - histórico estruturado de sugestões e acusações (alimenta a caderneta automática);
   - passagem secreta no lugar de rolar os dados (e não depois de andar);
   - dado único opcional e regra opcional "não sugerir duas vezes seguidas no mesmo aposento";
   - o último jogador não eliminado vence;
   - o anfitrião pode pular quem está offline.                                              */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    var L = root.Ludoteca = root.Ludoteca || {};
    L.Detetive = Object.assign(L.Detetive || {}, api);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var SUSPECTS = ['Srta. Escarlate', 'Cel. Mostarda', 'Sra. Branca', 'Sr. Verde', 'Sra. Pavão', 'Prof. Ameixa'];
  var WEAPONS = ['Castiçal', 'Faca', 'Cano de Chumbo', 'Revólver', 'Corda', 'Chave Inglesa'];
  var ROOMS = ['Cozinha', 'Salão de Baile', 'Conservatório', 'Bilhar', 'Biblioteca', 'Estudo', 'Hall', 'Sala de Jantar', 'Varanda'];
  var ROOM_SHORT = ['Cozinha', 'Salão', 'Conserv.', 'Bilhar', 'Biblio.', 'Estudo', 'Hall', 'Jantar', 'Varanda'];
  var ALL_CARDS = SUSPECTS.concat(WEAPONS, ROOMS);

  var ICONS = {
    'Srta. Escarlate': '💃', 'Cel. Mostarda': '🎩', 'Sra. Branca': '👸', 'Sr. Verde': '🕵️', 'Sra. Pavão': '🦚', 'Prof. Ameixa': '🔬',
    'Castiçal': '🕯️', 'Faca': '🔪', 'Cano de Chumbo': '🔧', 'Revólver': '🔫', 'Corda': '🪢', 'Chave Inglesa': '🔩',
    'Cozinha': '🍳', 'Salão de Baile': '🪩', 'Conservatório': '🎵', 'Bilhar': '🎱', 'Biblioteca': '📚',
    'Estudo': '🖋️', 'Hall': '🚪', 'Sala de Jantar': '🍽️', 'Varanda': '🌿',
  };

  function categoryOf(card) {
    return SUSPECTS.indexOf(card) >= 0 ? 'suspect' : WEAPONS.indexOf(card) >= 0 ? 'weapon' : ROOMS.indexOf(card) >= 0 ? 'room' : null;
  }

  /* ── Tabuleiro 5×5: aposentos nas casas (linha par, coluna par); o resto é corredor ── */
  var SIZE = 5;
  var SECRET = { 0: 8, 8: 0, 2: 6, 6: 2 };                 // passagens entre cantos opostos
  var STARTS = [[0, 3], [1, 4], [3, 0], [4, 1], [0, 1], [4, 3]];

  function isRoomCell(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE && r % 2 === 0 && c % 2 === 0; }
  function roomAt(r, c) { return isRoomCell(r, c) ? (r / 2) * 3 + c / 2 : -1; }
  function cellOfRoom(i) { return [Math.floor(i / 3) * 2, (i % 3) * 2]; }

  /* Casas alcançáveis com até `steps` passos. De um aposento só se sai por corredor;
     entrar num aposento encerra o movimento. */
  function getReachable(pos, steps) {
    var sr = pos[0], sc = pos[1];
    var visited = {}, out = {}, queue = [[sr, sc, steps, !isRoomCell(sr, sc)]];
    while (queue.length) {
      var q = queue.shift(), r = q[0], c = q[1], rem = q[2], active = q[3];
      var key = r + ',' + c + ',' + active;
      if ((visited[key] === undefined ? -1 : visited[key]) >= rem) continue;
      visited[key] = rem;
      if (rem === 0) continue;
      [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(function (d) {
        var nr = r + d[0], nc = c + d[1];
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) return;
        var nextRoom = isRoomCell(nr, nc), curRoom = isRoomCell(r, c);
        if (curRoom && !active) {
          if (!nextRoom) { out[nr + ',' + nc] = [nr, nc]; queue.push([nr, nc, rem - 1, true]); }
        } else if (nextRoom) {
          out[nr + ',' + nc] = [nr, nc];
        } else {
          out[nr + ',' + nc] = [nr, nc]; queue.push([nr, nc, rem - 1, true]);
        }
      });
    }
    delete out[sr + ',' + sc];
    return Object.keys(out).map(function (k) { return out[k]; });
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1)), t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

  /* ════════════════════════════════════════════════════════════════════════════
     createEngine({ players:[{id,name,color}], dice:1|2, noRepeat:bool, rng })
     ════════════════════════════════════════════════════════════════════════════ */
  function createEngine(opts) {
    var rng = opts.rng || Math.random;
    var settings = { dice: opts.dice === 1 ? 1 : 2, noRepeat: opts.noRepeat !== false };
    if (opts.players.length < 1 || opts.players.length > 6) throw new Error('Detetive suporta de 1 a 6 jogadores.');

    var S = {
      phase: 'roll',              // roll | move | action | after | disprove | post_suggest | game_over
      players: [], current: 0, turn: 1,
      envelope: null, dice: null, rollId: 0, reachable: [],
      suggestion: null,           // {n,by,suspect,weapon,room}
      disprove: null,             // {order:[ids], idx, waitingFor, shown:{card,by}|null}
      history: [], shownTo: {}, log: [],
      lastSuggest: {},            // id -> aposento da última sugestão (zera ao andar)
      winner: null, winReason: null,
    };

    /* ── preparação ── */
    S.envelope = { suspect: pick(SUSPECTS, rng), weapon: pick(WEAPONS, rng), room: pick(ROOMS, rng) };
    var env = S.envelope;
    var rest = shuffle(ALL_CARDS.filter(function (c) { return c !== env.suspect && c !== env.weapon && c !== env.room; }), rng);
    var order = shuffle(opts.players.slice(), rng);
    order.forEach(function (p, i) {
      S.players.push({ id: p.id, name: p.name, color: p.color, pos: STARTS[i].slice(), cards: [], eliminated: false });
      S.shownTo[p.id] = [];
    });
    rest.forEach(function (c, i) { S.players[i % S.players.length].cards.push(c); });

    /* ── ajudantes ── */
    function P(id) { return S.players.filter(function (p) { return p.id === id; })[0]; }
    function cur() { return S.players[S.current]; }
    function log(text, type) { S.log.push({ text: text, type: type || 'info' }); if (S.log.length > 40) S.log.shift(); }
    function err(msg) { return { error: msg }; }
    function roomIdx(p) { return roomAt(p.pos[0], p.pos[1]); }
    function activeCount() { return S.players.filter(function (p) { return !p.eliminated; }).length; }
    function sugCards(sg) { return [sg.suspect, sg.weapon, sg.room]; }

    function nextTurn() {
      var n = S.players.length;
      for (var i = 0; i < n; i++) {
        S.current = (S.current + 1) % n;
        if (!cur().eliminated) break;
      }
      S.turn++;
      S.dice = null; S.reachable = []; S.suggestion = null; S.disprove = null;
      S.phase = 'roll';
    }

    function finish(winnerId, reason) {
      S.phase = 'game_over'; S.winner = winnerId; S.winReason = reason;
      S.reachable = []; S.suggestion = null; S.disprove = null;
    }

    function resetSuggestMemory(id) { delete S.lastSuggest[id]; }

    /* ── refutação: percorre quem vem depois do sugeridor ── */
    function advanceDisprove() {
      var d = S.disprove, sg = S.suggestion, entry = S.history[S.history.length - 1];
      var suggester = P(sg.by);
      while (d.idx < d.order.length) {
        var pid = d.order[d.idx], p = P(pid);
        var matches = sugCards(sg).filter(function (c) { return p.cards.indexOf(c) >= 0; });
        if (matches.length === 0) {
          entry.replies.push({ pid: pid, r: 'pass' });
          log('🤷 ' + p.name + ' não pôde refutar', 'pass');
          d.idx++;
        } else if (matches.length === 1) {
          showCard(p, matches[0]);
          return;
        } else {
          d.waitingFor = pid;
          return;
        }
      }
      d.waitingFor = null; d.shown = null;
      log('🔍 Ninguém refutou a sugestão de ' + suggester.name, 'nobody');
      S.phase = 'post_suggest';
    }

    function showCard(p, card) {
      var d = S.disprove, sg = S.suggestion, entry = S.history[S.history.length - 1];
      entry.replies.push({ pid: p.id, r: 'show' });
      S.shownTo[sg.by].push({ n: sg.n, card: card, by: p.id });
      d.shown = { card: card, by: p.id }; d.waitingFor = null;
      log('🃏 ' + p.name + ' mostrou uma carta a ' + P(sg.by).name, 'show');
      S.phase = 'post_suggest';
    }

    /* ── ações dos jogadores ── */
    var actions = {

      roll: function (id) {
        if (S.phase !== 'roll') return err('Agora não é hora de rolar os dados.');
        S.dice = [];
        for (var i = 0; i < settings.dice; i++) S.dice.push(1 + Math.floor(rng() * 6));
        S.rollId++;
        var steps = S.dice.reduce(function (a, b) { return a + b; }, 0);
        S.reachable = getReachable(cur().pos, steps);
        S.phase = S.reachable.length ? 'move' : 'action';
        return { ok: true };
      },

      move: function (id, a) {
        if (S.phase !== 'move') return err('Agora não é hora de andar.');
        var ok = S.reachable.some(function (x) { return x[0] === a.r && x[1] === a.c; });
        if (!ok) return err('Essa casa está fora do alcance.');
        cur().pos = [a.r, a.c]; S.reachable = [];
        resetSuggestMemory(id);
        var ri = roomAt(a.r, a.c);
        log('🚶 ' + cur().name + (ri >= 0 ? ' entrou no aposento ' + ROOMS[ri] : ' está no corredor'), 'move');
        S.phase = 'action';
        return { ok: true };
      },

      skip: function () {
        if (S.phase !== 'move') return err('Você não precisa andar agora.');
        S.reachable = []; S.phase = 'action';
        return { ok: true };
      },

      secret: function (id) {
        if (S.phase !== 'roll' && S.phase !== 'move') return err('A passagem secreta só vale antes de andar.');
        var ri = roomIdx(cur());
        if (ri < 0 || SECRET[ri] === undefined) return err('Não há passagem secreta aqui.');
        cur().pos = cellOfRoom(SECRET[ri]); S.reachable = []; S.dice = null;
        resetSuggestMemory(id);
        log('🔑 ' + cur().name + ' usou a passagem secreta até o aposento ' + ROOMS[SECRET[ri]], 'move');
        S.phase = 'action';
        return { ok: true };
      },

      suggest: function (id, a) {
        if (S.phase !== 'action') return err('Você só pode sugerir depois de andar, uma vez por turno.');
        var ri = roomIdx(cur());
        if (ri < 0) return err('Você precisa estar num aposento para sugerir.');
        if (SUSPECTS.indexOf(a.suspect) < 0 || WEAPONS.indexOf(a.weapon) < 0) return err('Suspeito ou arma inválidos.');
        if (settings.noRepeat && S.lastSuggest[id] === ri) return err('Você já sugeriu neste aposento. Saia e volte, ou acuse.');
        S.lastSuggest[id] = ri;

        var sg = { n: S.history.length + 1, by: id, suspect: a.suspect, weapon: a.weapon, room: ROOMS[ri] };
        S.suggestion = sg;
        S.history.push({ type: 'suggest', n: sg.n, by: id, suspect: sg.suspect, weapon: sg.weapon, room: sg.room, replies: [] });
        log('💬 ' + cur().name + ' sugeriu: ' + sg.suspect + ', ' + sg.weapon + ', ' + sg.room, 'suggest');

        var idx = S.current, n = S.players.length, ord = [];
        for (var i = 1; i < n; i++) ord.push(S.players[(idx + i) % n].id);   // eliminados também refutam
        S.disprove = { order: ord, idx: 0, waitingFor: null, shown: null };
        S.phase = 'disprove';
        advanceDisprove();
        return { ok: true };
      },

      disprove: function (id, a) {
        if (S.phase !== 'disprove' || !S.disprove || S.disprove.waitingFor !== id) return err('Não é a sua vez de refutar.');
        var p = P(id);
        var matches = sugCards(S.suggestion).filter(function (c) { return p.cards.indexOf(c) >= 0; });
        if (matches.indexOf(a.card) < 0) return err('Escolha uma das cartas que combinam com a sugestão.');
        showCard(p, a.card);
        return { ok: true };
      },

      endsug: function (id) {
        if (S.phase !== 'post_suggest' || !S.suggestion || S.suggestion.by !== id) return err('Nada para encerrar.');
        S.suggestion = null; S.disprove = null; S.phase = 'after';
        return { ok: true };
      },

      accuse: function (id, a) {
        if (['roll', 'move', 'action', 'after'].indexOf(S.phase) < 0) return err('Agora não dá para acusar.');
        if (SUSPECTS.indexOf(a.suspect) < 0 || WEAPONS.indexOf(a.weapon) < 0 || ROOMS.indexOf(a.room) < 0) return err('Acusação inválida.');
        var p = cur();
        var right = a.suspect === env.suspect && a.weapon === env.weapon && a.room === env.room;
        S.history.push({ type: 'accuse', n: S.history.length + 1, by: id, suspect: a.suspect, weapon: a.weapon, room: a.room, correct: right });
        S.reachable = [];
        if (right) {
          log('🏆 ' + p.name + ' resolveu o mistério!', 'win');
          finish(id, 'solved');
          return { ok: true, correct: true };
        }
        p.eliminated = true;
        log('❌ ' + p.name + ' acusou ' + a.suspect + ', ' + a.weapon + ', ' + a.room + ' e errou: está eliminado(a)', 'elim');
        var left = S.players.filter(function (x) { return !x.eliminated; });
        if (left.length === 1) {
          log('🏆 ' + left[0].name + ' é o(a) último(a) investigador(a) e vence!', 'win');
          finish(left[0].id, 'last');
        } else if (left.length === 0) {
          finish(null, 'none');
        } else {
          nextTurn();
        }
        return { ok: true, correct: false };
      },

      end: function () {
        if (S.phase !== 'action' && S.phase !== 'after') return err('Termine o que está fazendo antes.');
        nextTurn();
        return { ok: true };
      },
    };

    var MY_TURN_ONLY = { roll: 1, move: 1, skip: 1, secret: 1, suggest: 1, endsug: 1, accuse: 1, end: 1 };

    /* Ponto único de entrada: valida quem pode fazer o quê e executa. */
    function apply(id, a) {
      if (!a || typeof a.a !== 'string' || !actions[a.a]) return err('Ação desconhecida.');
      if (S.phase === 'game_over') return err('A partida já acabou.');
      var p = P(id);
      if (!p) return err('Jogador desconhecido.');
      if (MY_TURN_ONLY[a.a] && cur().id !== id) return err('Não é a sua vez.');
      if (MY_TURN_ONLY[a.a] && a.a !== 'endsug' && p.eliminated) return err('Você foi eliminado(a).');
      return actions[a.a](id, a);
    }

    /* Anfitrião destrava a partida quando quem precisa agir está offline. */
    function hostSkip() {
      if (S.phase === 'game_over') return err('A partida já acabou.');
      if (S.phase === 'disprove' && S.disprove && S.disprove.waitingFor) {
        var p = P(S.disprove.waitingFor);
        var matches = sugCards(S.suggestion).filter(function (c) { return p.cards.indexOf(c) >= 0; });
        log('⏭️ ' + p.name + ' estava offline: o anfitrião escolheu uma carta por ele(a)', 'skip');
        showCard(p, pick(matches, rng));
        return { ok: true };
      }
      log('⏭️ A vez de ' + cur().name + ' foi pulada pelo anfitrião', 'skip');
      if (S.phase === 'post_suggest') { S.suggestion = null; S.disprove = null; }
      nextTurn();
      return { ok: true };
    }

    /* Quem o jogo está esperando agora (para mostrar "Pular" ao anfitrião). */
    function waitingOn() {
      if (S.phase === 'game_over') return null;
      if (S.phase === 'disprove') return S.disprove.waitingFor;
      return cur().id;
    }

    /* Visão filtrada para cada jogador: só o que ele pode saber. */
    function view(id) {
      var me = P(id), c = cur();
      var isCur = c.id === id;
      var d = S.disprove, sg = S.suggestion;
      var mine = me ? me.cards.slice() : [];
      var options = [];
      if (S.phase === 'disprove' && d && d.waitingFor === id) {
        options = sugCards(sg).filter(function (x) { return mine.indexOf(x) >= 0; });
      }
      var ri = roomIdx(c);
      var over = S.phase === 'game_over';
      return {
        phase: S.phase, turn: S.turn, current: c.id, settings: settings,
        dice: S.dice, rollId: S.rollId,
        reachable: isCur && S.phase === 'move' ? S.reachable : [],
        canSecret: isCur && !c.eliminated && (S.phase === 'roll' || S.phase === 'move') && ri >= 0 && SECRET[ri] !== undefined,
        canSuggest: isCur && !c.eliminated && S.phase === 'action' && ri >= 0 && !(settings.noRepeat && S.lastSuggest[c.id] === ri),
        suggestion: sg, waitingFor: d ? d.waitingFor : null, options: options,
        shown: sg && d && d.shown && sg.by === id ? d.shown : null,
        hasShown: !!(d && d.shown),
        players: S.players.map(function (p) {
          return { id: p.id, name: p.name, color: p.color, pos: p.pos, eliminated: p.eliminated, cardCount: p.cards.length };
        }),
        me: { id: id, cards: mine, shown: S.shownTo[id] || [] },
        history: S.history, log: S.log.slice(-12),
        winner: S.winner, winReason: S.winReason,
        envelope: over ? S.envelope : null,
      };
    }

    return { state: S, settings: settings, apply: apply, view: view, hostSkip: hostSkip, waitingOn: waitingOn };
  }

  return {
    SUSPECTS: SUSPECTS, WEAPONS: WEAPONS, ROOMS: ROOMS, ROOM_SHORT: ROOM_SHORT, ALL_CARDS: ALL_CARDS, ICONS: ICONS,
    SECRET: SECRET, STARTS: STARTS, SIZE: SIZE,
    categoryOf: categoryOf, isRoomCell: isRoomCell, roomAt: roomAt, cellOfRoom: cellOfRoom, getReachable: getReachable,
    createEngine: createEngine,
  };
});
