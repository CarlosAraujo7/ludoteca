/* Sala compartilhada por todos os jogos: criar / entrar por código / aguardar jogadores / começar.

   Ludoteca.Lobby({
     root,                      elemento que recebe a tela (use <main class="app">)
     game, title, emoji, tagline, accent,
     min: 3, max: 6,            nº de jogadores para começar / limite da sala
     showStart: true,           false = sem botão "Começar" (ex.: página de teste)
     startLabel: 'Começar',
     showPing: false,           mostra latência e rota de cada jogador
     hubHref: '../../index.html',
     settings(session, el),     (anfitrião) monta as opções do jogo antes de começar
     extra(session, el),        conteúdo adicional na sala, para todos
     startData(session),        dados que o anfitrião envia junto com o "começar"
     onStart(session, data),    chamado em TODOS os aparelhos quando a partida começa
   })

   Se a página recarregar, a sala é retomada sozinha (código e identidade ficam salvos). */
(function (global) {
  'use strict';

  var L = global.Ludoteca;
  var util = L.util, Net = L.Net, esc = util.esc;

  L.Lobby = function (opts) {
    var root = opts.root;
    var game = opts.game;
    var min = opts.min || 2;
    var max = opts.max || 8;
    var hubHref = opts.hubHref || '../../index.html';
    var session = null;
    var started = false;
    var busy = false;

    if (opts.accent) root.style.setProperty('--accent', opts.accent);

    var api = { get session() { return session; }, destroy: destroy };

    /* ── cabeçalho comum ── */
    function titleBlock() {
      return '<div class="title-block">' +
        '<div class="emoji" aria-hidden="true">' + esc(opts.emoji || '🎲') + '</div>' +
        '<h1>' + esc(opts.title) + '</h1>' +
        (opts.tagline ? '<p>' + esc(opts.tagline) + '</p>' : '') +
        '</div>';
    }

    /* ── tela 1: entrada ── */
    function showEntry(errorText) {
      session = null; started = false; busy = false;
      var savedName = util.store.get('nome', '');
      var urlCode = util.cleanCode(util.param('sala'));
      root.innerHTML =
        '<a class="back" href="' + esc(hubHref) + '">← Ludoteca</a>' +
        titleBlock() +
        '<div class="panel stack">' +
          '<div class="field"><label for="lb-name">Seu nome</label>' +
            '<input id="lb-name" class="input" maxlength="18" autocomplete="nickname" enterkeyhint="done" value="' + esc(savedName) + '"></div>' +
          '<button class="btn btn-primary block" data-act="create">Criar sala</button>' +
          '<div class="divider">ou entre com o código</div>' +
          '<div class="field"><input id="lb-code" class="input code" maxlength="4" autocapitalize="characters" autocomplete="off" ' +
            'spellcheck="false" aria-label="Código da sala" placeholder="ABCD" value="' + esc(urlCode) + '"></div>' +
          '<button class="btn btn-ghost block" data-act="join">Entrar na sala</button>' +
          '<div class="error-line" id="lb-err" role="alert">' + esc(errorText || '') + '</div>' +
        '</div>';
      var nameEl = root.querySelector('#lb-name');
      var codeEl = root.querySelector('#lb-code');
      codeEl.addEventListener('input', function () { codeEl.value = util.cleanCode(codeEl.value); });
      codeEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
      if (urlCode && !savedName) nameEl.focus();
    }

    function setBusy(on, text) {
      busy = on;
      root.querySelectorAll('button[data-act]').forEach(function (b) { b.disabled = on; });
      var err = root.querySelector('#lb-err');
      if (err) err.textContent = on ? (text || '') : '';
      if (err && on) err.style.color = 'var(--muted)'; else if (err) err.style.color = '';
    }

    function fail(err) {
      setBusy(false);
      var el = root.querySelector('#lb-err');
      if (el) el.textContent = Net.ERR_TEXT[err && err.code] || ('Erro: ' + (err && err.message || 'desconhecido'));
    }

    function readName() {
      var name = util.cleanName(root.querySelector('#lb-name').value);
      if (!name) {
        var el = root.querySelector('#lb-err');
        if (el) el.textContent = 'Digite seu nome primeiro.';
        root.querySelector('#lb-name').focus();
        return null;
      }
      util.store.set('nome', name);
      return name;
    }

    function doCreate() {
      if (busy) return;
      var name = readName(); if (!name) return;
      setBusy(true, 'Criando a sala…');
      Net.createRoom({ game: game, name: name, max: max }).then(enterRoom, fail);
    }

    function doJoin() {
      if (busy) return;
      var name = readName(); if (!name) return;
      var code = util.cleanCode(root.querySelector('#lb-code').value);
      if (code.length !== 4) {
        root.querySelector('#lb-err').textContent = 'O código tem 4 letras.';
        root.querySelector('#lb-code').focus();
        return;
      }
      setBusy(true, 'Entrando na sala…');
      Net.joinRoom({ game: game, name: name, code: code }).then(enterRoom, fail);
    }

    /* ── retomada automática ── */
    function resume(rec) {
      root.innerHTML =
        '<a class="back" href="' + esc(hubHref) + '">← Ludoteca</a>' + titleBlock() +
        '<div class="panel stack center"><p>Voltando para a sala <b>' + esc(rec.code) + '</b>…</p>' +
        '<button class="btn btn-ghost block" data-act="cancel-resume">Cancelar</button></div>';
      var cancelled = false;
      root.querySelector('[data-act="cancel-resume"]').onclick = function () {
        cancelled = true; Net.forget(game); showEntry();
      };
      var p = rec.role === 'host'
        ? Net.createRoom({ game: game, name: rec.name, max: max, code: rec.code, pid: rec.pid })
        : Net.joinRoom({ game: game, name: rec.name, code: rec.code, pid: rec.pid });
      p.then(function (s) { if (cancelled) { s.leave(); return; } enterRoom(s); },
        function (err) {
          if (cancelled) return;
          Net.forget(game);
          showEntry(err && err.code === 'not-found' ? 'A sala anterior não existe mais.' : Net.ERR_TEXT[err && err.code]);
        });
    }

    /* ── tela 2: sala de espera ── */
    function enterRoom(s) {
      session = s;
      Net.remember(game, { code: s.code, pid: s.me.id, name: s.me.name, role: s.isHost ? 'host' : 'client' });
      util.keepAwake(true);

      root.innerHTML =
        '<button class="back" data-act="leave" style="background:none;border:0;cursor:pointer;font-family:inherit">← Sair da sala</button>' +
        titleBlock() +
        '<div class="panel code-box">' +
          '<div class="label">Código da sala</div>' +
          '<div class="code" aria-label="Código ' + esc(s.code.split('').join(' ')) + '">' + esc(s.code) + '</div>' +
          '<div class="row wrap" style="justify-content:center">' +
            '<button class="btn btn-ghost" data-act="share">📤 Convidar</button>' +
            '<button class="btn btn-ghost" data-act="qr">▦ QR code</button>' +
          '</div>' +
          '<div class="qr hidden" id="lb-qr"></div>' +
        '</div>' +
        '<div id="lb-banner"></div>' +
        '<div class="panel"><h2 id="lb-count">Jogadores</h2><ul class="players" id="lb-players"></ul></div>' +
        (s.isHost && opts.settings ? '<div class="panel"><h2>Configurações</h2><div id="lb-settings"></div></div>' : '') +
        '<div id="lb-extra"></div>' +
        '<div id="lb-start"></div>';

      if (s.isHost && opts.settings) opts.settings(s, root.querySelector('#lb-settings'));
      if (opts.extra) opts.extra(s, root.querySelector('#lb-extra'));

      s.on('players', renderRoom);
      s.on('status', onStatus);
      s.on('start', onStartMsg);
      renderRoom();
      // Voltando para uma partida já em andamento: o 'start' chegou antes de nos inscrevermos.
      if (s.started) onStartMsg(s.startData);
    }

    function connectedCount(list) {
      return list.filter(function (p) { return p.connected; }).length;
    }

    function renderRoom() {
      if (!session || started) return;
      var list = session.players || [];
      var count = root.querySelector('#lb-count');
      if (!count) return;
      count.textContent = 'Jogadores (' + list.length + (max ? '/' + max : '') + ')';

      root.querySelector('#lb-players').innerHTML = list.map(function (p) {
        var meBadge = p.id === session.me.id ? '<span class="badge soft">você</span>' : '';
        var hostBadge = p.isHost ? '<span class="badge">anfitrião</span>' : '';
        var info = '';
        if (!p.connected) info = '<span class="badge soft">offline</span>';
        else if (opts.showPing && !p.isHost) {
          info = '<span class="badge soft">' + (p.rtt ? p.rtt + ' ms' : '…') + (p.route ? ' · ' + esc(Net.routeLabel(p.route)) : '') + '</span>';
        }
        var kick = session.isHost && !p.isHost
          ? '<button class="icon-btn" data-act="kick" data-id="' + esc(p.id) + '" aria-label="Remover ' + esc(p.name) + '">✕</button>' : '';
        return '<li class="player' + (p.connected ? '' : ' off') + '">' +
          '<span class="dot" style="background:' + esc(p.color) + '"></span>' +
          '<span class="name">' + esc(p.name) + '</span>' + meBadge + hostBadge + info + kick + '</li>';
      }).join('');

      var box = root.querySelector('#lb-start');
      if (opts.showStart === false) { box.innerHTML = ''; return; }
      var n = connectedCount(list);
      if (session.isHost) {
        var ok = n >= min;
        box.innerHTML = '<button class="btn btn-primary block" data-act="start"' + (ok ? '' : ' disabled') + '>' +
          (ok ? esc(opts.startLabel || 'Começar') + ' com ' + n + ' jogadores' : 'Aguardando jogadores (' + n + '/' + min + ')') + '</button>';
      } else {
        box.innerHTML = '<p class="muted center">Aguardando o anfitrião começar…</p>';
      }
    }

    function onStatus(st, reason) {
      var banner = root.querySelector('#lb-banner');
      if (st === 'reconnecting' && banner) banner.innerHTML = '<div class="banner">Conexão perdida. Reconectando…</div>';
      else if (st === 'online' && banner) banner.innerHTML = '';
      else if (st === 'closed' && reason !== 'left') {
        util.toast(Net.ERR_TEXT[reason] || 'Você saiu da sala.', 'err');
        teardown(); showEntry();
      }
    }

    function onStartMsg(data) {
      if (started) return;
      started = true;
      session.off('players', renderRoom);
      session.off('status', onStatus);
      session.off('start', onStartMsg);
      if (opts.onStart) opts.onStart(session, data, root);
    }

    function teardown() {
      util.keepAwake(false);
      Net.forget(game);
    }

    function leave() {
      if (session) session.leave();
      teardown();
      showEntry();
    }

    /* ── cliques (delegação) ── */
    function shareUrl() {
      return global.location.origin + global.location.pathname + '?sala=' + session.code;
    }
    function onClick(e) {
      var el = e.target.closest('[data-act]');
      if (!el || !root.contains(el)) return;
      switch (el.getAttribute('data-act')) {
        case 'create': doCreate(); break;
        case 'join': doJoin(); break;
        case 'leave': leave(); break;
        case 'kick': session.host.kick(el.getAttribute('data-id')); break;
        case 'start':
          session.host.start(opts.startData ? opts.startData(session) : {});
          break;
        case 'share': {
          var url = shareUrl();
          var msg = 'Entre na minha sala de ' + opts.title + ': ' + session.code;
          if (navigator.share) navigator.share({ title: opts.title, text: msg, url: url }).catch(function () {});
          else util.copy(url).then(function (ok) { util.toast(ok ? 'Link copiado!' : url, ok ? 'ok' : ''); });
          break;
        }
        case 'qr': {
          var box = root.querySelector('#lb-qr');
          if (!box.innerHTML) {
            try {
              var qr = global.qrcode(0, 'M');
              qr.addData(shareUrl()); qr.make();
              box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: 'QR code para entrar na sala' });
            } catch (err) { box.textContent = 'Não foi possível gerar o QR code.'; }
          }
          box.classList.toggle('hidden');
          break;
        }
      }
    }
    root.addEventListener('click', onClick);

    function destroy() {
      root.removeEventListener('click', onClick);
      if (session && !started) session.leave();
    }

    /* ── início ── */
    var rec = Net.recall(game);
    if (rec) resume(rec); else showEntry();

    return api;
  };
})(window);
