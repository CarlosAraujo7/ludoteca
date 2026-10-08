/* Registro de jogos da Ludoteca.
   Para adicionar um jogo: acrescente um item aqui — o menu se monta sozinho.

   kind    'jogo'   → jogo de mesa multiplayer
           'cartas' → criador de cartas (impressão) que vai virar jogo
   actions type: 'play' | 'create'
           status: 'ready' (href funciona) | 'soon' (botão desativado)        */

window.LUDOTECA_GAMES = [
  {
    id: 'dixit', kind: 'jogo', emoji: '🌙', accent: '#b98cff',
    title: 'Dixit',
    tagline: 'Imaginação e pistas',
    desc: 'O narrador dá uma pista sobre uma carta; todos escolhem uma carta que combine e tentam descobrir qual era a dele.',
    chips: ['👥 3–6 jogadores', '📱 cada um no seu celular'],
    actions: [{ type: 'play', label: '🎮 Jogar', href: 'jogos/dixit/', status: 'soon' }],
  },
  {
    id: 'detetive', kind: 'jogo', emoji: '🔍', accent: '#ff5c6c',
    title: 'Detetive',
    tagline: 'Quem, com o quê, onde?',
    desc: 'Circule pela mansão, faça sugestões e use as refutações dos outros para descobrir o crime antes de todo mundo.',
    chips: ['👥 3–6 jogadores', '📱 cada um no seu celular'],
    actions: [{ type: 'play', label: '🎮 Jogar', href: 'jogos/detetive/', status: 'soon' }],
  },
  {
    id: 'adedonha', kind: 'jogo', emoji: '🔤', accent: '#ff9f43',
    title: 'Adedonha',
    tagline: 'Stop! Rápido no gatilho',
    desc: 'Uma letra sorteada, várias categorias e o relógio correndo. Respostas repetidas valem menos.',
    chips: ['👥 2–8 jogadores', '⏱️ rodadas cronometradas'],
    actions: [{ type: 'play', label: '🎮 Jogar', href: 'jogos/adedonha/', status: 'soon' }],
  },
  {
    id: 'banco', kind: 'jogo', emoji: '💰', accent: '#4ade80',
    title: 'Banco Imobiliário',
    tagline: 'O banqueiro no bolso',
    desc: 'Carteira digital para a mesa: transferências entre jogadores, salário, impostos e saldo de cada um.',
    chips: ['👥 2–6 jogadores', '🧰 ferramenta de apoio'],
    actions: [{ type: 'play', label: '🎮 Abrir banco', href: 'jogos/banco/', status: 'soon' }],
  },

  {
    id: 'perfil7', kind: 'cartas', emoji: '🎯', accent: '#4da3ff',
    title: 'Perfil 7',
    tagline: '20 dicas, adivinhe o perfil',
    desc: 'Cartas com 20 dicas, da mais difícil à mais fácil. Quanto menos dicas você precisar, mais pontos faz.',
    chips: ['🖨️ cartas A4', '🤖 prompt para IA'],
    actions: [
      { type: 'create', label: '🖨️ Criar cartas', href: 'criadores/perfil7/', status: 'ready' },
      { type: 'play', label: '🎮 Jogar online', href: 'jogos/perfil7/', status: 'soon' },
    ],
  },
  {
    id: 'master', kind: 'cartas', emoji: '🏆', accent: '#f472b6',
    title: 'Master',
    tagline: 'Perguntas e respostas',
    desc: 'Seis categorias, quatro alternativas por pergunta. Conquiste todas as fatias e vá ao centro do tabuleiro.',
    chips: ['🖨️ 100 cartas prontas', '🤖 prompt para IA'],
    actions: [
      { type: 'create', label: '🖨️ Criar cartas', href: 'criadores/master/', status: 'ready' },
      { type: 'play', label: '🎮 Jogar online', href: 'jogos/master/', status: 'soon' },
    ],
  },
  {
    id: 'nem-a-pato', kind: 'cartas', emoji: '🦆', accent: '#ffd23f',
    title: 'Nem a Pato',
    tagline: 'O jogo dos números',
    desc: 'Seis perguntas por carta, todas com resposta numérica. Os patos indicam a dificuldade.',
    chips: ['🖨️ 100 cartas prontas', '🔢 respostas numéricas'],
    actions: [
      { type: 'create', label: '🖨️ Criar cartas', href: 'criadores/nem-a-pato/', status: 'ready' },
      { type: 'play', label: '🎮 Jogar online', href: 'jogos/nem-a-pato/', status: 'soon' },
    ],
  },
];

window.LUDOTECA_SECTIONS = [
  {
    kind: 'jogo',
    title: 'Jogos de mesa',
    sub: 'Entre numa sala com o código e jogue com a turma, cada um no seu celular.',
  },
  {
    kind: 'cartas',
    title: 'Cartas que viram jogo',
    sub: 'Crie e imprima as cartas. Em breve: gere com IA e jogue online.',
  },
];
