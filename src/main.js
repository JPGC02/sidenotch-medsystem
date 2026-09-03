const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, shell, globalShortcut, Notification, safeStorage, dialog, clipboard } = require('electron');
const path = require('path');
const { Store } = require('./store');
const { fetchAll, resetCache, setCacheDir } = require('./providers');
const approvals = require('./approvals');
const { History } = require('./history');
const { Updater } = require('./updater');
const { MaestriClient } = require('./maestri');
const { SystemMonitor } = require('./system');
const apps = require('./apps');
const { Calendar } = require('./calendar');
const { Weather } = require('./weather');
const { Docs } = require('./docs');
const { HubClient } = require('./hub');
const { ClipboardHistory } = require('./clipboard');
const { QuickAccess } = require('./quickaccess');
const { Focus } = require('./focus');

const WIN_W = 340;            // largura da janela transparente (barra + cartões)
let WIN_H = 420;
let store, notch, settingsWin, tray, timer, server, history, updater, maestri, sysmon, calendar, docs, calTimer, weather, weatherTimer, hub, clipHist, qa, focus, tasksWin, boardWin, boardTimer;
const briefDone = { manha: '', tarde: '' };   // aaaa-mm-dd do último brief enviado
const alertSent = new Map();                  // chave do alerta → quando cobrou (não repete no mesmo dia)
const webappWins = new Map();
let lastUsage = [];

if (!app.requestSingleInstanceLock()) app.quit();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');   // sons das notificações sem clique prévio

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  history = new History(app.getPath('userData'));
  setCacheDir(app.getPath('userData'));
  if (!store.get().approvals.token) store.set({ approvals: { token: approvals.newToken() } });
  // edição Medsystem: na 1ª execução (ou vindo da 1.0.x) desliga os provedores de IA e a faixa de % — quem quiser religa nas configurações
  if (!store.get().medsystemInit) store.set({ medsystemInit: 1, compact: 'off', providers: { claude: { enabled: false }, codex: { enabled: false }, cursor: { enabled: false }, gemini: { enabled: false } } });
  if (store.get().medsystemInit < 2) store.set({ medsystemInit: 2, approvals: { enabled: false }, sidebar: { aiTools: false }, hub: { pollSeconds: 60 } });
  if (store.get().medsystemInit < 3) store.set({ medsystemInit: 3, hub: { toast: false } });   // só o banner do topo; sem toast do Windows
  if (store.get().medsystemInit < 4) {   // 1.5: dois docks — o do Hub herda a posição antiga; o das IAs nasce à esquerda com os provedores ligados
    const o = store.get();
    store.set({ medsystemInit: 4, docks: { hub: { enabled: true, side: o.side || 'right', vertical: o.vertical || 'center', offset: o.offset || 0, y: o.y ?? null, displayId: o.displayId || null }, ai: { enabled: true, side: 'left', vertical: 'center', offset: 0, y: null, displayId: null } },
      providers: { claude: { enabled: true }, codex: { enabled: true }, cursor: { enabled: true }, gemini: { enabled: true } }, sidebar: { aiTools: true }, compact: 'dots' });
  }
  app.setAppUserModelId('com.medsystem.sidenotch.hub');
  docs = new Docs(app.getPath('userData'));
  clipHist = new ClipboardHistory(app.getPath('userData'), clipboard, { max: Number(store.get().clipboard.max) || 60 });
  clipHist.on('change', () => broadcast('clipboard', clipHist.list()));
  if (store.get().clipboard.enabled !== false) clipHist.start();
  createBars();
  createNotch();
  createTray();
  startSystem();
  startCalendar();
  startWeather();
  applyAutoLaunch();
  startServer();
  startMaestri();
  startHub();
  qa = new QuickAccess({ userData: app.getPath('userData'), getSettings: () => store.get(), hub, notify: (n) => server && server._notify(n), broadcast });
  startFocus();
  startBoard();
  registerShortcuts();
  updater = new Updater({ onState: (st) => { broadcast('update', st); buildTrayMenu(); } });
  updater.start(store.get().update.auto);
  scheduleRefresh();
  refresh();
});

app.on('second-instance', () => openSettings());
app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => { globalShortcut.unregisterAll(); sysmon && sysmon.stop(); docs && docs.flush(); hub && hub.stop(); clipHist && clipHist.stop(); focus && focus.dispose(); });

// ---------- Notch (topo) ----------
const NOTCH_W = 960, NOTCH_H = 560;
function createNotch() {
  notch = new BrowserWindow({
    width: NOTCH_W, height: NOTCH_H,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: false, minimizable: false, maximizable: false,
    focusable: false, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  notch.setAlwaysOnTop(true, 'screen-saver');
  notch.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  notch.setMenu(null);
  notch.loadFile(path.join(__dirname, 'renderer', 'notch.html'));
  notch.setIgnoreMouseEvents(true, { forward: true });
  notch.once('ready-to-show', () => { positionNotch(); if (store.get().notch.enabled) notch.show(); });
  notch.on('blur', () => { if (notch && !notch.isDestroyed() && notch.isFocusable()) { notch.setFocusable(false); notch.webContents.send('bar:blur'); } });
  const keep = () => { if (!notch || notch.isDestroyed() || !notch.isVisible()) return; notch.setAlwaysOnTop(true, 'screen-saver', 1); notch.moveTop(); };
  setInterval(keep, 1500);
  app.on('browser-window-blur', keep); app.on('browser-window-focus', keep);
  screen.on('display-metrics-changed', positionNotch);
}

function positionNotch() {
  if (!notch) return;
  const s = store.get();
  const all = screen.getAllDisplays();
  const d = all.find((x) => String(x.id) === String(s.notch.displayId)) || targetDisplay();
  const wa = d.workArea;
  const x = wa.x + Math.round((wa.width - NOTCH_W) / 2) + Number(s.notch.offsetX || 0);
  notch.setBounds({ x, y: wa.y, width: NOTCH_W, height: NOTCH_H });
}

function applyWindowVisibility() {
  const s = store.get();
  eachBar((w, role) => { const on = s.sidebar.enabled !== false && dockCfg(role).enabled; if (on) { positionBar(role); w.show(); } else w.hide(); });
  if (notch) (s.notch.enabled ? (positionNotch(), notch.show()) : notch.hide());
}

// ---------- Sistema / mídia ----------
function startSystem() {
  sysmon = new SystemMonitor();
  sysmon.on('stats', () => { if (notch && !notch.isDestroyed()) notch.webContents.send('system', sysmon.snapshot()); });
  sysmon.start();
}

// ---------- Calendário ----------
function startCalendar() {
  calendar = new Calendar();
  const run = async () => { try { await calendar.refresh(store.get().calendar.sources || []); } catch { /* ignore */ } broadcast('calendar', calendar.state()); };
  clearInterval(calTimer);
  calTimer = setInterval(run, Math.max(5, Number(store.get().calendar.refreshMinutes) || 15) * 60000);
  run();
}

// ---------- Clima ----------
function startWeather() {
  weather = weather || new Weather();
  const run = async () => { broadcast('weather', await weather.refresh(store.get().weather || {})); };
  clearInterval(weatherTimer); weatherTimer = setInterval(run, 15 * 60000); run();
}

// ---------- Web apps em janela própria (sessão persistente: mantém login) ----------
function openWebApp(w) {
  const existing = webappWins.get(w.id);
  if (existing && !existing.isDestroyed()) { if (w.url && existing.webContents.getURL() !== w.url) existing.loadURL(w.url); existing.show(); existing.focus(); return; }
  const win = new BrowserWindow({
    width: 1100, height: 760, title: w.name, autoHideMenuBar: true, backgroundColor: '#111114',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { partition: 'persist:webapps', contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  // janela do Hub: entrega a sessão web guardada no vínculo (localStorage do supabase-js) para não pedir login de novo
  if (w.id === 'medsystem-hub' && hub) {
    win.webContents.on('did-finish-load', () => {
      const ws = hub.webSession(); if (!ws || win._sessionInjected) return;
      win.webContents.executeJavaScript(`(() => { try { if (localStorage.getItem(${JSON.stringify(ws.key)})) return 'has'; localStorage.setItem(${JSON.stringify(ws.key)}, ${JSON.stringify(ws.value)}); location.reload(); return 'set'; } catch (e) { return 'err ' + e; } })()`, true)
        .then((r) => { if (r === 'set' || r === 'has') win._sessionInjected = true; }).catch(() => {});
    });
  }
  win.loadURL(w.url);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) win.loadURL(url); return { action: 'deny' }; });
  win.on('closed', () => { webappWins.delete(w.id); if (w.id === 'medsystem-hub' && hub) hub.sync(); });
  if (w.id === 'medsystem-hub') win.on('blur', () => { if (hub) hub.sync(); });
  webappWins.set(w.id, win);
}

// ---------- Servidor de hooks (aprovações + eventos) ----------
function startServer() {
  if (!server) {
    server = new approvals.ApprovalServer();
    server.on('change', broadcastApprovals);
    server.on('pending', (p) => { if (!store.get().dnd) { if (bar && !bar.isVisible()) bar.show(); if (store.get().approvals.sound) shell.beep(); } });
    server.on('notify', onNotify);
  }
  const a = store.get().approvals;
  if (a.enabled) server.start({ port: Number(a.port) || 47322, token: a.token, timeoutSec: Number(a.timeoutSec) || 110 });
  else server.stop();
}

// ---------- Maestri Wire ----------
function startMaestri() {
  if (!maestri) {
    maestri = new MaestriClient(() => store.get().maestri, (patch) => store.set({ maestri: patch }));
    maestri.on('change', broadcastApprovals);
    maestri.on('connected', () => server && server._notify({ type: 'done', title: `Maestri conectado: ${maestri.info && maestri.info.name || ''}`, text: `${maestri.workspaces.length} workspace(s)` }));
    maestri.on('attention', (t) => { if (store.get().maestri.notifyAttention) server && server._notify({ type: 'waiting', title: `${t.name} precisa de atenção`, text: ((t.preview || []).filter((l) => l && l.trim()).slice(-1)[0] || '').slice(0, 200), project: t.workspaceName, maestriTerminalId: t.id }); });
    maestri.on('prompt', (p) => { if (!store.get().dnd) { if (bar && !bar.isVisible()) bar.show(); if (store.get().approvals.sound) shell.beep(); } });
  }
  const m = store.get().maestri;
  if (m.enabled && m.token) maestri.start(Math.max(2, Number(m.pollSeconds) || 4) * 1000); else maestri.stop();
}

// ---------- Medsystem Hub ----------
function startHub() {
  const want = store.get().hub || {};
  if (hub && (hub.url !== (want.url || hub.url) || hub.site !== (want.site || hub.site))) { hub.stop(); hub = null; }
  if (!hub) {
    const secret = safeStorage.isEncryptionAvailable() ? { encrypt: (s) => safeStorage.encryptString(s), decrypt: (b) => safeStorage.decryptString(b) } : null;
    let WS = null; try { WS = require('ws'); } catch { /* sem realtime: só polling */ }
    const h = store.get().hub || {};
    hub = new HubClient({ dir: app.getPath('userData'), secret, WebSocket: WS, url: h.url || undefined, anon: h.anon || undefined, site: h.site || undefined, getCfg: () => store.get().hub || {} });
    if (qa) qa.hubRef(hub);
    hub.on('change', () => { const st = hub.state(); broadcast('hub', st); updateTrayTooltip(); if (calendar) { calendar.setExtra(st.agenda || []); broadcast('calendar', calendar.state()); } });
    // WhatsApp: mensagem / transferência / atribuição → cartão + banner (estilo WhatsApp) + toast
    hub.on('chat', (ev) => {
      const cfg = store.get().hub || {};
      if (cfg.chatNotify === false) return;
      const c = ev.conv;
      const title = ev.kind === 'message' ? `${c.name}${c.sector ? ' · ' + c.sector : ''}` : ev.kind === 'transfer' ? `↪ ${c.name}` : `👤 ${c.name}`;
      server && server._notify({ type: 'chat', kind: ev.kind, title, text: (ev.text || '').slice(0, 300), link: c.link, chatId: c.id, avatar: c.avatar || null, project: 'WhatsApp' });
    });
    // quadro de Sistemas: movimentação do time em tempo real
    hub.on('board', (ev) => {
      const cfg = store.get().board || {};
      if (cfg.enabled === false || cfg.notifyMoves === false) return;
      const t = boardEventText(ev); if (!t) return;
      server && server._notify({ type: 'board', title: t.title, text: t.text, link: ev.ideiaId ? `/sistemas/ideias?id=${ev.ideiaId}` : '/sistemas/ideias', project: 'Sistemas' });
      if ((store.get().board || {}).sound !== false) { const h = store.get().hub || {}; playSound(h.soundPreset || 'ping', h); }
    });
    hub.on('notification', (n) => {
      if ((store.get().hub || {}).notify === false) return;
      server && server._notify({ type: 'hub', title: n.titulo || 'Medsystem Hub', text: (n.mensagem || '').slice(0, 300), link: n.link || '', hubNotifId: n.id, project: 'Medsystem Hub' });
    });
  }
  const h = store.get().hub || {};
  if (h.enabled !== false) hub.start(Number(h.pollSeconds) || 60); else hub.stop();
  if (focus) { focus.hubRef(hub); focus.flush(); }
}
// ---------- Quadro do time de Sistemas ----------
const ACAO_TXT = { assumiu: 'assumiu', mudou_status: 'moveu', bloqueou: 'bloqueou', desbloqueou: 'desbloqueou', comentou: 'comentou em', criou: 'criou', entregou: 'entregou' };
const COL_TXT = { recebida: 'Recebidas', em_triagem: 'Triagem', em_priorizacao: 'Priorização', aprovada: 'Aprovadas', em_desenvolvimento: 'Em desenvolvimento', entregue: 'Entregue', arquivada: 'Arquivada', recusada: 'Recusada' };
function boardEventText(ev) {
  const card = ev.numero ? `#${ev.numero}${ev.titulo ? ' · ' + String(ev.titulo).slice(0, 60) : ''}` : 'um cartão';
  const acao = ACAO_TXT[ev.acao] || ev.acao;
  const para = ev.para && ev.para.status ? COL_TXT[ev.para.status] || ev.para.status : null;
  if (ev.acao === 'mudou_status' && para) return { title: `${ev.quem} → ${para}`, text: card };
  if (ev.acao === 'bloqueou') return { title: `${ev.quem} bloqueou`, text: `${card}${ev.detalhes ? ' — ' + ev.detalhes : ''}` };
  return { title: `${ev.quem} ${acao}`, text: card };
}
function startBoard() {
  clearInterval(boardTimer);
  boardTimer = setInterval(() => { checkBoardAlerts(); checkBriefs(); }, 5 * 60 * 1000);
  setTimeout(() => { checkBoardAlerts(); checkBriefs(); }, 20000);
}
// cobranças: sem dono, parado, bloqueado, SLA, WIP — no máximo uma vez por dia por item
async function checkBoardAlerts() {
  const cfg = store.get().board || {};
  if (cfg.enabled === false || cfg.notifyStuck === false || !hub || !hub.hasBoard || !hub.hasBoard()) return;
  const a = await hub.loadBoardAlerts({ semDonoHoras: Number(cfg.semDonoHoras) || 24, paradoDias: Number(cfg.paradoDias) || 2, wip: Number(cfg.wip) || 2 }).catch(() => null);
  if (!a) return;
  const hoje = new Date().toISOString().slice(0, 10);
  const once = (key, fn) => { const k = key + '|' + hoje; if (alertSent.get(k)) return; alertSent.set(k, Date.now()); fn(); };
  const notify = (title, text, link) => server && server._notify({ type: 'board', title, text, link: link || '/sistemas/ideias', project: 'Sistemas' });
  if ((a.semDono || []).length) once('semdono:' + a.semDono.length, () => notify(`⏳ ${a.semDono.length} cartão(ões) sem dono`, a.semDono.slice(0, 3).map((x) => `#${x.n} ${x.titulo}`).join(' · ')));
  for (const x of (a.paradas || []).slice(0, 5)) once('parada:' + x.id, () => notify(`🛑 #${x.n} parada há ${x.dias}d`, `${x.titulo}${x.quem ? ' — ' + x.quem : ''}`, `/sistemas/ideias?id=${x.id}`));
  for (const x of (a.bloqueadas || []).slice(0, 5)) once('bloq:' + x.id, () => notify(`⛔ #${x.n} bloqueada`, `${x.motivo || 'sem motivo'}${x.quem ? ' — ' + x.quem : ''}`, `/sistemas/ideias?id=${x.id}`));
  for (const x of (a.sla || []).slice(0, 5)) once('sla:' + x.id, () => notify(`⚠ SLA de ${x.tipo} estourado`, `#${x.n} ${x.titulo}`, `/sistemas/ideias?id=${x.id}`));
  for (const w of (a.wip || [])) once('wip:' + w.id, () => notify(`📌 ${w.name} com ${w.wip} em andamento`, `Acima do limite de ${Number(cfg.wip) || 2} — vale terminar antes de puxar mais.`));
  if (a.filaNova && cfg.notifyNew !== false) once('fila:' + a.filaNova, () => notify(`📥 ${a.filaNova} nova(s) na fila`, 'Entraram nas últimas 24 h e ainda estão em Recebidas.'));
  broadcast('hub', hub.state());
}
// brief da manhã e fechamento do dia
async function checkBriefs() {
  const cfg = store.get().board || {};
  if (cfg.enabled === false || cfg.brief === false || !hub || !hub.hasBoard || !hub.hasBoard()) return;
  const now = new Date(); const hoje = now.toISOString().slice(0, 10); const hhmm = now.getHours() * 60 + now.getMinutes();
  const parse = (v, d) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : d; };
  const manha = parse(cfg.briefManha, 9 * 60), tarde = parse(cfg.briefTarde, 18 * 60);
  const janela = 20;   // tolerância: o app pode estar dormindo na hora exata
  const due = (alvo) => hhmm >= alvo && hhmm < alvo + janela;
  if (due(manha) && briefDone.manha !== hoje) { briefDone.manha = hoje; await sendBrief('manha'); }
  if (due(tarde) && briefDone.tarde !== hoje) { briefDone.tarde = hoje; await sendBrief('tarde'); }
}
async function sendBrief(kind) {
  await hub.loadBoard().catch(() => {});
  const st = (hub.board && hub.board.stats) || {};
  const feed = (hub.boardFeed || []).filter((e) => Date.now() - new Date(e.at || e.created_at).getTime() < 12 * 3600 * 1000);
  const movidas = feed.filter((e) => e.acao === 'mudou_status').length;
  const txt = kind === 'manha'
    ? `${st.novas24h || 0} nova(s) · ${st.semDono || 0} sem dono · ${st.emDev || 0} em dev · ${st.paradas || 0} parada(s)`
    : `${movidas} movimento(s) hoje · ${st.entregues7d || 0} entregue(s) na semana · ${st.bloqueadas || 0} bloqueada(s)`;
  server && server._notify({ type: 'board', title: kind === 'manha' ? '☀ Quadro de Sistemas — hoje' : '🌙 Fechamento do dia', text: txt, link: '/sistemas/ideias', project: 'Sistemas' });
  broadcast('hub', hub.state());
}
// janela do quadro (Kanban completo)
function openBoardWindow() {
  if (boardWin && !boardWin.isDestroyed()) { boardWin.show(); boardWin.focus(); return boardWin; }
  const win11 = process.platform === 'win32' && Number((require('os').release().split('.')[2]) || 0) >= 22000;
  const d = targetDisplay();
  boardWin = new BrowserWindow({
    width: Math.min(1360, d.workArea.width - 60), height: Math.min(780, d.workArea.height - 60),
    title: 'Quadro · Sistemas', show: false, titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#f4f4f6', height: 36 },
    ...(win11 ? { backgroundMaterial: 'acrylic' } : { backgroundColor: '#0f0f13' }),
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  boardWin.setMenu(null);
  boardWin.loadFile(path.join(__dirname, 'renderer', 'board.html'), { query: win11 ? {} : { solid: '1' } });
  boardWin.once('ready-to-show', () => { app.focus({ steal: true }); boardWin.show(); boardWin.focus(); });
  boardWin.on('closed', () => { boardWin = null; });
  return boardWin;
}

// ---------- Foco (pomodoro nas tarefas do Hub) ----------
function startFocus() {
  focus = new Focus({ userData: app.getPath('userData'), hub, getSettings: () => store.get(), notify: (n) => {
    server && server._notify({ type: 'focus', title: n.title, text: n.text, project: 'Foco' });
    const cfg = store.get().hub || {}; if ((store.get().focus || {}).chime !== false) playSound(cfg.soundPreset || 'chime', cfg);
  } });
  focus.on('change', () => { const st = focus.state(); broadcast('focus', st); updateTrayTooltip(); buildTrayMenu(); });
  focus.on('tick', (st) => broadcast('focus', st));
  focus.flush();
  setInterval(() => focus && focus.flush(), 5 * 60 * 1000);
}
// som das notificações do Hub: sintetizado no renderer do notch (Web Audio) ou arquivo do usuário; 'windows' = beep do sistema
function playSound(preset, cfg = {}) {
  if (!preset || preset === 'none') return;
  if (preset === 'windows') { shell.beep(); return; }
  const target = (notch && !notch.isDestroyed()) ? notch : (bar && !bar.isDestroyed()) ? bar : null;
  if (!target) { shell.beep(); return; }
  target.webContents.send('sound:play', { preset, volume: Math.max(0, Math.min(1, Number(cfg.volume ?? 0.6))), file: preset === 'file' ? (cfg.soundFile || '') : '' });
}
function openHubLink(link, notifId) {
  // rotas de módulos que o usuário não tem no Hub não abrem pelo app (notificações vindas do próprio Hub passam)
  if (!notifId && hub && !hub.allowedPath(link)) { server && server._notify({ type: 'hub', title: 'Sem acesso a esta página do Hub', text: `${link} pertence a um módulo que o seu perfil não tem.`, link: '' }); return; }
  openWebApp({ id: 'medsystem-hub', name: 'Medsystem Hub', url: hub.urlFor(link) });
  if (notifId && store.get().hub.markReadOnOpen !== false) hub.markRead(notifId).catch(() => {});
}

function approvalsState() {
  const a = store.get().approvals;
  return {
    enabled: !!a.enabled, running: !!(server && server.running), port: a.port,
    error: server && server.lastError || null,
    hookInstalled: approvals.hookInstalled(), settingsFile: approvals.claudeSettingsPath(),
    pending: server ? server.list() : [],
    sessions: server ? server.listSessions() : [],
    feed: server ? server.feed : [],
    history: server ? server.history : [],
    dnd: !!store.get().dnd,
    maestri: maestri ? maestri.state() : null
  };
}

function broadcastApprovals() { broadcast('approvals', approvalsState()); updateTrayTooltip(); }

function onNotify(n) {
  const cfg = store.get().notifications;
  const want = { done: cfg.done, waiting: cfg.waiting, denied: cfg.denied, limit: true, error: true, alert: true, update: true, hub: true, chat: true, focus: true, board: true }[n.type];
  if (!want) { server.feed = server.feed.filter((x) => x.id !== n.id); return; }
  broadcast('notify', n);
  if (store.get().dnd) return;
  { const w = isHub ? bars.hub : bar; if (w && !w.isDestroyed() && !w.isVisible() && dockCfg(isHub ? 'hub' : 'ai').enabled) w.show(); }
  const hcfg = store.get().hub || {};
  const isHub = n.type === 'hub' || n.type === 'chat';
  if (isHub) { if (hcfg.sound !== false) playSound(n.type === 'chat' ? (hcfg.soundChat || hcfg.soundPreset || 'pop') : (hcfg.soundPreset || 'pop'), hcfg); }
  else if (n.type !== 'done' || cfg.done) shell.beep();
  if ((isHub ? hcfg.toast !== false : cfg.toast) && Notification.isSupported()) {
    try { const t = new Notification({ title: n.title, body: n.text || '', silent: true }); t.on('click', () => { if (isHub) openHubLink(n.link, n.hubNotifId); else if (bar) { bar.show(); bar.webContents.send('bar:open'); } }); t.show(); } catch { /* ignore */ }
  }
}

// ---------- Docks laterais (hub = formulários/notificações do Hub · ai = uso das IAs, aprovações e sessões) ----------
const DOCKS = ['hub', 'ai'];
const bars = {};            // role → BrowserWindow
const barH = { hub: WIN_H, ai: WIN_H };
function dockCfg(role) { const d = (store.get().docks || {})[role] || {}; return { enabled: d.enabled !== false, side: d.side || 'right', vertical: d.vertical || 'center', offset: Number(d.offset || 0), y: d.y, displayId: d.displayId }; }
function createBars() { for (const role of DOCKS) createBar(role); }
function createBar(role) {
  const win = new BrowserWindow({
    width: WIN_W, height: barH[role],
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: false, minimizable: false, maximizable: false,
    focusable: false, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  bars[role] = win; win._role = role;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'bar.html'), { query: { role } });
  win.once('ready-to-show', () => { positionBar(role); if (dockCfg(role).enabled) win.show(); });
  win.setIgnoreMouseEvents(true, { forward: true });
  const keepOnTop = () => {
    if (win.isDestroyed() || !win.isVisible() || (dragging && dragging.role === role)) return;
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.moveTop();
  };
  setInterval(keepOnTop, 1500);
  win.on('show', keepOnTop);
  app.on('browser-window-blur', keepOnTop);
  app.on('browser-window-focus', keepOnTop);
  win.on('blur', () => { if (!win.isDestroyed() && win.isFocusable()) { win.setFocusable(false); win.webContents.send('bar:blur'); } });
  if (role === DOCKS[0]) { screen.on('display-metrics-changed', positionBars); screen.on('display-added', positionBars); screen.on('display-removed', positionBars); }
}
function eachBar(fn) { for (const role of DOCKS) { const w = bars[role]; if (w && !w.isDestroyed()) fn(w, role); } }
// compat: "bar" = dock que recebe aprovações/sessões do Claude Code (ai); cai no hub se o ai estiver desligado
Object.defineProperty(globalThis, 'bar', { get() { const a = bars.ai, h = bars.hub; return (a && !a.isDestroyed() && dockCfg('ai').enabled) ? a : (h && !h.isDestroyed() ? h : a); } });

function targetDisplay(role = 'hub') {
  const d = dockCfg(role);
  const all = screen.getAllDisplays();
  return all.find((x) => String(x.id) === String(d.displayId)) || screen.getPrimaryDisplay();
}

function positionBars() { for (const role of DOCKS) positionBar(role); }
function positionBar(role = 'hub') {
  const win = bars[role]; if (!win || win.isDestroyed() || (dragging && dragging.role === role)) return;
  const s = dockCfg(role), H = barH[role];
  const { workArea } = targetDisplay(role);
  const x = s.side === 'left' ? workArea.x : workArea.x + workArea.width - WIN_W;
  let y;
  if (s.vertical === 'custom' && s.y != null) y = Number(s.y);
  else if (s.vertical === 'top') y = workArea.y + 16 + s.offset;
  else if (s.vertical === 'bottom') y = workArea.y + workArea.height - H - 16 + s.offset;
  else y = workArea.y + Math.round((workArea.height - H) / 2) + s.offset;
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - H));
  win.setBounds({ x, y, width: WIN_W, height: H });
}

// ---------- Arrastar um dock ----------
let dragging = null;
function dragStart(role) {
  const win = bars[role]; if (!win || dragging) return;
  const cur = screen.getCursorScreenPoint();
  const b = win.getBounds(); const H = barH[role];
  dragging = { role, grabDy: cur.y - b.y, timer: null, safety: setTimeout(dragEnd, 15000) };
  dragging.timer = setInterval(() => {
    const c = screen.getCursorScreenPoint();
    const d = screen.getDisplayNearestPoint(c);
    const wa = d.workArea;
    const side = c.x < wa.x + wa.width / 2 ? 'left' : 'right';
    const x = side === 'left' ? wa.x : wa.x + wa.width - WIN_W;
    const y = Math.max(wa.y, Math.min(c.y - dragging.grabDy, wa.y + wa.height - H));
    win.setBounds({ x, y, width: WIN_W, height: H });
    dragging.last = { side, y, displayId: String(d.id) };
  }, 16);
}
function dragEnd() {
  if (!dragging) return;
  clearInterval(dragging.timer); clearTimeout(dragging.safety);
  const { last, role } = dragging; dragging = null;
  if (last) { store.set({ docks: { [role]: { side: last.side, y: last.y, vertical: 'custom', displayId: last.displayId } } }); broadcast('settings', store.get()); }
  positionBar(role);
}

// ---------- Atualização de uso ----------
async function refresh(force = false) {
  try { lastUsage = await fetchAll(store.get(), { force: force === true }); }
  catch (e) { lastUsage = [{ id: 'app', name: 'SideNotch', ok: false, error: String(e) }]; }
  try {
    const alerts = history.record(lastUsage, store.get().alerts);
    for (const a of alerts) server && server._notify(a.type === 'reset'
      ? { type: 'alert', title: `${a.name}: janela reiniciou`, text: `Uso voltou para ${Math.round(a.percent)}%.` }
      : { type: 'alert', title: `${a.name}: ${a.threshold}% da cota`, text: `Você já usou ${Math.round(a.percent)}%${a.resetsAt ? ' · reinicia ' + new Date(a.resetsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}.` });
    for (const u of lastUsage) { u.forecast = history.forecast(u.id); u.series = history.series(u.id); }
  } catch { /* histórico é best-effort */ }
  broadcast('usage', lastUsage);
  updateTrayTooltip();
}

function scheduleRefresh() {
  clearInterval(timer);
  const sec = Math.max(30, Number(store.get().refreshSeconds) || 180);
  timer = setInterval(refresh, sec * 1000);
}

function broadcast(ch, payload) {
  for (const w of [bars.hub, bars.ai, notch, settingsWin, tasksWin, boardWin]) if (w && !w.isDestroyed()) w.webContents.send(ch, payload);
}

// ---------- Atalhos globais ----------
function registerShortcuts() {
  globalShortcut.unregisterAll();
  const sc = store.get().shortcuts || {};
  const reg = (acc, fn) => { if (!acc) return; try { globalShortcut.register(acc, fn); } catch { /* combinação inválida */ } };
  reg(sc.toggle, () => { if (bar) { if (!bar.isVisible()) bar.show(); bar.webContents.send('bar:toggle'); } });
  reg(sc.approve, () => { const p = server && server.list()[0]; if (p && p.kind === 'permission') server.decide(p.id, 'allow'); });
  reg(sc.deny, () => { const p = server && server.list()[0]; if (p) server.decide(p.id, 'deny'); });
  reg(sc.capture || 'CommandOrControl+Shift+X', () => qa && qa.captureArea());
  reg(sc.captures, () => { if (notch) { if (!notch.isVisible()) notch.show(); notch.webContents.send('notch:open', 'caps'); } });
  reg(sc.clip, () => { if (notch) { if (!notch.isVisible()) notch.show(); notch.webContents.send('notch:open', 'clip'); } });
  reg(sc.hub, () => { if (notch) { if (!notch.isVisible()) notch.show(); notch.webContents.send('notch:open', 'hub'); } });
  reg(sc.focus || 'CommandOrControl+Shift+F', () => { if (!focus) return; if (focus.state().active) focus.toggle(); else openTasksWindow(); });
  reg(sc.tasks, () => openTasksWindow());
  reg(sc.board, () => openBoardWindow());
}

// ---------- Janela de Tarefas (mês + dia, foco por tarefa) ----------
function openTasksWindow() {
  if (tasksWin && !tasksWin.isDestroyed()) { tasksWin.show(); tasksWin.focus(); return tasksWin; }
  const win11 = process.platform === 'win32' && Number((require('os').release().split('.')[2]) || 0) >= 22000;
  const d = targetDisplay();
  tasksWin = new BrowserWindow({
    width: Math.min(1040, d.workArea.width - 80), height: Math.min(660, d.workArea.height - 80),
    title: 'Tarefas', show: false, titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#f4f4f6', height: 36 },
    ...(win11 ? { backgroundMaterial: 'acrylic' } : { backgroundColor: '#0f0f13' }),
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  tasksWin.setMenu(null);
  tasksWin.loadFile(path.join(__dirname, 'renderer', 'tasks.html'), { query: win11 ? {} : { solid: '1' } });
  tasksWin.once('ready-to-show', () => { app.focus({ steal: true }); tasksWin.show(); tasksWin.focus(); });
  tasksWin.on('closed', () => { tasksWin = null; });
  return tasksWin;
}

// ---------- Bandeja ----------
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  buildTrayMenu();
  tray.on('double-click', openSettings);
  updateTrayTooltip();
}

function buildTrayMenu() {
  if (!tray) return;
  const st = updater ? updater.state : { status: 'idle' };
  const upLabel = st.status === 'downloaded' ? `Instalar atualização ${st.available}` : st.status === 'available' ? `Baixar atualização ${st.available}` : st.status === 'downloading' ? `Baixando… ${st.progress || 0}%` : 'Verificar atualizações';
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Capturar área…', click: () => qa && qa.captureArea() },
    { label: 'Tarefas e foco…', click: () => openTasksWindow() },
    ...(hub && hub.hasBoard && hub.hasBoard() ? [{ label: 'Quadro de Sistemas…', click: () => openBoardWindow() }] : []),
    ...(focus && focus.state().active ? [{ label: focus.state().running ? `Pausar foco (${Math.ceil(focus.state().remaining / 60)} min)` : 'Retomar foco', click: () => focus.toggle() }, { label: 'Encerrar foco', click: () => focus.stop('user') }] : []),
    { label: 'Atualizar uso agora', click: () => refresh(true) },
    { label: 'Não perturbe', type: 'checkbox', checked: !!store.get().dnd, click: (mi) => setDnd(mi.checked) },
    { label: 'Configurações…', click: openSettings },
    { type: 'separator' },
    { label: upLabel, enabled: st.status !== 'unsupported' && st.status !== 'downloading', click: () => { if (st.status === 'downloaded') updater.install(); else if (st.status === 'available') updater.download(); else updater.check(); } },
    { label: `Versão ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: 'Mostrar/ocultar dock do Hub', click: () => { store.set({ docks: { hub: { enabled: !dockCfg('hub').enabled } } }); applyWindowVisibility(); broadcast('settings', store.get()); } },
    { label: 'Mostrar/ocultar dock das IAs', click: () => { store.set({ docks: { ai: { enabled: !dockCfg('ai').enabled } } }); applyWindowVisibility(); broadcast('settings', store.get()); } },
    { label: 'Mostrar/ocultar notch', click: () => { store.set({ notch: { enabled: !store.get().notch.enabled } }); applyWindowVisibility(); } },
    { label: 'Sair', click: () => { app.exit(0); } }
  ]));
}

function setDnd(v) { store.set({ dnd: !!v }); broadcast('settings', store.get()); broadcastApprovals(); buildTrayMenu(); }

function updateTrayTooltip() {
  if (!tray) return;
  const lines = lastUsage.map((u) => u.ok && u.primary ? `${u.name}: ${Math.round(u.primary.usedPercent)}% usado` : u.ok && u.stats ? `${u.name}: ${u.stats.label} hoje` : `${u.name}: ${u.error || '—'}`);
  const n = server ? server.pending.size : 0;
  if (n) lines.unshift(`⚠ ${n} aprovação(ões) pendente(s) do Claude Code`);
  if (hub && hub.session) { const st = hub.state(); if (st.unread) lines.unshift(`🔔 Hub: ${st.unread} notificação(ões) não lida(s)`); if (st.tasks.length) lines.unshift(`✅ Hub: ${st.tasks.length} tarefa(s) aberta(s)${st.overdue ? ', ' + st.overdue + ' atrasada(s)' : ''}`); }
  if (focus) { const f = focus.state(); if (f.active) lines.unshift(`⏱ Foco: ${String(Math.floor(f.remaining / 60)).padStart(2, '0')}:${String(f.remaining % 60).padStart(2, '0')} · ${f.title}`); }
  if (store.get().dnd) lines.unshift('🔕 Não perturbe');
  tray.setToolTip(['SideNotch', ...lines].join('\n') || 'SideNotch');
}

// ---------- Configurações ----------
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return; }
  // Windows 11 (build ≥ 22000) suporta acrílico nativo; no resto usa fundo sólido
  const win11 = process.platform === 'win32' && Number((require('os').release().split('.')[2]) || 0) >= 22000;
  settingsWin = new BrowserWindow({
    width: 860, height: 700, minWidth: 700, minHeight: 520, title: 'SideNotch — Configurações', autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#f4f4f6', height: 36 },
    ...(win11 ? { backgroundMaterial: 'acrylic' } : { backgroundColor: '#0f0f13' }),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'), { query: win11 ? {} : { solid: '1' } });
  settingsWin.on('closed', () => { settingsWin = null; });
}

function applyAutoLaunch() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!store.get().autoLaunch, path: process.execPath });
}

// ---------- IPC ----------
ipcMain.handle('settings:get', () => store.get());
ipcMain.handle('app:version', () => app.getVersion());
// Loja de módulos: o mapa {id: bool} das configurações liga/desliga o ajuste que cada módulo controla
const MODULE_PATHS = {
  hub: 'hub.enabled', board: 'board.enabled', focus: 'focus.pill', chat: 'hub.chatNotify',
  captures: 'quickaccess.enabled', clipboard: 'clipboard.enabled', calendar: 'calendar.enabled',
  music: 'notch.show.music', system: 'notch.show.system', apps: 'notch.show.apps',
  providers: 'sidebar.aiTools', approvals: 'approvals.enabled', maestri: 'maestri.enabled', weather: 'weather.enabled'
};
function modulesPatch(mods) {
  const out = {};
  for (const [id, on] of Object.entries(mods || {})) {
    const path = MODULE_PATHS[id]; if (!path) continue;
    const ks = path.split('.'); let cur = out;
    for (let i = 0; i < ks.length - 1; i++) cur = (cur[ks[i]] = cur[ks[i]] || {});
    cur[ks[ks.length - 1]] = !!on;
  }
  return out;
}
ipcMain.handle('settings:save', (_e, patch) => {
  const before = JSON.stringify(store.get().approvals);
  if (patch && patch.modules) patch = { ...modulesPatch(patch.modules), ...patch };   // o ajuste explícito vence o switch
  store.set(patch);
  positionBars(); positionNotch(); applyWindowVisibility(); scheduleRefresh(); applyAutoLaunch(); registerShortcuts(); buildTrayMenu();
  if (JSON.stringify(store.get().approvals) !== before) startServer();
  startMaestri();
  if (patch && patch.calendar) startCalendar();
  if (patch && patch.weather) { weather.loc = null; startWeather(); }
  if (patch && patch.hub) startHub();
  if (patch && patch.quickaccess && qa && qa.stack && !qa.stack.isDestroyed()) { qa.stack.close(); }
  if (patch && patch.clipboard && clipHist) { clipHist.max = Number(store.get().clipboard.max) || 60; if (store.get().clipboard.enabled !== false) clipHist.start(); else clipHist.stop(); }
  if (patch && patch.modules) { if (store.get().calendar.enabled === false) clearInterval(calTimer); else startCalendar(); if (store.get().weather.enabled === false) clearInterval(weatherTimer); else startWeather(); }
  broadcast('settings', store.get());
  resetCache();
  refresh();
  return store.get();
});
ipcMain.handle('approvals:get', () => approvalsState());
ipcMain.handle('approvals:decide', (_e, id, decision, extra) => { server && server.decide(id, decision, extra || {}); return approvalsState(); });
ipcMain.handle('approvals:install-hook', () => {
  const a = store.get().approvals;
  approvals.installHook({ port: Number(a.port) || 47322, token: a.token, timeoutSec: Number(a.timeoutSec) || 110 });
  return approvalsState();
});
ipcMain.handle('approvals:uninstall-hook', () => { approvals.uninstallHook(); return approvalsState(); });
ipcMain.handle('maestri:pair', async (_e, opts) => { try { await maestri.pair(opts || {}); startMaestri(); return { ok: true, state: maestri.state() }; } catch (e) { return { ok: false, error: String(e && e.message || e), state: maestri.state() }; } });
ipcMain.handle('maestri:unpair', () => { maestri.stop(); store.set({ maestri: { token: '', deviceId: '', role: '', keyHash: '', enabled: false } }); maestri.info = null; maestri.connected = false; broadcastApprovals(); return maestri.state(); });
ipcMain.handle('maestri:action', async (_e, id, action, text) => {
  try {
    if (action === 'approve') await maestri.approve(id); else if (action === 'reject') await maestri.reject(id);
    else if (action === 'seen') await maestri.seen(id); else if (action === 'focus') await maestri.focus(id);
    else if (action === 'prompt') await maestri.prompt(id, text || '');
    else if (action === 'unload') await maestri.unload(id); else if (action === 'restart') await maestri.restart(id); else if (action === 'kill') await maestri.kill(id);
    else if (action === 'ws-unload') await maestri.unloadWorkspace(id); else if (action === 'ws-wake') await maestri.wakeWorkspace(id);
    if (action === 'approve' || action === 'reject') maestri.prompts.delete(id);
    broadcastApprovals(); maestri.poll().catch(() => {});
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});
ipcMain.handle('feed:dismiss', (_e, id) => { server && (id === '*' ? server.clearFeed() : server.dismiss(id)); return approvalsState(); });
ipcMain.handle('dnd:set', (_e, v) => { setDnd(v); return store.get(); });
ipcMain.handle('usage:get', () => lastUsage);
ipcMain.handle('usage:refresh', async () => { await refresh(true); return lastUsage; });
ipcMain.handle('update:get', () => updater ? updater.state : null);
ipcMain.handle('update:check', () => { updater && updater.check(); return updater && updater.state; });
ipcMain.handle('update:download', () => { updater && updater.download(); return updater && updater.state; });
ipcMain.handle('update:install', () => { updater && updater.install(); return updater && updater.state; });
ipcMain.handle('displays:get', () => screen.getAllDisplays().map((d, i) => ({ id: String(d.id), label: `Monitor ${i + 1} (${d.size.width}×${d.size.height})${d.id === screen.getPrimaryDisplay().id ? ' — principal' : ''}` })));
ipcMain.on('bar:ignore-mouse', (e, ignore) => { const w = BrowserWindow.fromWebContents(e.sender); if (w && !(dragging && w._role === dragging.role)) w.setIgnoreMouseEvents(!!ignore, { forward: true }); });
ipcMain.on('bar:height', (e, h) => { const w = BrowserWindow.fromWebContents(e.sender); const role = w && w._role; if (!role) return; const nh = Math.max(160, Math.min(1000, Math.round(h))); if (nh !== barH[role]) { barH[role] = nh; positionBar(role); } });
ipcMain.on('bar:focusable', (e, v) => { const w = BrowserWindow.fromWebContents(e.sender); if (!w) return; w.setFocusable(!!v); if (v) w.focus(); });
ipcMain.on('bar:drag', (e, phase) => { const w = BrowserWindow.fromWebContents(e.sender); if (phase === 'start') dragStart(w && w._role || 'hub'); else dragEnd(); });
ipcMain.on('app:open-settings', openSettings);
ipcMain.handle('system:get', () => sysmon ? sysmon.snapshot() : null);
ipcMain.handle('media:cmd', (_e, cmd) => sysmon ? sysmon.media(cmd) : false);
ipcMain.handle('apps:list', async (_e, opts) => { try { return await apps.listInstalled(opts || {}); } catch (e) { return []; } });
ipcMain.handle('apps:launch', (_e, id) => apps.launch(id));
ipcMain.handle('webapps:list', () => (store.get().webapps || apps.DEFAULT_WEBAPPS).map((w) => ({ ...w, icon: w.icon || apps.faviconUrl(w.url) })));
ipcMain.handle('webapps:open', (_e, id) => { const w = (store.get().webapps || apps.DEFAULT_WEBAPPS).find((x) => x.id === id); if (w) openWebApp(w); return !!w; });
ipcMain.handle('webapps:set', (_e, list) => { store.set({ webapps: Array.isArray(list) ? list.slice(0, 40) : null }); broadcast('settings', store.get()); return store.get().webapps; });
ipcMain.handle('calendar:get', () => calendar ? calendar.state() : null);
ipcMain.handle('weather:get', () => weather ? weather.snapshot() : null);
ipcMain.handle('calendar:refresh', async () => { await calendar.refresh(store.get().calendar.sources || []); const st = calendar.state(); broadcast('calendar', st); return st; });
ipcMain.handle('clipboard:list', () => clipHist ? clipHist.list() : []);
ipcMain.handle('clipboard:use', (_e, id) => clipHist.use(id));
ipcMain.handle('clipboard:pin', (_e, id, v) => { clipHist.pin(id, v); return clipHist.list(); });
ipcMain.handle('clipboard:remove', (_e, id) => { clipHist.remove(id); return clipHist.list(); });
ipcMain.handle('clipboard:clear', (_e, keepPinned) => { clipHist.clear(keepPinned !== false); return clipHist.list(); });
ipcMain.handle('docs:get', () => docs.get());
ipcMain.handle('docs:set', (_e, patch) => docs.set(patch || {}));
ipcMain.on('notch:height', (_e, h) => { /* altura fixa; reservado */ });
ipcMain.handle('hub:get', () => hub ? hub.state() : null);
ipcMain.handle('sound:test', (_e, preset, cfg) => { playSound(preset, cfg || store.get().hub || {}); return true; });
ipcMain.handle('sound:pick', async () => { const r = await dialog.showOpenDialog({ title: 'Escolher som', filters: [{ name: 'Áudio', extensions: ['wav', 'mp3', 'ogg', 'm4a'] }], properties: ['openFile'] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('hub:login', async (_e, email, password) => { try { return { ok: true, state: await hub.login(email, password) }; } catch (e) { return { ok: false, error: String(e && e.message || e), state: hub.state() }; } });
ipcMain.handle('hub:logout', () => { hub.logout(); broadcast('hub', hub.state()); return hub.state(); });
ipcMain.handle('hub:sync', async () => { await hub.sync(); return hub.state(); });
ipcMain.handle('hub:read', async (_e, id) => { try { await hub.markRead(id); } catch (e) { return { ok: false, error: String(e.message || e) }; } return { ok: true, state: hub.state() }; });
ipcMain.handle('hub:task', async (_e, id, status) => { try { await hub.setTaskStatus(id, status); } catch (e) { return { ok: false, error: String(e.message || e) }; } return { ok: true, state: hub.state() }; });
ipcMain.handle('hub:open', (_e, link, notifId) => { openHubLink(link, notifId); return true; });
ipcMain.handle('hub:check-path', (_e, p) => ({ allowed: hub ? hub.allowedPath(p) : false, ...(hub ? hub.moduleForPath(p) : {}) }));
ipcMain.handle('hub:create-task', async (_e, t) => { try { const r = await hub.createTask(t || {}); return { ok: true, task: r, state: hub.state() }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; } });
// ---------- foco ----------
ipcMain.handle('focus:get', () => focus ? focus.state() : null);
ipcMain.handle('focus:start', (_e, task) => focus ? focus.start(task || {}) : null);
ipcMain.handle('focus:toggle', (_e, task) => focus ? focus.toggle(task || null) : null);
ipcMain.handle('focus:pause', () => focus ? focus.pause() : null);
ipcMain.handle('focus:stop', () => focus ? focus.stop('user') : null);
ipcMain.handle('focus:complete', async (_e, id, kind) => { if (!focus) return null; await focus.complete(id, kind); return focus.state(); });
ipcMain.handle('focus:refresh', async () => { if (!focus) return null; await focus.flush(); await focus.refresh(); return focus.state(); });
ipcMain.handle('hub:task-estimate', async (_e, id, min) => { try { await hub.setTaskEstimate(id, min); return { ok: true, state: hub.state() }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
ipcMain.handle('hub:task-update', async (_e, id, patch) => { try { await hub.updateTask(id, patch || {}); return { ok: true, state: hub.state() }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
ipcMain.handle('hub:task-delete', async (_e, id) => { try { await hub.deleteTask(id); return { ok: true, state: hub.state() }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
ipcMain.handle('tasks:open', () => { openTasksWindow(); return true; });
// ---------- quadro de Sistemas ----------
ipcMain.handle('board:open', () => { openBoardWindow(); return true; });
ipcMain.handle('board:get', async (_e, force) => { if (!hub || !hub.hasBoard()) return null; if (force) await hub.loadBoard().catch(() => {}); return { board: hub.board, feed: hub.boardFeed, alerts: hub.boardAlerts, people: hub.board && hub.board.people }; });
ipcMain.handle('board:feed', async (_e, n) => { if (!hub || !hub.hasBoard()) return []; return hub.loadBoardFeed(n || 40).catch(() => []); });
ipcMain.handle('board:alerts', async () => { const cfg = store.get().board || {}; if (!hub || !hub.hasBoard()) return null; return hub.loadBoardAlerts({ semDonoHoras: cfg.semDonoHoras, paradoDias: cfg.paradoDias, wip: cfg.wip }).catch(() => null); });
ipcMain.handle('board:take', async (_e, id, startDev) => { try { await hub.boardTake(id, startDev !== false); return { ok: true, state: hub.state() }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
ipcMain.handle('board:move', async (_e, id, status, motivo) => { try { await hub.boardMove(id, status, motivo); return { ok: true, state: hub.state() }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
ipcMain.handle('board:block', async (_e, id, on, motivo) => { try { await hub.boardBlock(id, on, motivo); return { ok: true, state: hub.state() }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
ipcMain.handle('board:brief', async (_e, kind) => { await sendBrief(kind === 'tarde' ? 'tarde' : 'manha'); return true; });
ipcMain.on('app:quit', () => app.exit(0));
ipcMain.on('app:open-url', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
