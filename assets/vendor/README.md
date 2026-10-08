# Bibliotecas de terceiros (copiadas, sem CDN)

| Arquivo | Origem | Versão | Licença |
|---|---|---|---|
| `peerjs.min.js` | npm `peerjs` (`dist/peerjs.min.js`) | 1.5.5 | MIT (`LICENSE-peerjs.txt`) |
| `qrcode.js` | npm `qrcode-generator` (`dist/qrcode.js`) | 2.0.4 | MIT (aviso no cabeçalho do arquivo) |

Ficam no repositório para o app não depender de CDN e abrir offline.
Para atualizar: `npm pack peerjs@VERSAO` e copiar o arquivo de `dist/`.

O PeerJS usa, por padrão, o servidor de sinalização público `0.peerjs.com`, o STUN do Google e um TURN gratuito do projeto PeerJS (`*.turn.peerjs.com`).
Para usar um servidor próprio, veja `Net.broker` em `assets/js/net.js`.
