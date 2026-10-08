/* Utilidades compartilhadas por todos os jogos. Cria o namespace global `Ludoteca`. */
(function (global) {
  'use strict';

  var L = global.Ludoteca = global.Ludoteca || {};
  var util = L.util = {};

  /* Escapa texto antes de colocar em innerHTML. SEMPRE use para nomes de jogadores,
     pistas, respostas e qualquer coisa que venha de outro aparelho. */
  util.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  util.cleanName = function (s, max) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u001f\u007f<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max || 18);
  };

  util.uid = function () {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    var a = new Uint8Array(16);
    (global.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  };

  // Sem I e O para não confundir com 1 e 0 quando alguém dita o código.
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  util.genCode = function (len) {
    var out = '';
    for (var i = 0; i < (len || 4); i++) out += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
    return out;
  };
  util.cleanCode = function (s) {
    return String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  };

  util.param = function (name) {
    try { return new URLSearchParams(global.location.search).get(name); } catch (e) { return null; }
  };

  /* localStorage com try/catch (modo privado e iOS às vezes bloqueiam).
     "?perfil=b" na URL separa o armazenamento: permite testar dois jogadores
     no mesmo navegador sem que um sobrescreva a identidade do outro. */
  var NS = util.param('perfil') || '';
  function key(k) { return 'ludoteca:' + NS + ':' + k; }
  util.store = {
    get: function (k, def) {
      try { var v = localStorage.getItem(key(k)); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set: function (k, v) { try { localStorage.setItem(key(k), JSON.stringify(v)); } catch (e) { /* sem persistência */ } },
    del: function (k) { try { localStorage.removeItem(key(k)); } catch (e) { /* idem */ } },
  };

  util.copy = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    }
    return Promise.resolve(fallback());
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* ignora */ }
      document.body.removeChild(ta);
      return ok;
    }
  };

  var toastTimer;
  util.toast = function (msg, kind) {
    var el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3200);
  };

  /* Mantém a tela acesa (o anfitrião não pode deixar o celular bloquear:
     o navegador pausa a página e a sala cai). Reativa ao voltar para a aba. */
  var lock = null, wantAwake = false;
  function acquire() {
    if (!wantAwake || !navigator.wakeLock || document.visibilityState !== 'visible') return;
    navigator.wakeLock.request('screen').then(function (l) {
      lock = l;
      l.addEventListener('release', function () { if (lock === l) lock = null; });
    }).catch(function () { /* sem suporte ou negado */ });
  }
  document.addEventListener('visibilitychange', acquire);
  util.keepAwake = function (on) {
    wantAwake = !!on;
    if (on) acquire();
    else if (lock) { lock.release().catch(function () {}); lock = null; }
  };

  // O Chrome só deixa vibrar depois de a pessoa ter tocado na página; antes disso registra um aviso no console.
  util.vibrate = function (pattern) {
    try {
      if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(pattern || 30);
    } catch (e) { /* ok */ }
  };
})(window);
