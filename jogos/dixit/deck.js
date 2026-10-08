/* Dixit — baralho de imagens.

   As imagens NUNCA fazem parte do repositório (são arte protegida). O anfitrião escolhe os arquivos no
   próprio aparelho; aqui elas são reduzidas (480 px de largura, WebP quando o navegador sabe gerar),
   guardadas no IndexedDB do aparelho para as próximas partidas e enviadas aos outros jogadores
   por pedaços, só quando cada carta aparece para eles.                                          */
(function (global) {
  'use strict';
  var L = global.Ludoteca = global.Ludoteca || {};
  var util = L.util;
  var Deck = L.Deck = {};

  var WIDTH = 480, QUALITY = 0.78, CHUNK = 10 * 1024;      // 10 KB de bytes → ~13,7 mil caracteres em base64: cabe numa mensagem do PeerJS
  var DB = 'ludoteca', STORE = 'decks', KEY = 'dixit';

  /* WebP se o navegador conseguir gerar; senão JPEG (tamanho parecido). */
  Deck.mime = (function () {
    try {
      var c = document.createElement('canvas'); c.width = c.height = 1;
      return c.toDataURL('image/webp').indexOf('data:image/webp') === 0 ? 'image/webp' : 'image/jpeg';
    } catch (e) { return 'image/jpeg'; }
  })();

  var IMG_RE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
  function isImage(f) { return (f.type && f.type.indexOf('image/') === 0) || IMG_RE.test(f.name || ''); }
  function natural(a, b) { return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }); }

  function decode(file) {
    if (global.createImageBitmap) return createImageBitmap(file);
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('imagem inválida')); };
      img.src = url;
    });
  }
  function canvasBlob(canvas) {
    return new Promise(function (res, rej) {
      canvas.toBlob(function (b) { b ? res(b) : rej(new Error('não consegui converter')); }, Deck.mime, QUALITY);
    });
  }
  function blobBuffer(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise(function (res, rej) {
      var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsArrayBuffer(blob);
    });
  }

  /* Converte os arquivos escolhidos. Devolve { id, cards:[{id,mime,buf}], skipped:[nomes] }. */
  Deck.fromFiles = function (files, onProgress) {
    var list = Array.prototype.filter.call(files, isImage).sort(natural);
    var skipped = Array.prototype.filter.call(files, function (f) { return !isImage(f); }).map(function (f) { return f.name; });
    if (!list.length) return Promise.reject(new Error('Nenhuma imagem encontrada nos arquivos escolhidos.'));
    var cards = [];
    var chain = Promise.resolve();
    list.forEach(function (file, i) {
      chain = chain.then(function () {
        return decode(file).then(function (bmp) {
          var w = Math.min(WIDTH, bmp.width), h = Math.round(bmp.height * w / bmp.width);
          var canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
          if (bmp.close) bmp.close();
          return canvasBlob(canvas);
        }).then(blobBuffer).then(function (buf) {
          cards.push({ id: cards.length + 1, mime: Deck.mime, buf: buf });
        }, function () { skipped.push(file.name); }).then(function () {
          if (onProgress) onProgress(i + 1, list.length);
          return new Promise(function (r) { setTimeout(r, 0); });          // respira: mantém a tela responsiva
        });
      });
    });
    return chain.then(function () {
      if (!cards.length) throw new Error('Não consegui ler nenhuma das imagens.');
      return { id: util.uid(), cards: cards, skipped: skipped };
    });
  };

  Deck.url = function (card) { return URL.createObjectURL(new Blob([card.buf], { type: card.mime })); };
  Deck.bytes = function (deck) { return deck.cards.reduce(function (a, c) { return a + c.buf.byteLength; }, 0); };

  /* ── base64 em pedaços (as mensagens da rede são texto JSON) ── */
  function toB64(buf) {
    var bin = '', u8 = new Uint8Array(buf);
    for (var i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  Deck.fromB64 = function (b64) {
    var bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  };
  /* Mensagens {t:'img', c, i, n, m, d} que carregam uma carta. */
  Deck.parts = function (card) {
    var u8 = new Uint8Array(card.buf), n = Math.ceil(u8.length / CHUNK), out = [];
    for (var i = 0; i < n; i++) {
      out.push({ t: 'img', c: card.id, i: i, n: n, m: card.mime, d: toB64(u8.subarray(i * CHUNK, (i + 1) * CHUNK)) });
    }
    return out;
  };

  /* ── guardar no aparelho (IndexedDB) ── */
  function open() {
    return new Promise(function (res, rej) {
      if (!global.indexedDB) return rej(new Error('sem IndexedDB'));
      var rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore(STORE, { keyPath: 'key' }); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, mode), st = t.objectStore(STORE), out = fn(st);
        t.oncomplete = function () { db.close(); res(out && out.result !== undefined ? out.result : out); };
        t.onerror = t.onabort = function () { db.close(); rej(t.error); };
      });
    });
  }
  Deck.save = function (deck) {
    return tx('readwrite', function (st) { st.put({ key: KEY, id: deck.id, cards: deck.cards, savedAt: Date.now() }); }).then(function () { return true; }, function () { return false; });
  };
  Deck.load = function () {
    return tx('readonly', function (st) { return st.get(KEY); }).then(function (r) {
      return r && r.cards && r.cards.length ? { id: r.id, cards: r.cards, skipped: [] } : null;
    }, function () { return null; });
  };
  Deck.clear = function () {
    return tx('readwrite', function (st) { st.delete(KEY); }).then(function () { return true; }, function () { return false; });
  };
})(window);
