/* Testes do Detetive: node tests/detetive.test.js
   Simula partidas inteiras com jogadores aleatórios e confere as propriedades que importam. */
'use strict';
const assert = require('assert');
const E = require('../jogos/detetive/engine.js');
const D = require('../jogos/detetive/deduction.js');

/* gerador pseudoaleatório com semente: falhas são reproduzíveis */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.error('  FALHOU  ' + name + '\n' + (e.stack || e)); process.exitCode = 1; }
}

/* ── tabuleiro ── */
test('alcance: de um canto com 1 passo só sai pelos corredores', () => {
  const r = E.getReachable([0, 0], 1).map(String).sort();
  assert.deepStrictEqual(r, ['0,1', '1,0']);
});
test('alcance: entrar num aposento encerra o movimento', () => {
  const r = E.getReachable([0, 0], 4).map(String);
  assert.ok(r.includes('0,2'), 'chega à sala vizinha');
  assert.ok(!r.includes('0,0'), 'não inclui a casa de partida');
});
test('alcance: com 2 dados, de dentro de um aposento, alcança em média ~6,7 dos outros 8', () => {
  const rooms = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(E.cellOfRoom);
  const dist = {}; for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) dist[a + b] = (dist[a + b] || 0) + 1 / 36;
  let sum = 0;
  rooms.forEach((rc) => Object.keys(dist).forEach((s) => {
    sum += dist[s] * E.getReachable(rc, +s).filter((x) => E.isRoomCell(x[0], x[1])).length / 9;
  }));
  assert.ok(Math.abs(sum - 6.73) < 0.05, 'média ' + sum.toFixed(2));
});

/* ── uma partida simulada ── */
function playGame(seed, n, dice, noRepeat, accuseProb) {
  const rng = mulberry32(seed);
  const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'J' + i, color: '#fff' }));
  const eng = E.createEngine({ players, dice, noRepeat, rng });
  const S = eng.state;
  const rand = (k) => Math.floor(rng() * k);
  const truthHolder = (c) => {
    if (c === S.envelope.suspect || c === S.envelope.weapon || c === S.envelope.room) return 'env';
    return S.players.find((p) => p.cards.indexOf(c) >= 0).id;
  };

  function checkInvariants() {
    // cartas: 21 no total, nenhuma repetida, mãos com diferença de no máximo 1
    const all = [S.envelope.suspect, S.envelope.weapon, S.envelope.room].concat(...S.players.map((p) => p.cards));
    assert.strictEqual(all.length, 21);
    assert.strictEqual(new Set(all).size, 21);
    const sizes = S.players.map((p) => p.cards.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, 'mãos equilibradas');

    S.players.forEach((p) => {
      const v = eng.view(p.id);
      // privacidade
      v.players.forEach((q) => assert.ok(!('cards' in q), 'visão não expõe mãos alheias'));
      assert.deepStrictEqual(v.me.cards, p.cards);
      if (S.phase !== 'game_over') assert.strictEqual(v.envelope, null, 'envelope secreto até o fim');
      if (v.options.length) assert.strictEqual(v.waitingFor, p.id, 'opções só para quem refuta');
      if (v.shown) assert.strictEqual(v.suggestion.by, p.id, 'carta mostrada só para o sugeridor');
      if (S.phase === 'disprove') assert.strictEqual(v.me.shown.filter((s) => s.n === (S.suggestion && S.suggestion.n)).length, 0);

      // dedução: sólida (a verdade sempre está entre as possibilidades)
      const a = D.analyze({ players: v.players.map((q) => ({ id: q.id, cardCount: q.cardCount })), me: p.id, myCards: v.me.cards, history: v.history, shown: v.me.shown });
      assert.strictEqual(a.inconsistent, false, 'dedução inconsistente');
      for (const c of E.ALL_CARDS) {
        const t = truthHolder(c);
        assert.ok(a.possible[c].indexOf(t) >= 0, `${p.id} concluiu que ${c} não está em ${t}`);
        if (a.holder[c]) assert.strictEqual(a.holder[c], t, `${p.id} afirmou ${c} em ${a.holder[c]} mas está em ${t}`);
      }
      ['suspect', 'weapon', 'room'].forEach((k) => {
        if (a.env[k].solved) assert.strictEqual(a.env[k].solved, S.envelope[k]);
      });
    });
  }

  function must(id, act) {
    const r = eng.apply(id, act);
    assert.ok(!r.error, `ação ${JSON.stringify(act)} de ${id} em ${S.phase}: ${r.error}`);
    return r;
  }

  let steps = 0, suggestions = 0, accusations = 0, nobody = 0;
  while (S.phase !== 'game_over') {
    if (++steps > 30000) throw new Error('partida não terminou (travou?) fase=' + S.phase);
    const cur = S.players[S.current];
    const v = eng.view(cur.id);

    // escolha do que fazer
    if (S.phase === 'disprove') {
      const w = S.disprove.waitingFor;
      assert.ok(w, 'em disprove sempre há alguém a esperar');
      const opts = eng.view(w).options;
      assert.ok(opts.length >= 2, 'só se espera quando há escolha real');
      must(w, { a: 'disprove', card: opts[rand(opts.length)] });
    } else if (S.phase === 'post_suggest') {
      must(cur.id, { a: 'endsug' });
    } else {
      // acusa se a dedução fechou o envelope; senão, às vezes arrisca
      const a = D.analyze({ players: v.players.map((q) => ({ id: q.id, cardCount: q.cardCount })), me: cur.id, myCards: v.me.cards, history: v.history, shown: v.me.shown });
      const solved = a.env.suspect.solved && a.env.weapon.solved && a.env.room.solved;
      if (solved) {
        const r = must(cur.id, { a: 'accuse', suspect: a.env.suspect.solved, weapon: a.env.weapon.solved, room: a.env.room.solved });
        assert.strictEqual(r.correct, true, 'dedução completa deve acusar certo');
        accusations++; checkInvariants(); continue;
      }
      if (S.phase !== 'roll' && rng() < accuseProb) {
        must(cur.id, { a: 'accuse', suspect: E.SUSPECTS[rand(6)], weapon: E.WEAPONS[rand(6)], room: E.ROOMS[rand(9)] });
        accusations++; checkInvariants(); continue;
      }
      if (S.phase === 'roll') {
        if (v.canSecret && rng() < 0.4) must(cur.id, { a: 'secret' }); else must(cur.id, { a: 'roll' });
      } else if (S.phase === 'move') {
        if (v.canSecret && rng() < 0.2) must(cur.id, { a: 'secret' });
        else if (rng() < 0.15 || !v.reachable.length) must(cur.id, { a: 'skip' });
        else { const t = v.reachable[rand(v.reachable.length)]; must(cur.id, { a: 'move', r: t[0], c: t[1] }); }
      } else if (S.phase === 'action') {
        if (v.canSuggest && rng() < 0.85) {
          suggestions++;
          must(cur.id, { a: 'suggest', suspect: E.SUSPECTS[rand(6)], weapon: E.WEAPONS[rand(6)] });
          if (S.phase === 'post_suggest' && !S.disprove.shown) nobody++;
        } else must(cur.id, { a: 'end' });
      } else if (S.phase === 'after') {
        must(cur.id, { a: 'end' });
      } else throw new Error('fase inesperada ' + S.phase);
    }
    checkInvariants();
  }
  assert.ok(S.winner || S.winReason === 'none', 'terminou com resultado');
  return { steps, suggestions, accusations, nobody, reason: S.winReason };
}

test('partidas simuladas: nunca travam, não vazam informação e a dedução nunca erra', () => {
  const agg = { games: 0, steps: 0, suggestions: 0, solvedByDeduction: 0 };
  const reasons = {};
  for (let n = 3; n <= 6; n++) {
    for (const dice of [1, 2]) {
      for (const noRepeat of [true, false]) {
        for (let seed = 1; seed <= 12; seed++) {
          const r = playGame(seed * 1000 + n * 10 + dice, n, dice, noRepeat, 0.04);
          agg.games++; agg.steps += r.steps; agg.suggestions += r.suggestions;
          reasons[r.reason] = (reasons[r.reason] || 0) + 1;
        }
      }
    }
  }
  console.log('       ', agg.games, 'partidas,', agg.steps, 'passos,', agg.suggestions, 'sugestões; finais:', JSON.stringify(reasons));
});

test('1 jogador (modo solo/debug) também funciona', () => {
  const r = playGame(7, 1, 2, true, 0.1);
  assert.ok(r.steps > 0);
});

/* ── regras específicas ── */
function rig(n, setup) {
  const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'J' + i, color: '#fff' }));
  const eng = E.createEngine({ players, dice: 2, noRepeat: true, rng: mulberry32(5) });
  setup && setup(eng.state);
  return eng;
}

test('uma sugestão por turno', () => {
  const eng = rig(3, (S) => { S.players[S.current].pos = [2, 2]; S.phase = 'action'; });
  const S = eng.state, id = S.players[S.current].id;
  assert.ok(!eng.apply(id, { a: 'suggest', suspect: E.SUSPECTS[0], weapon: E.WEAPONS[0] }).error);
  while (S.phase === 'disprove') eng.apply(S.disprove.waitingFor, { a: 'disprove', card: eng.view(S.disprove.waitingFor).options[0] });
  if (S.phase === 'post_suggest') eng.apply(id, { a: 'endsug' });
  assert.strictEqual(S.phase, 'after');
  assert.ok(eng.apply(id, { a: 'suggest', suspect: E.SUSPECTS[1], weapon: E.WEAPONS[1] }).error, 'segunda sugestão no mesmo turno é recusada');
});

test('regra opcional: não sugerir duas vezes seguidas no mesmo aposento', () => {
  const eng = rig(3, (S) => { S.players[S.current].pos = [2, 2]; S.phase = 'action'; });
  const S = eng.state, id = S.players[S.current].id;
  eng.apply(id, { a: 'suggest', suspect: E.SUSPECTS[0], weapon: E.WEAPONS[0] });
  while (S.phase === 'disprove') eng.apply(S.disprove.waitingFor, { a: 'disprove', card: eng.view(S.disprove.waitingFor).options[0] });
  if (S.phase === 'post_suggest') eng.apply(id, { a: 'endsug' });
  eng.apply(id, { a: 'end' });
  // dá a volta e chega de novo ao mesmo jogador, ainda no mesmo aposento
  for (let i = 0; i < 2; i++) { eng.apply(S.players[S.current].id, { a: 'roll' }); eng.apply(S.players[S.current].id, { a: 'skip' }); eng.apply(S.players[S.current].id, { a: 'end' }); }
  assert.strictEqual(S.players[S.current].id, id);
  eng.apply(id, { a: 'roll' }); eng.apply(id, { a: 'skip' });
  assert.strictEqual(eng.view(id).canSuggest, false, 'bloqueado: mesmo aposento');
  assert.ok(eng.apply(id, { a: 'suggest', suspect: E.SUSPECTS[0], weapon: E.WEAPONS[0] }).error);
});

test('passagem secreta só antes de andar, e só em aposento de canto', () => {
  const eng = rig(3, (S) => { S.players[S.current].pos = [0, 0]; });
  const S = eng.state, id = S.players[S.current].id;
  assert.strictEqual(eng.view(id).canSecret, true);
  assert.ok(!eng.apply(id, { a: 'secret' }).error);
  assert.deepStrictEqual(S.players[S.current].pos, [4, 4]);
  assert.strictEqual(S.phase, 'action');
  assert.ok(eng.apply(id, { a: 'secret' }).error, 'não vale de novo depois de usar');
  const eng2 = rig(3, (S2) => { S2.players[S2.current].pos = [2, 2]; });
  assert.ok(eng2.apply(eng2.state.players[eng2.state.current].id, { a: 'secret' }).error, 'o aposento central não tem passagem');
});

test('só o jogador da vez age; refutação só por quem é esperado', () => {
  const eng = rig(3);
  const S = eng.state, other = S.players[(S.current + 1) % 3].id;
  assert.ok(eng.apply(other, { a: 'roll' }).error);
  assert.ok(eng.apply(S.players[S.current].id, { a: 'disprove', card: 'Faca' }).error);
  assert.ok(eng.apply(other, { a: 'xyz' }).error);
});

test('acusação certa vence; errada elimina; último que sobra vence', () => {
  const eng = rig(3);
  const S = eng.state, id = S.players[S.current].id, env = S.envelope;
  const wrongS = E.SUSPECTS.find((s) => s !== env.suspect);
  assert.strictEqual(eng.apply(id, { a: 'accuse', suspect: wrongS, weapon: env.weapon, room: env.room }).correct, false);
  assert.ok(S.players.find((p) => p.id === id).eliminated);
  assert.notStrictEqual(S.players[S.current].id, id, 'a vez passa adiante');
  const id2 = S.players[S.current].id;
  eng.apply(id2, { a: 'accuse', suspect: wrongS, weapon: env.weapon, room: env.room });
  assert.strictEqual(S.phase, 'game_over');
  assert.strictEqual(S.winReason, 'last');
  assert.strictEqual(S.winner, S.players.find((p) => !p.eliminated).id);
  assert.ok(eng.view(id).envelope, 'envelope revelado ao final');
});

test('anfitrião destrava refutação de quem está offline', () => {
  for (let seed = 1; seed < 200; seed++) {
    const rng = mulberry32(seed);
    const players = [0, 1, 2, 3].map((i) => ({ id: 'p' + i, name: 'J' + i, color: '#fff' }));
    const eng = E.createEngine({ players, dice: 2, noRepeat: true, rng });
    const S = eng.state;
    S.players[S.current].pos = [2, 2]; S.phase = 'action';
    const id = S.players[S.current].id;
    // procura uma sugestão que gere escolha real (alguém com 2+ cartas combinando)
    for (const su of E.SUSPECTS) for (const w of E.WEAPONS) {
      if (S.phase !== 'action') break;
            const room = E.ROOMS[E.roomAt(2, 2)];
      const multi = S.players.some((p, i) => i !== S.current && [su, w, room].filter((c) => p.cards.indexOf(c) >= 0).length >= 2);
      if (!multi) continue;
      eng.apply(id, { a: 'suggest', suspect: su, weapon: w });
      if (S.phase === 'disprove') {
        const waiting = S.disprove.waitingFor;
        assert.ok(!eng.hostSkip().error);
        assert.ok(S.phase === 'disprove' || S.phase === 'post_suggest');
        assert.strictEqual(eng.view(id).hasShown || S.phase === 'disprove', true);
        return;
      }
    }
  }
  throw new Error('não achei um caso com escolha real em 200 sementes');
});

test('anfitrião pula o turno de quem está offline', () => {
  const eng = rig(3);
  const S = eng.state, before = S.players[S.current].id;
  assert.ok(!eng.hostSkip().error);
  assert.notStrictEqual(S.players[S.current].id, before);
  assert.strictEqual(S.phase, 'roll');
});

/* ── dedução ── */
test('dedução: quem passou não tem as cartas; quem mostrou tem uma delas', () => {
  const players = [{ id: 'a', cardCount: 6 }, { id: 'b', cardCount: 6 }, { id: 'c', cardCount: 6 }];
  const history = [{
    type: 'suggest', n: 1, by: 'a', suspect: 'Sr. Verde', weapon: 'Faca', room: 'Hall',
    replies: [{ pid: 'b', r: 'pass' }, { pid: 'c', r: 'show' }],
  }];
  const r = D.analyze({ players, me: 'a', myCards: ['Corda'], history, shown: [{ n: 1, card: 'Faca', by: 'c' }] });
  assert.deepStrictEqual(r.possible['Faca'], ['c']);
  assert.ok(r.possible['Sr. Verde'].indexOf('b') < 0);
  assert.ok(r.possible['Hall'].indexOf('b') < 0);
  assert.ok(r.possible['Faca'].indexOf('env') < 0, 'carta vista não está no envelope');
});

test('dedução: mão cheia exclui o jogador das demais cartas', () => {
  const players = [{ id: 'a', cardCount: 2 }, { id: 'b', cardCount: 2 }];
  const r = D.analyze({ players, me: 'a', myCards: ['Faca', 'Corda'], history: [], shown: [] });
  E.ALL_CARDS.filter((c) => c !== 'Faca' && c !== 'Corda').forEach((c) => assert.ok(r.possible[c].indexOf('a') < 0));
});

test('dedução: com 5 suspeitos descartados o envelope fica resolvido', () => {
  const players = [{ id: 'a', cardCount: 5 }, { id: 'b', cardCount: 5 }, { id: 'c', cardCount: 5 }];
  const mine = ['Srta. Escarlate', 'Cel. Mostarda', 'Sra. Branca', 'Sr. Verde', 'Sra. Pavão'];
  const r = D.analyze({ players, me: 'a', myCards: mine, history: [], shown: [] });
  assert.strictEqual(r.env.suspect.solved, 'Prof. Ameixa');
});

console.log('\n' + passed + ' testes passaram' + (process.exitCode ? ' (HÁ FALHAS)' : ''));
