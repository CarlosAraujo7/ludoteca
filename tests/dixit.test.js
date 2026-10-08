/* Testes do Dixit: node tests/dixit.test.js */
'use strict';
const assert = require('assert');
const X = require('../jogos/dixit/engine.js');

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

const mk = (n, o) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'J' + i, color: '#fff' }));
const cards = (n) => Array.from({ length: n }, (_, i) => i + 1);
function must(eng, id, act, ctx) { const r = eng.apply(id, act, ctx); assert.ok(!r.error, `${JSON.stringify(act)} por ${id}: ${r.error}`); return r; }

/* Joga uma rodada até 'results'. voteFn(voterId, view) escolhe a carta a votar. */
function playToResults(eng, voteFn) {
  const S = eng.state, st = S.players[S.st].id;
  const sv = eng.view(st);
  must(eng, st, { a: 'clue', card: sv.hand[0], text: 'uma pista' });
  S.players.filter((p) => p.id !== st).forEach((p) => {
    const v = eng.view(p.id);
    must(eng, p.id, { a: 'pick', cards: v.hand.slice(0, eng.settings.cpt) });
  });
  assert.strictEqual(S.phase, 'vote');
  S.players.filter((p) => p.id !== st).forEach((p) => must(eng, p.id, { a: 'vote', card: voteFn(p.id, eng.view(p.id)) }));
  assert.strictEqual(S.phase, 'results');
}

/* pontuação calculada de forma independente a partir do que está na visão */
function expectedPoints(v) {
  const voters = v.players.filter((p) => p.id !== v.storyteller);
  const votedFor = {};
  v.table.forEach((e) => e.voters.forEach((id) => { votedFor[id] = e.card; }));
  const correct = voters.filter((p) => votedFor[p.id] === v.stCard).length;
  const exp = {};
  v.players.forEach((p) => { exp[p.id] = 0; });
  if (correct === 0 || correct === voters.length) voters.forEach((p) => { exp[p.id] += 2; });
  else { exp[v.storyteller] += 3; voters.forEach((p) => { if (votedFor[p.id] === v.stCard) exp[p.id] += 3; }); }
  v.table.forEach((e) => { if (e.owner !== v.storyteller) exp[e.owner] += e.voters.length; });
  return exp;
}

/* ── regras de pontuação ── */
test('ninguém acerta: narrador 0, os outros +2, mais +1 por voto recebido', () => {
  const eng = X.createEngine({ players: mk(4), cards: cards(84), cpt: 1, target: 30, rng: mulberry32(1) });
  const S = eng.state, st = S.players[S.st].id;
  // todos votam na carta do jogador seguinte (que não é a do narrador)
  playToResults(eng, (id, v) => {
    const other = v.table.find((e) => e.card !== S.stCard && !v.myTable.includes(e.card));
    return other.card;
  });
  const v = eng.view(st), exp = expectedPoints(v);
  assert.strictEqual(v.round.allOrNone, true);
  assert.strictEqual(v.round.points[st].total, 0);
  S.players.forEach((p) => assert.strictEqual(v.round.points[p.id].total, exp[p.id], p.id));
  S.players.forEach((p) => assert.strictEqual(p.score, exp[p.id]));
});

test('todos acertam: narrador 0, os outros +2, sem bônus', () => {
  const eng = X.createEngine({ players: mk(5), cards: cards(84), cpt: 1, target: 30, rng: mulberry32(2) });
  const S = eng.state, st = S.players[S.st].id;
  playToResults(eng, () => S.stCard);
  S.players.forEach((p) => assert.strictEqual(p.score, p.id === st ? 0 : 2));
});

test('acerto parcial: narrador e quem acertou +3, bônus por votos nas próprias cartas', () => {
  const eng = X.createEngine({ players: mk(4), cards: cards(84), cpt: 1, target: 30, rng: mulberry32(3) });
  const S = eng.state, st = S.players[S.st].id;
  const voters = S.players.filter((p) => p.id !== st).map((p) => p.id);
  playToResults(eng, (id, v) => {
    if (id === voters[0]) return S.stCard;                                     // acerta
    const other = v.table.find((e) => e.card !== S.stCard && !v.myTable.includes(e.card));
    return other.card;                                                          // erra
  });
  const v = eng.view(st), exp = expectedPoints(v);
  assert.strictEqual(v.round.allOrNone, false);
  assert.strictEqual(v.round.points[st].base, 3);
  assert.strictEqual(v.round.points[voters[0]].base, 3);
  S.players.forEach((p) => assert.strictEqual(p.score, exp[p.id], p.id));
});

/* ── validações ── */
test('não vota na própria carta, nem duas vezes; narrador não vota', () => {
  const eng = X.createEngine({ players: mk(3), cards: cards(84), cpt: 2, target: 30, rng: mulberry32(4) });
  const S = eng.state, st = S.players[S.st].id;
  must(eng, st, { a: 'clue', card: eng.view(st).hand[0], text: 'x' });
  S.players.filter((p) => p.id !== st).forEach((p) => must(eng, p.id, { a: 'pick', cards: eng.view(p.id).hand.slice(0, 2) }));
  const voter = S.players.find((p) => p.id !== st).id, vv = eng.view(voter);
  assert.strictEqual(vv.myTable.length, 2, 'no modo de 2 cartas há 2 cartas próprias na mesa');
  assert.ok(eng.apply(voter, { a: 'vote', card: vv.myTable[0] }).error, 'voto na própria carta recusado');
  assert.ok(eng.apply(voter, { a: 'vote', card: vv.myTable[1] }).error, 'também a segunda');
  assert.ok(eng.apply(st, { a: 'vote', card: vv.table[0].card }).error, 'narrador não vota');
  const ok = vv.table.find((e) => !vv.myTable.includes(e.card));
  must(eng, voter, { a: 'vote', card: ok.card });
  assert.ok(eng.apply(voter, { a: 'vote', card: ok.card }).error, 'voto duplicado recusado');
});

test('valida pista, carta da mão e quantidade de cartas', () => {
  const eng = X.createEngine({ players: mk(4), cards: cards(84), cpt: 1, target: 30, rng: mulberry32(5) });
  const S = eng.state, st = S.players[S.st].id, other = S.players.find((p) => p.id !== st).id;
  assert.ok(eng.apply(other, { a: 'clue', card: eng.view(other).hand[0], text: 'x' }).error, 'só o narrador dá pista');
  assert.ok(eng.apply(st, { a: 'clue', card: eng.view(st).hand[0], text: '   ' }).error, 'pista vazia');
  assert.ok(eng.apply(st, { a: 'clue', card: 9999, text: 'x' }).error, 'carta fora da mão');
  assert.ok(!eng.apply(st, { a: 'clue', card: eng.view(st).hand[0], text: '<b>oi</b>  mundo' }).error);
  assert.strictEqual(S.clue, 'boi/b mundo', 'pista higienizada');
  assert.ok(eng.apply(other, { a: 'pick', cards: [] }).error, 'quantidade errada');
  const h = eng.view(other).hand;
  assert.ok(eng.apply(other, { a: 'pick', cards: [h[0], h[0]] }).error);
  assert.ok(eng.apply(other, { a: 'pick', cards: [12345] }).error, 'carta que não é sua');
  must(eng, other, { a: 'pick', cards: [h[0]] });
  assert.ok(eng.apply(other, { a: 'pick', cards: [h[1]] }).error, 'não envia duas vezes');
});

test('exige baralho suficiente e de 3 a 6 jogadores', () => {
  assert.throws(() => X.createEngine({ players: mk(2), cards: cards(84) }));
  assert.throws(() => X.createEngine({ players: mk(7), cards: cards(84) }));
  assert.throws(() => X.createEngine({ players: mk(6), cards: cards(20) }), /pequeno/);
  assert.strictEqual(X.defaultCpt(3), 2);
  assert.strictEqual(X.defaultCpt(4), 1);
  assert.strictEqual(X.minCards(4, 1), 4 * 6 + 8);
});

/* ── privacidade ── */
test('visões não vazam mão alheia, donos das cartas nem a carta do narrador antes da hora', () => {
  const eng = X.createEngine({ players: mk(4), cards: cards(84), cpt: 1, target: 30, rng: mulberry32(6) });
  const S = eng.state, st = S.players[S.st].id;
  const nonSt = S.players.find((p) => p.id !== st).id;
  assert.strictEqual(eng.view(nonSt).stCard, null);
  must(eng, st, { a: 'clue', card: eng.view(st).hand[0], text: 'x' });
  assert.strictEqual(eng.view(nonSt).stCard, null, 'não narradores não veem a carta durante a escolha');
  assert.ok(eng.view(st).stCard, 'o narrador vê a própria carta');
  S.players.filter((p) => p.id !== st).forEach((p) => must(eng, p.id, { a: 'pick', cards: eng.view(p.id).hand.slice(0, 1) }));
  S.players.forEach((p) => {
    const v = eng.view(p.id);
    v.table.forEach((e) => assert.ok(!('owner' in e), 'dono oculto na votação'));
    assert.deepStrictEqual(v.hand, S.players.find((q) => q.id === p.id).hand);
    v.players.forEach((q) => assert.ok(!('hand' in q)));
    assert.ok(v.need.every((c) => v.hand.includes(c) || v.table.some((e) => e.card === c) || c === v.stCard || v.myPick.includes(c)), 'need só lista cartas visíveis');
  });
  assert.strictEqual(eng.view(nonSt).stCard, null, 'ainda oculta durante a votação');
});

/* ── partidas completas ── */
function randomGame(seed, n, cpt, target, deckSize) {
  const rng = mulberry32(seed), R = (k) => Math.floor(rng() * k);
  const eng = X.createEngine({ players: mk(n), cards: cards(deckSize), cpt, target, rng });
  const S = eng.state, N = deckSize;
  let rounds = 0;
  function conservation() {
    const inHands = S.players.reduce((a, p) => a + p.hand.length, 0);
    const submitted = (S.phase === 'pick_card' || S.phase === 'vote') ? Object.keys(S.submitted).reduce((a, k) => a + S.submitted[k].length, 0) : 0;
    assert.strictEqual(inHands + submitted + S.deck.length + S.discard.length, N, 'cartas conservadas na fase ' + S.phase);
    const all = [].concat(S.deck, S.discard, ...S.players.map((p) => p.hand));
    if (S.phase === 'pick_card' || S.phase === 'vote') Object.keys(S.submitted).forEach((k) => all.push(...S.submitted[k]));
    assert.strictEqual(new Set(all).size, N, 'nenhuma carta duplicada');
  }
  while (S.phase !== 'game_over') {
    if (++rounds > 400) throw new Error('partida longa demais');
    conservation();
    const st = S.players[S.st].id;
    const start = S.players.map((p) => p.score);
    must(eng, st, { a: 'clue', card: eng.view(st).hand[R(eng.view(st).hand.length)], text: 'pista ' + rounds });
    conservation();
    S.players.filter((p) => p.id !== st).forEach((p) => {
      const h = eng.view(p.id).hand.slice(); const pick = [];
      for (let i = 0; i < cpt; i++) pick.push(h.splice(R(h.length), 1)[0]);
      must(eng, p.id, { a: 'pick', cards: pick });
    });
    conservation();
    S.players.filter((p) => p.id !== st).forEach((p) => {
      const v = eng.view(p.id), opts = v.table.filter((e) => !v.myTable.includes(e.card));
      must(eng, p.id, { a: 'vote', card: opts[R(opts.length)].card });
    });
    // pontuação confere com a fórmula independente
    const v = eng.view(st), exp = expectedPoints(v);
    S.players.forEach((p, i) => assert.strictEqual(p.score, start[i] + exp[p.id], 'placar acumulado de ' + p.id));
    S.players.forEach((p) => assert.strictEqual(v.round.points[p.id].total, exp[p.id], 'pontos da rodada de ' + p.id));
    conservation();
    S.players.forEach((p) => must(eng, p.id, { a: 'ready' }));
  }
  assert.ok(S.winners.length >= 1);
  const top = Math.max(...S.players.map((p) => p.score));
  assert.ok(top >= target);
  S.winners.forEach((id) => assert.strictEqual(S.players.find((p) => p.id === id).score, top));
  return rounds;
}

test('partidas completas (3–6 jogadores, 1 e 2 cartas): cartas conservadas, pontos corretos, termina', () => {
  let games = 0, rounds = 0;
  for (let n = 3; n <= 6; n++) for (const cpt of [1, 2]) for (let seed = 1; seed <= 15; seed++) {
    rounds += randomGame(seed * 97 + n * 7 + cpt, n, cpt, 10 + (seed % 4) * 10, 84); games++;
  }
  console.log('       ', games, 'partidas,', rounds, 'rodadas');
});

test('baralho mínimo: o descarte é reembaralhado e a partida segue', () => {
  for (let n = 3; n <= 6; n++) for (const cpt of [1, 2]) {
    const min = X.minCards(n, cpt);
    randomGame(n * 31 + cpt, n, cpt, 40, min);
  }
});

/* ── anfitrião destrava quem está offline ── */
test('anfitrião joga por quem sumiu em cada fase', () => {
  const rng = mulberry32(9);
  const eng = X.createEngine({ players: mk(4), cards: cards(84), cpt: 1, target: 30, rng });
  const S = eng.state;
  // narrador offline
  const st0 = S.players[S.st].id;
  assert.deepStrictEqual(eng.waitingOn(), [st0]);
  assert.ok(!eng.hostSkip(st0).error);
  assert.notStrictEqual(S.players[S.st].id, st0);
  // dar a pista e deixar todos offline na escolha
  const st = S.players[S.st].id;
  must(eng, st, { a: 'clue', card: eng.view(st).hand[0], text: 'x' });
  eng.waitingOn().forEach((id) => assert.ok(!eng.hostSkip(id).error));
  assert.strictEqual(S.phase, 'vote');
  eng.waitingOn().forEach((id) => assert.ok(!eng.hostSkip(id).error));
  assert.strictEqual(S.phase, 'results');
  assert.ok(!eng.forceNext().error);
  assert.strictEqual(S.phase, 'give_clue');
  assert.ok(eng.hostSkip('desconhecido').error, 'jogador inexistente');
});

test('"pronto" só considera quem está online', () => {
  const eng = X.createEngine({ players: mk(4), cards: cards(84), cpt: 1, target: 30, rng: mulberry32(10) });
  const S = eng.state;
  playToResults(eng, (id, v) => v.table.find((e) => !v.myTable.includes(e.card)).card);
  const ids = S.players.map((p) => p.id), online = ids.slice(0, 3);
  online.forEach((id) => must(eng, id, { a: 'ready' }, { connected: online }));
  assert.strictEqual(S.phase, 'give_clue', 'avança sem esperar o offline');
});

test('recheck: quem faltava dizer "pronto" saiu da sala, então a rodada avança', () => {
  const eng = X.createEngine({ players: mk(4), cards: cards(84), cpt: 1, target: 30, rng: mulberry32(11) });
  const S = eng.state;
  playToResults(eng, (id, v) => v.table.find((e) => !v.myTable.includes(e.card)).card);
  const ids = S.players.map((p) => p.id);
  ids.slice(0, 3).forEach((id) => must(eng, id, { a: 'ready' }));
  assert.strictEqual(S.phase, 'results');
  assert.strictEqual(eng.recheck({ connected: ids }), false);
  assert.strictEqual(eng.recheck({ connected: ids.slice(0, 3) }), true);
  assert.strictEqual(S.phase, 'give_clue');
});

console.log('\n' + passed + ' testes passaram' + (process.exitCode ? ' (HÁ FALHAS)' : ''));
