/* Barra fina "← Ludoteca" no topo das ferramentas internas.
   Uso: <script src="../../assets/js/backbar.js"></script> no fim do <body>.
   Não aparece na impressão. */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script) return;

  var hub = new URL('../../index.html', script.src).href;

  var style = document.createElement('style');
  style.textContent =
    '#ludoteca-bar{display:flex;align-items:center;gap:8px;height:36px;padding:0 14px;' +
    'background:#0e1020;color:#cfd3ff;font:700 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;' +
    'text-decoration:none;letter-spacing:.2px}' +
    '#ludoteca-bar:hover{color:#fff}' +
    '@media print{#ludoteca-bar{display:none!important}}';
  document.head.appendChild(style);

  var bar = document.createElement('a');
  bar.id = 'ludoteca-bar';
  bar.href = hub;
  bar.textContent = '← Ludoteca';
  document.body.insertBefore(bar, document.body.firstChild);
})();
