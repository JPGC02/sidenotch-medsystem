# SideNotch Medsystem — o notch do Windows ligado ao Medsystem Hub

Edição separada do [SideNotch](https://github.com/JPGC02/sidenotch) para a equipe Medsystem. Instala **lado a lado** com o SideNotch comum (outro `appId`, outra pasta de dados `%APPDATA%\SideNotch Medsystem`, porta de hooks 47322) e traz tudo do original mais a integração com o Hub:

- **Vínculo com o Hub**: aba *Medsystem Hub* nas configurações ou no próprio notch → e-mail e senha do Hub. Só a sessão (refresh token) fica guardada, cifrada com o cofre do Windows (`hub-session.bin`); a senha nunca é salva. Se o admin desativar o usuário, o app desvincula sozinho.
- **Notificações em tempo real**: assina a tabela `notificacoes` do usuário via Realtime (WebSocket) com consulta de segurança a cada 90 s. Nova notificação → cartão na barra, pastilha pisca, notificação do Windows opcional; clique abre o link na janela do Hub e marca como lida. "Marcar todas" na aba.
- **Minhas tarefas** (aba *Tarefas e notas* e dock lateral): tarefas avulsas (`tasks`) **e** as OS que o Fluxo da AT encarregou a você (`at_os_tarefa`, selo "AT · OS nnn"), agrupadas em Atrasadas / Hoje / Próximas, com ▶ iniciar / ✓ concluir gravando na tabela de origem, como a Central de Tarefas do Hub.
- **Banner na pastilha** (estilo Dynamic Island): a notificação aparece com título e mensagem por 9 s na notch fechada; clique abre no Hub.
- **Login único**: ao vincular, o app guarda também uma sessão para o site e a injeta na janela do Hub — não pede senha de novo.
- **Criar tarefa** direto do notch (aba Tarefas → + Nova tarefa): título, prazo, prioridade, detalhes — grava em `tasks` para você mesmo, como a página /tarefas.
- **Agenda do Hub** dentro do Calendário: eventos dos calendários pessoal, do setor e da empresa + os que você participa (`agenda_eventos`), com a cor do calendário; clique abre no Hub. Links .ics continuam funcionando junto.
- **Conversas do WhatsApp** (Organizador de Contato): aba *Conversas* e botão no dock com as conversas abertas do seu setor/atribuídas a você, não lidas em verde e **transferências aguardando atendente** em laranja. Mensagens recebidas, transferências para o seu setor e atribuições a você chegam em tempo real (Realtime de `whatsapp_messages`/`whatsapp_conversations`) como banner estilo WhatsApp na pastilha, cartão na barra e toast; clique abre `/contatos?conversa=…`.
- **Área de transferência** (aba no notch, estilo Win+V): tudo que você copia (Ctrl+C) — texto, links, cores, códigos e imagens — fica no histórico (`clipboard.json`, máx. configurável); busca, fixar, remover, limpar; clique recoloca no clipboard. Atalho global opcional (Configurações → Alertas e atalhos).
- **Popover solto com seta**: os cartões (aprovações do Claude Code, uso das IAs, notificações, tarefas, conversas) abrem num cartão flutuante ao lado do dock, com uma seta grande que acompanha o anel/mostrador em foco (morph com mola ao trocar). O contorno amarelo de alerta (aprovação pendente) acompanha a pílula **e as mordidas**, no dock e no notch do topo.
- **Sons**: Configurações → Medsystem Hub → som separado para notificações do Hub e para mensagens do WhatsApp (Pop, Mensagem, Sino, Suave, Carrilhão, padrão do Windows, arquivo .wav/.mp3 próprio ou nenhum), volume e botão ▶ para ouvir. Os presets são sintetizados com Web Audio no notch — sem arquivos.
- **Sincronização**: tempo real onde o Hub publica (notificações, WhatsApp) e consulta a cada 60 s no resto (tarefas, agenda); também sincroniza ao sair da janela do Hub.
- **Dois docks** (1.5): o **dock do Hub** (formulários, sino, conversas, tarefas) e o **dock das IAs** (anéis de uso do Claude/Codex/Cursor/Gemini, sessões e aprovações do Claude Code, Maestri, não perturbe). Cada um tem lado, posição vertical, deslocamento e monitor próprios (Configurações → Geral) e pode ser arrastado pelo ⋯ de forma independente; a bandeja liga/desliga cada um. As notificações vão para o dock certo (Hub/WhatsApp no do Hub; Claude Code/Maestri no das IAs).
- **Rail lateral (dock/)**: pílula de 62 px com raio 28 e mordidas de 40 px, mostradores circulares de 34 px, engrenagem pendurada abaixo da pílula com arco a 30% em repouso; o arco fecha e o ícone aparece só ao passar o mouse nela (preset snappy 700/42), popover com seta que faz *morph* entre notificações/conversas/tarefas usando a mola glide (300/40/1, ζ 1,155, 733 ms — `spring()` gera o `linear()` no boot e a mesma curva está em `--ease-move`). Zona de proximidade de 150 px só acorda a engrenagem; cliques continuam atravessando para o desktop fora da pílula.
- **Dock configurável** (1.7): Configurações → Medsystem Hub → *Atalhos no dock*: catálogo com ~60 páginas e formulários do Hub (chamados, compras, financeiro, calibração, AT, locação, projetos, Organizador de Contato, kanban, ideias, cursos, auditoria…), filtrado pelo que o seu setor/cargo tem acesso; marque, ordene com ↑↓ (até 12 no dock) e crie **atalhos personalizados** (nome + rota do Hub ou URL externa + ícone).
- **Dock lateral**: a barra lateral mostra os atalhos de formulários (tiles), o sino com não lidas e as tarefas; os anéis de uso de IA, os hooks do Claude Code e os botões de sessões/não perturbe ficam desligados por padrão (Configurações → Provedores / Claude Code / Medsystem Hub religam).
- **Lançador de formulários**: atalhos (Abrir chamado, Nova cotação, Pedido internet, Nova ideia PEM, Solicitar NF, Nova demanda, Produção marketing…) filtrados pelos **módulos que o seu setor/cargo tem no Hub** (mesma regra do site: `sector_module_access` + overrides `user_module_access`, fallback do `authStore`). Busca ("cham" + Enter), clique direito fixa no topo, atalho global configurável (ex.: `Ctrl+Shift+H`) abre o notch já na busca.
- Tudo abre na janela **Medsystem Hub** do próprio app (sessão persistente, sem precisar logar de novo no navegador). O app só escreve `notificacoes.lida` e `tasks.status` das suas próprias linhas; o resto continua no Hub, respeitando as RLS.

Configurações → **Medsystem Hub**: avisos, toast, som, marcar lida ao abrir, contadores na pastilha, intervalo, atalho, e (avançado) URL do Supabase/site para apontar para outro ambiente.

Ícones: [Iconsax](https://iconsax.io) (MIT), variante Linear, em `src/renderer/iconsax.js` (gerado do pacote `iconsax-react`; `IX.Nome` nos três renderers).

Arquivos: `src/hub.js` (Auth + PostgREST + Realtime/Phoenix, sem supabase-js; usa `ws`), `test/hub.test.js` (Supabase falso com Auth, REST e WebSocket: login, módulos, realtime, lida, tarefas, refresh, sessão em disco, revogação).

---

# SideNotch — uso das suas IAs numa barra lateral do Windows

Versão Windows do conceito do CodeNotch (Mac): uma "notch" fina fixa na borda da tela. Passe o mouse e ela abre mostrando anéis com o uso de **Claude**, **Codex/ChatGPT**, **Cursor** e **Gemini CLI**. Passe o mouse num anel para ver as janelas (sessão 5h, semanal, Opus, ciclo mensal…) e quando reiniciam.

Nada sai da sua máquina além das chamadas às APIs oficiais de cada provedor, usando o login que você já fez nas CLIs.

## Instalar (usuário final)

**Opção A — portátil (pronto):** descompacte `SideNotch-Medsystem-Setup-1.7.0.exe` em qualquer pasta e rode `SideNotch.exe`. Aparece um ícone na bandeja e a notch na borda direita da tela.

**Opção B — instalador .exe (gerar no Windows):**
```bat
cd sidenotch-medsystem
npm install
npm run dist
```
O instalador sai em `dist\SideNotch-Medsystem-Setup-1.7.0.exe` (requer Node.js 18+; no Windows não precisa de wine).

## Rodar em desenvolvimento
```bat
npm install
npm start
npm test        # testa os parsers das APIs
```

## Como cada provedor é lido

| Provedor | Fonte | O que mostra |
|---|---|---|
| Claude | `%USERPROFILE%\.claude\.credentials.json` (login do Claude Code) → `GET api.anthropic.com/api/oauth/usage` (mesmo endpoint do `/usage`) | Sessão 5h, semanal, Opus, Sonnet |
| Codex | `%USERPROFILE%\.codex\auth.json` (login do Codex CLI) → `GET chatgpt.com/backend-api/wham/usage` (mesmo do `/status`) | Sessão 5h, semanal, créditos, plano |
| Cursor | Cookie `WorkosCursorSessionToken` colado nas configurações → `GET cursor.com/api/usage-summary` | % do plano no ciclo, sob demanda, pool do time |
| Gemini | `%USERPROFILE%\.gemini\oauth_creds.json` (login do Gemini CLI) → `cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota` | Cota restante por modelo (pro/flash), reinício diário |
| Antigravity | language server local do IDE (porta + CSRF lidos do processo) → `GetUserStatus` | Cota por modelo (precisa do IDE aberto) |
| OpenRouter | API key → `/api/v1/auth/key` e `/api/v1/credits` | Limite da chave, créditos restantes |
| NVIDIA NIM | API key → `/v1/models` | Valida a chave; a NVIDIA não expõe uso por API |
| OpenCode | arquivos locais `~/.local/share/opencode/storage/message` | Custo e tokens de hoje/mês (sem cota) |

Pré-requisitos: ter feito login pelo menos uma vez em `claude`, `codex login`, `gemini`. Para o Cursor, faça login em cursor.com → F12 → Application → Cookies → copie o valor de `WorkosCursorSessionToken`.

## Aprovações do Claude Code

O SideNotch sobe um servidor local (`127.0.0.1:47322`, só no seu PC, protegido por token) e registra um hook HTTP `PermissionRequest` em `~/.claude/settings.json`. Quando o Claude Code pede permissão — no terminal, VS Code ou Cowork — a notch pulsa em laranja, mostra um cartão com a ferramenta, o comando/arquivo e o projeto, e você decide:

- **Permitir** — libera só esta vez
- **Sempre** — libera e grava a regra "sempre permitir" que o Claude Code sugeriu (o mesmo que a opção do prompt)
- **Negar** — o Claude recebe "Negado pelo usuário no SideNotch"

Também cobre **aprovação de plano** (`ExitPlanMode`: Aprovar / Aprovar + auto / Recusar) e **perguntas do Claude** (`AskUserQuestion`: as opções viram botões na barra).

Sem decisão em 110 s (configurável), o SideNotch devolve resposta vazia e o Claude Code mostra o prompt normal.

Para ativar: Configurações → **Instalar hook no Claude Code** (o botão só adiciona a entrada; o resto do settings.json é preservado). Sessões do Claude Code já abertas precisam ser reiniciadas para ler o hook. Em **auto mode** o Claude não pede permissão, então nada chega à barra.

## Sessões, avisos e alertas

Com os hooks instalados a barra também mostra:
- **Sessões ativas** (ícone de terminal): projeto, modelo, modo, status — trabalhando / esperando você / terminou / erro.
- **Avisos**: "X terminou" (`Stop`), "X está esperando você" (`idle_prompt`), negações do **auto mode** (`PermissionDenied`), limites de uso pausando o Claude. Opcionalmente também como notificação do Windows. Os pedidos de permissão aparecem agrupados por sessão, com cor por sessão.
- **Responder em texto**: nos cartões de plano/permissão, "Dizer o que mudar" / "Responder" envia sua mensagem ao Claude (como recusa com motivo). Nas perguntas, "Outra…" aceita texto livre.
- **Alertas de limite**: aos 80% e 95% (configurável) e quando a janela reinicia.
- **Previsão**: no popover do provedor, "no ritmo atual a janela esgota em X" (calculado a partir das leituras dos últimos 45 min).
- **Histórico**: mini-gráficos das últimas 24 h e pico diário de 7 dias (`%APPDATA%\SideNotch Medsystem\history.json`).

## Atalhos, não perturbe, widget compacto, arrastar
- **Atalhos globais** (configuráveis, vazios por padrão): abrir/fixar a barra, aprovar/negar o pedido mais antigo.
- **Não perturbe** (bandeja ou ícone do sino): sem som, sem toast, a barra não abre sozinha; o contador continua aparecendo.
- **Notch fechada** pode mostrar pontinhos coloridos (um por provedor) ou o maior % usado.
- **Arrastar**: segure o `⋯` no topo da barra e solte onde quiser — muda de lado/monitor automaticamente e salva a posição.

## Notch no topo (3.0)
Além da barra lateral, uma pastilha no topo do monitor (estilo notch) que expande com abas:
- **Música**: o que está tocando (Spotify, YouTube, Chrome, VLC… via controles de mídia do Windows/SMTC), **capa do álbum**, progresso e prev/play/next.
- **Sistema**: CPU, memória, rede ↓↑ e discos, com mini-gráficos (worker PowerShell `src/winworker.ps1`).
- **Apps**: web apps em janelas próprias com login persistente (ChatGPT, Claude, GitHub… + os seus) e apps instalados do Menu Iniciar e da Área de trabalho (busca, fixar favoritos; atalhos para .exe são executados diretamente, inclusive em rede).
- **Notas**: notas de texto ou **checklists** (tarefas com ✓), autosave; conversão entre os dois modos.
- **Calendário**: faixa da semana navegável (clique no dia, ‹ › semanas) + eventos do dia + próximos, a partir de links .ics (Google/Outlook).
- **Clima**: temperatura e condição via Open-Meteo (localização automática por IP, ou lat/lon nas configurações), na pastilha fechada e na aba Sistema.
Fechada, a pastilha mostra a hora, capa/música, CPU/RAM, próximo compromisso e temperatura; aberta, o tamanho se adapta à aba. Configurações → Notch. As configurações ganharam visual novo (acrílico no Windows 11).

## Maestri (Wire)
Integra com o [Maestri Wire](https://www.themaestri.app/pt-br/docs/wire): Configurações → Maestri → código de pareamento (ou senha da aba Manual). A chave pública do host é fixada na primeira conexão (TOFU) e conferida em toda conexão antes de enviar o token. A barra então mostra os terminais do Maestri em **Sessões** (com "Ir ao terminal", "Visto", envio de prompt, **☾ Dormir / ☀ Acordar** por terminal ou workspace e ✕ encerrar), avisa quando um agente **precisa de atenção**, e responde **prompts S/n** com Aprovar/Rejeitar. Consulta o feed a cada 4 s (configurável). Pareie como *Somente leitura* se só quiser os avisos.

## Auto-update
O instalador (NSIS) verifica o GitHub Releases de `JPGC02/sidenotch-medsystem` a cada 6 h e baixa a nova versão; a bandeja/configurações mostram "Instalar e reiniciar". Para publicar: `git tag v1.7.0 && git push --tags` — o workflow `.github/workflows/release.yml` compila no Windows e publica. O ZIP portátil não se atualiza sozinho.

## Configurações (ícone de engrenagem na barra ou bandeja)
- Lado (esquerda/direita), posição vertical (topo/centro/base), deslocamento em px, monitor
- Largura da notch fechada, intervalo de atualização (padrão 180 s — o endpoint do Claude limita chamadas frequentes)
- Ativar/desativar e ordenar provedores, token/cookie opcionais
- Iniciar com o Windows

Arquivo de configuração: `%APPDATA%\SideNotch Medsystem\settings.json`.

## Estrutura
```
src/main.js            janela transparente sempre no topo, posicionamento, bandeja, IPC, timer
src/preload.js         ponte segura renderer ↔ main
src/store.js           settings.json
src/approvals.js       servidor HTTP dos hooks (aprovações + eventos/sessões/feed) e instalação dos hooks
src/history.js         histórico de uso, previsão e alertas de limite
src/updater.js         auto-update via GitHub Releases
src/maestri.js         cliente Maestri Wire (pareamento, pin, feed, ações)
src/hub.js             cliente do Medsystem Hub (Supabase Auth/REST/Realtime)
src/providers/*.js     um módulo por provedor (fetchUsage + parse)
src/renderer/bar.html  a barra (anéis, hover, popover)
src/renderer/settings.html
test/providers.test.js parsers com payloads reais
test/approvals.test.js protocolo do hook, plano/perguntas, eventos/sessões e instalação
test/history.test.js   alertas, previsão e persistência
test/maestri.test.js   servidor Wire falso: pareamento, pin, feed, atenção, prompts, ações
test/preview-mock.html a barra com dados falsos — abra no navegador para ver o visual
```

## Observações
- Os endpoints de Claude/Codex/Cursor/Gemini não são públicos/documentados (são os mesmos que as CLIs e o CodexBar usam); podem mudar. Cada provedor falha isoladamente e mostra a dica no popover.
- O ZIP portátil foi gerado no Linux, por isso o `SideNotch.exe` usa o ícone padrão do Electron; o build feito no Windows (`npm run dist`) aplica o ícone `build/icon.ico`.
