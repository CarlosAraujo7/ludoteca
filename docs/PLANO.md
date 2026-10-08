# Plano da Ludoteca

Coletânea de jogos de mesa para o celular, publicada no GitHub Pages, com menu único.
Os três criadores de cartas (Master, Perfil 7, Nem a Pato) viram jogos: a IA gera as cartas de cada jogador e uma tela comum conduz a partida.

> Estado: **Passos 1 e 2 concluídos** (menu, criadores integrados, camada de rede P2P, sala compartilhada e página de teste). Os jogos multiplayer ainda aparecem como "em breve".

### Decisões já tomadas
- **F.D.P. fora do projeto:** removido da coletânea por decisão do usuário.
- **IA:** os dois modos — "copiar e colar" (sem chave) e "chave do anfitrião".
- **Dixit:** o anfitrião carrega a pasta de imagens na hora do jogo; as cartas nunca entram no repositório.
- **Rede:** P2P pelo PeerJS (sinalização pública gratuita), atrás da camada `net`.
- **Nem a Pato (regras confirmadas):** os jogadores vão chutando valores em ordem crescente; quando alguém acha o último chute absurdo, diz "Nem a Pato!". Revela-se o valor real e vence quem chegou **mais perto sem ultrapassar** o valor real. (Falta confirmar como os patos viram pontos; hipótese: o vencedor da pergunta leva os patos da carta.)

---

## 1. Restrição central: GitHub Pages é estático

Dixit, Detetive, Adedonha e Banco Imobiliário dependem de um servidor Python (Flask + Socket.IO). Isso **não roda** no GitHub Pages.

**Proposta:** o navegador de quem cria a sala vira o servidor (WebRTC peer-to-peer). Cada `GameRoom` Python é portado para uma classe JS quase 1:1, e o `public_state(for_sid)` (visão filtrada por jogador) vira uma mensagem por jogador. A rede fica atrás de **uma camada só** (`net`): se o P2P der problema, troca-se por Firebase/Supabase sem mexer nos jogos.

Riscos conhecidos:
- Em algumas redes móveis (NAT simétrico/CGNAT) a conexão direta pode falhar. O PeerJS já usa o STUN do Google e um TURN gratuito do próprio projeto como reserva, mas é "melhor esforço". A página `jogos/teste/` mostra se cada jogador está em conexão direta ou via relay. **Ainda não foi testado com celulares reais em 4G.**
- O anfitrião tecnicamente "vê tudo" (ex.: o envelope do Detetive). Aceitável entre amigos.
- Se o anfitrião fechar o app, a sala acaba. Mitigação: salvar o estado no `localStorage` e permitir retomar.

## 2. Análise por jogo (o que encontrei no código atual)

### Detetive
- **Não cabe no celular:** painel lateral fixo de 185 px + célula mínima de 58 px → tabuleiro de ~302 px numa área de ~190 px (tela de 375 px). Fica cortado.
- **Nomes sem escape** (`${p.name}` em `innerHTML`): com P2P, um nome malicioso executaria código nos outros aparelhos. O Dixit já usa `esc()`.
- **Histórico pobre:** o servidor manda só os últimos 10 eventos, em texto. Dedução depende de lembrar *quem passou, quem mostrou e para quem*. → histórico estruturado completo + caderneta que deduz sozinha.
- **Movimento irrelevante:** com 2d6 num tabuleiro 5×5, de dentro de um aposento dá para chegar a ~6,7 dos outros 8 (todos os 8 em 42% das vezes). Com 1d6 cai para ~3,6. → opção de 1 dado.
- **Trava** se um jogador desconecta na vez dele ou na refutação (não existe "pular jogador").
- Reconexão manual (botão); o Dixit reconecta sozinho. → unificar.
- Limite de 4 jogadores, embora existam 6 suspeitos. → 3–6.
- Regra clássica ausente: a sugestão não puxa o peão do suspeito para o aposento (opcional).

### Dixit
- **17,2 MB de imagens** (84 JPEG 684×989). Medido numa amostra: ~21 KB/carta em WebP 340 px → **~1,8 MB** no total.
- **Direitos autorais:** as cartas são arte da Libellud. Não devem ir para um repositório público. → o anfitrião carrega o baralho (pasta de imagens) no início e ele é enviado aos outros por P2P; opção de baralho gerado por IA.
- Limite de 4 jogadores/4 cores (o jogo oficial vai de 3 a 6). → 3–6.
- Trava se alguém desconecta durante a votação.
- A pontuação (3/3/+1, regra "todos ou ninguém") e a variante de 3 jogadores com 2 cartas **já seguem o regulamento oficial**. Manter.

### Adedonha
- Uma única partida global por servidor (sem salas). No P2P cada sala é independente.
- Pontuação semi-automática já é boa (normaliza acentos, 10/5 pontos, invalidação manual). Ideia: IA como desempate em respostas contestadas.

### Banco Imobiliário
- Também uma única partida global. Vira uma sala P2P; a lógica é pequena.

### Criadores de cartas (Master, Perfil 7, Nem a Pato)
- Já estão no menu e funcionam. São ferramentas de **impressão em A4**, pensadas para desktop: continuam assim e serão o passo "imprimir o baralho da noite".
- Os 3 já têm prompt para IA e formato de dados próprio (XML/JSON). Esses formatos viram o esquema que a IA preenche no jogo.
- Perfil 7 não tem baralho pronto (só gerador). Master tem 100 cartas e Nem a Pato 100 (em `assets/decks/`).

## 3. Das cartas ao jogo

Mecanismo comum ("Mesa"):

1. **Sala:** um jogador cria, os outros entram por código/QR. Um aparelho pode ser a **tela comum** (TV/notebook, texto grande); os celulares são os controles (estilo Jackbox).
2. **Criação:** cada jogador descreve o que quer ("filmes dos anos 90", "nossa turma da faculdade"). A IA devolve cartas no formato do jogo; o jogador revisa, edita e descarta no celular. O conteúdo fica secreto até ser jogado.
3. **Autoria conta:** as cartas de cada um vão para um pool embaralhado e **o autor não responde as próprias** (como o narrador do Dixit). O autor pontua quando a carta é bem calibrada.
4. **Partida:** a tela comum libera as dicas/perguntas e avança as rodadas; os celulares respondem.
5. **Fim:** ranking + **exportar o baralho da noite** no formato dos criadores atuais, para imprimir as melhores cartas.

Por jogo:

| Jogo | Na tela comum | No celular | Observação |
|---|---|---|---|
| **Perfil 7** | libera a dica 1→20 no ritmo escolhido | "Palpitar" com texto; errou, fica fora daquela carta | pontos = 21 − nº da dica; autor ganha se alguém acertar entre as dicas 8–14 (carta calibrada) |
| **Master** | pergunta + 4 alternativas; (modo tabuleiro: anel de 42 casas, 6 raios, casas HQ, "Vou ao Master!") | responde a/b/c/d | duas versões: **tabuleiro fiel às regras do PDF** e **rápido** (todos respondem juntos, bônus de velocidade) |
| **Nem a Pato** | pergunta numérica, depois a resposta real + curiosidade | digita o palpite | **regras a confirmar** (hipótese: vence o palpite mais próximo; patos = pontos pela dificuldade) |

## 4. Módulo de IA (`llm`)

Uma interface só, `gerar(esquema, pedido)`, com três modos:

1. **Copiar e colar** (sem chave): o app monta o prompt (os criadores já têm), a pessoa cola numa IA qualquer e traz o JSON de volta. Grátis, funciona sempre.
2. **Chave do anfitrião:** só o anfitrião cola uma chave de API; os pedidos dos outros viajam por P2P até ele, que chama a IA e devolve as cartas. Uma chave por mesa.
3. (Futuro) um proxy próprio.

A chave fica só no navegador do anfitrião. Validação do JSON recebido, repetição automática em caso de erro, e aviso para usar uma chave com limite de gasto baixo. Provedores e CORS (chamada direta do navegador) a validar no Passo 6.

## 5. Roteiro

| Passo | Entrega | Estado |
|---|---|---|
| 1 | Menu + estrutura + criadores integrados + PWA + guia de publicação | ✅ |
| 2 | Camada de rede P2P + sala/código/QR + página de teste | ✅ (testado com 2 abas; falta testar com celulares reais) |
| 3 | **Detetive** reescrito (celular, histórico, caderneta automática, 3–6, reconexão, pular jogador) | |
| 4 | **Dixit** (baralho do anfitrião em WebP, 3–6, reconexão) | |
| 5 | Adedonha e Banco Imobiliário em salas P2P | |
| 6 | Módulo de IA + **Perfil 7** online (primeiro jogo "carta → jogo") | |
| 7 | Master online (tabuleiro + rápido) | |
| 8 | Nem a Pato online | |
| 9 | Acabamento: som, vibração, acessibilidade, temas | |

Cada passo termina com algo jogável e testado no celular antes de seguir.

## 6. Camada de rede (Passo 2) — o que existe

| Arquivo | Função |
|---|---|
| `assets/js/net.js` | `Net.createRoom` / `Net.joinRoom`. Anfitrião e convidado têm a mesma interface de sessão (`send`, `on('message'|'players'|'status'|'start')`); o anfitrião também é jogador. Reconexão automática, batimento (ping/pong), jogador que some no lobby sai da sala, identidade fixa por jogador, rota da conexão (mesma rede / direta / relay). |
| `assets/js/lobby.js` | Tela de criar/entrar, sala de espera com código, convite por link/QR, lista de jogadores, remover jogador, botão começar. Retoma a sala sozinho se a página recarregar. |
| `assets/js/util.js` | `esc` (escape de HTML — obrigatório para qualquer texto vindo de outro jogador), códigos, `localStorage` seguro, tela sempre acesa (anfitrião), toast. |
| `jogos/teste/` | Diagnóstico: bate-papo, latência, rota, simular queda e início de partida. |

Verificado em duas abas do navegador pela nuvem pública do PeerJS: criar/entrar por código, mensagens nos dois sentidos (com HTML escapado), queda e reconexão automática (~2 s), recarregar convidado (volta com a mesma identidade), recarregar anfitrião (volta com o mesmo código e o convidado se religa), iniciar partida (inclusive para quem recarrega depois), remover jogador, anfitrião encerrando a sala, código inexistente e entrada após o início.

Limites conhecidos:
- Mensagens devem ter menos de ~48 KB; o baralho do Dixit precisará ser enviado em pedaços (Passo 4).
- Se o anfitrião recarregar, a sala volta, mas o estado de uma partida em andamento só sobrevive se o jogo o salvar (cada jogo fará isso).
- Dois jogadores no mesmo navegador precisam de `?perfil=a` / `?perfil=b` na URL para não compartilharem identidade (só para testes).
