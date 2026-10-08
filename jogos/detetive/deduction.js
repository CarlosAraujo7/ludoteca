/* Detetive — assistente de dedução da caderneta (puro: sem DOM).

   Parte só do que o jogador PODE saber: as próprias cartas, as cartas que lhe mostraram,
   e o histórico público (quem sugeriu o quê, quem passou, quem mostrou, acusações erradas).
   Propaga as regras até não haver mais o que concluir:

   - passou numa sugestão  → não tem nenhuma das 3 cartas;
   - mostrou uma carta     → tem pelo menos uma das 3 (e, se foi para mim, eu sei qual);
   - mão cheia             → quando todas as cartas de um jogador já foram identificadas,
                             ele não tem mais nenhuma; quando só restam tantas candidatas
                             quanto o tamanho da mão, ele tem todas;
   - envelope              → exatamente 1 suspeito, 1 arma e 1 aposento;
   - acusação errada       → as 3 cartas não estão todas no envelope.

   É sólido (nunca conclui algo falso), mas não é completo: pode deixar de ver deduções
   que exigem combinar muitas hipóteses. Para isso existe o seu cérebro.                      */
(function (root, factory) {
  var api = factory(typeof module === 'object' && module.exports ? require('./engine.js') : root.Ludoteca.Detetive);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    var L = root.Ludoteca = root.Ludoteca || {};
    L.Detetive = Object.assign(L.Detetive || {}, api);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (E) {
  'use strict';

  var ENV = 'env';
  var CATS = { suspect: E.SUSPECTS, weapon: E.WEAPONS, room: E.ROOMS };

  /* players: [{id, cardCount}]   me: id   myCards: [..]
     history: entradas do engine   shown: [{n, card, by}] (cartas que me mostraram)          */
  function analyze(input) {
    var players = input.players, me = input.me, myCards = input.myCards || [];
    var history = input.history || [], shown = input.shown || [];
    var ids = players.map(function (p) { return p.id; });
    var size = {};
    players.forEach(function (p) { size[p.id] = p.cardCount; });

    var possible = {};
    E.ALL_CARDS.forEach(function (c) {
      possible[c] = {};
      ids.concat([ENV]).forEach(function (h) { possible[c][h] = true; });
    });

    var inconsistent = false;
    function count(c) { return Object.keys(possible[c]).length; }
    function only(c) { var k = Object.keys(possible[c]); return k.length === 1 ? k[0] : null; }
    function has(c, h) { return !!possible[c][h]; }
    function drop(c, h) {
      if (!possible[c][h]) return false;
      delete possible[c][h];
      if (count(c) === 0) inconsistent = true;
      return true;
    }
    function setOnly(c, h) {
      var changed = false;
      Object.keys(possible[c]).forEach(function (k) { if (k !== h) { delete possible[c][k]; changed = true; } });
      if (!possible[c][h]) { possible[c][h] = true; changed = true; inconsistent = true; }
      return changed;
    }

    /* ── fatos de partida ── */
    myCards.forEach(function (c) { setOnly(c, me); });
    E.ALL_CARDS.forEach(function (c) { if (myCards.indexOf(c) < 0) drop(c, me); });
    shown.forEach(function (s) { setOnly(s.card, s.by); });

    var clauses = [];                    // "holder tem pelo menos uma destas cartas"
    var accusations = [];                // acusações erradas: [s,w,r]
    history.forEach(function (h) {
      if (h.type === 'accuse') { if (!h.correct) accusations.push([h.suspect, h.weapon, h.room]); return; }
      var cards = [h.suspect, h.weapon, h.room];
      (h.replies || []).forEach(function (r) {
        if (r.r === 'pass') cards.forEach(function (c) { drop(c, r.pid); });
        else if (r.r === 'show' && r.pid !== me) {
          var known = h.by === me && shown.some(function (s) { return s.n === h.n; });
          if (!known) clauses.push({ holder: r.pid, cards: cards });
        }
      });
    });

    /* ── propagação até o ponto fixo ── */
    var changed = true, guard = 0;
    while (changed && guard++ < 500 && !inconsistent) {
      changed = false;

      clauses.forEach(function (cl) {
        var cand = cl.cards.filter(function (c) { return has(c, cl.holder); });
        if (cand.length === 1 && count(cand[0]) > 1) { setOnly(cand[0], cl.holder); changed = true; }
      });

      ids.forEach(function (id) {
        var certain = E.ALL_CARDS.filter(function (c) { return only(c) === id; });
        if (certain.length >= size[id]) {
          E.ALL_CARDS.forEach(function (c) { if (only(c) !== id && has(c, id) && drop(c, id)) changed = true; });
        }
        var cand = E.ALL_CARDS.filter(function (c) { return has(c, id); });
        if (cand.length === size[id]) {
          cand.forEach(function (c) { if (count(c) > 1 && setOnly(c, id)) changed = true; });
        }
      });

      Object.keys(CATS).forEach(function (k) {
        var cards = CATS[k];
        var inEnv = cards.filter(function (c) { return has(c, ENV); });
        if (inEnv.length === 1 && count(inEnv[0]) > 1) { setOnly(inEnv[0], ENV); changed = true; }
        var fixed = cards.filter(function (c) { return only(c) === ENV; })[0];
        if (fixed) cards.forEach(function (c) { if (c !== fixed && has(c, ENV) && drop(c, ENV)) changed = true; });
        cards.forEach(function (c) {
          var o = only(c);
          if (o && o !== ENV && has(c, ENV) && drop(c, ENV)) changed = true;
        });
      });

      accusations.forEach(function (a) {
        var sure = a.filter(function (c) { return only(c) === ENV; });
        if (sure.length === 2) {
          var third = a.filter(function (c) { return only(c) !== ENV; })[0];
          if (third && has(third, ENV) && drop(third, ENV)) changed = true;
        }
      });
    }

    /* ── resultado ── */
    var holder = {}, poss = {}, env = {};
    E.ALL_CARDS.forEach(function (c) {
      holder[c] = only(c);
      poss[c] = Object.keys(possible[c]);
    });
    Object.keys(CATS).forEach(function (k) {
      var inEnv = CATS[k].filter(function (c) { return has(c, ENV); });
      env[k] = { solved: inEnv.length === 1 ? inEnv[0] : null, candidates: inEnv };
    });
    return { holder: holder, possible: poss, env: env, inconsistent: inconsistent };
  }

  return { analyze: analyze, ENV: ENV };
});
