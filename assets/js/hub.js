/* Monta o menu principal a partir de LUDOTECA_GAMES (ver games.js). */
(function () {
  'use strict';

  var games = window.LUDOTECA_GAMES || [];
  var sections = window.LUDOTECA_SECTIONS || [];
  var app = document.getElementById('app');

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function action(a) {
    var cls = 'btn ' + (a.type === 'play' ? 'btn-primary' : 'btn-ghost');
    if (a.status === 'soon') {
      return el('button', {
        class: cls, type: 'button', disabled: '', text: a.label + ' · em breve',
        title: 'Este jogo ainda está sendo adaptado para rodar no celular.',
      });
    }
    return el('a', { class: cls, href: a.href, text: a.label });
  }

  function tile(g) {
    var chips = el('ul', { class: 'chips' }, (g.chips || []).map(function (c) {
      return el('li', { text: c });
    }));
    var tileEl = el('article', { class: 'tile', id: 'jogo-' + g.id }, [
      el('div', { class: 'tile-head' }, [
        el('div', { class: 'tile-icon', 'aria-hidden': 'true', text: g.emoji }),
        el('div', { class: 'tile-title' }, [
          el('h3', { text: g.title }),
          el('p', { text: g.tagline }),
        ]),
      ]),
      el('p', { class: 'tile-desc', text: g.desc }),
      chips,
      el('div', { class: 'tile-actions' }, g.actions.map(action)),
    ]);
    tileEl.style.setProperty('--accent', g.accent);
    return tileEl;
  }

  sections.forEach(function (s) {
    var items = games.filter(function (g) { return g.kind === s.kind; });
    if (!items.length) return;
    app.appendChild(el('section', { class: 'section', 'aria-labelledby': 'sec-' + s.kind }, [
      el('div', { class: 'section-head' }, [
        el('h2', { id: 'sec-' + s.kind, text: s.title }),
        el('p', { text: s.sub }),
      ]),
      el('div', { class: 'grid' }, items.map(tile)),
    ]));
  });

  // PWA: só funciona em https ou localhost; em outros casos o menu segue normal.
  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* sem offline, sem problema */ });
  }
})();
