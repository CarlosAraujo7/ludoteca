# Ludoteca

Coletânea de jogos de mesa para jogar com os amigos, cada um no seu celular.
O menu lista os jogos; cada um abre na sua página. Roteiro e decisões em [docs/PLANO.md](docs/PLANO.md).

## Estrutura

```
index.html            menu principal
sw.js, manifest.*     instalável no celular e abre offline
assets/
  css/                base.css (tokens e botões) · hub.css (menu)
  css/                + ui.css (sala, listas, formulários dos jogos)
  js/                 games.js (REGISTRO DE JOGOS) · hub.js · backbar.js
                      util.js · net.js (rede P2P) · lobby.js (sala compartilhada)
  vendor/             PeerJS e gerador de QR (copiados, sem CDN)
  icons/              ícones do app
  decks/              baralhos prontos (Master, Nem a Pato)
criadores/            ferramentas de criar/imprimir cartas (uma pasta por jogo)
jogos/                jogos multiplayer (por enquanto só jogos/teste/, o diagnóstico de conexão)
docs/PLANO.md         análise, desenho dos jogos e roteiro
```

Para colocar um jogo no menu, acrescente um item em `assets/js/games.js`.
Todos os caminhos são relativos, então funciona em qualquer endereço (`usuario.github.io/qualquer-nome/`).

## Rodar no computador

Precisa de um servidor local (o `file://` não serve para o service worker e para alguns jogos):

```bash
python -m http.server 8080
```

Abra http://localhost:8080. Para testar no celular, na mesma rede Wi-Fi, abra `http://IP-DO-COMPUTADOR:8080`.
Em `http://IP:8080` o navegador do celular não é "contexto seguro": o jogo funciona, mas sem tela sempre acesa, compartilhar nativo e modo offline. O teste mais fiel é publicar no GitHub Pages (https) e abrir `jogos/teste/` em dois celulares.

## Publicar no GitHub Pages

1. Crie um repositório no GitHub e envie **o conteúdo desta pasta** (o `index.html` deve ficar na raiz do repositório).
2. No repositório: **Settings → Pages → Build and deployment → Deploy from a branch**, escolha `main` e `/ (root)`.
3. Em um ou dois minutos o site fica em `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

```bash
git init
git add .
git commit -m "Ludoteca: menu e criadores de cartas"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/NOME-DO-REPO.git
git push -u origin main
```

Atenção: o repositório do Pages é público. **Não envie as imagens das cartas do Dixit** (arte protegida por direitos autorais); o plano prevê carregá-las pelo anfitrião na hora do jogo.

## Ao alterar arquivos do menu

Se mudar a lista `SHELL` em `sw.js` ou quiser forçar atualização do cache offline, aumente `CACHE` (ex.: `ludoteca-v2`).
