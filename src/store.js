// Armazenamento simples de configurações em JSON (userData/settings.json)
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  side: 'right',              // 'left' | 'right'
  vertical: 'center',         // 'top' | 'center' | 'bottom' | 'custom' (arrastado)
  offset: 0,                  // deslocamento vertical em px a partir da posição escolhida
  y: null,                    // posição absoluta (vertical === 'custom')
  displayId: null,            // monitor (null = primário)
  refreshSeconds: 180,        // intervalo de atualização
  collapsedWidth: 6,          // largura da "notch" fechada
  compact: 'off',            // 'off' | 'dots' | 'percent' — o que aparece na notch fechada
  autoLaunch: false,
  dnd: false,                 // não perturbe: sem som, sem toast, sem abrir sozinha
  providers: {
    claude:      { enabled: false, token: '' },
    codex:       { enabled: false },
    cursor:      { enabled: false, cookie: '' },
    gemini:      { enabled: false },
    antigravity: { enabled: false },
    openrouter:  { enabled: false, apiKey: '' },
    nvidia:      { enabled: false, apiKey: '' },
    opencode:    { enabled: false }
  },
  order: ['claude', 'codex', 'cursor', 'gemini', 'antigravity', 'openrouter', 'nvidia', 'opencode'],
  approvals: {
    enabled: false,            // edição Medsystem: hooks do Claude Code desligados por padrão
    port: 47322,               // porta diferente do SideNotch padrão para conviverem
    token: '',
    timeoutSec: 110,
    sound: true
  },
  notifications: {
    done: true,               // "Claude terminou"
    waiting: true,            // "Claude está esperando você"
    denied: true,             // avisos do auto mode
    toast: true,              // notificação nativa do Windows além do cartão
    autoDismissSec: 20
  },
  alerts: {
    enabled: true,
    thresholds: [80, 95],     // % usado
    onReset: true             // avisa quando a janela reinicia
  },
  shortcuts: { toggle: '', approve: '', deny: '', hub: '', clip: '', capture: 'CommandOrControl+Shift+X', captures: 'CommandOrControl+Shift+H', focus: 'CommandOrControl+Shift+F', tasks: '', board: 'CommandOrControl+Shift+K' },
  // quadro do time de Sistemas (Kanban + cobranças + brief)
  board: { enabled: true, notifyMoves: true, notifyStuck: true, notifyNew: true, brief: true, briefManha: '09:00', briefTarde: '18:00', sound: true, wip: 2, semDonoHoras: 24, paradoDias: 2, swimlanes: false, takeOnFocus: true },
  // foco (pomodoro) nas tarefas do Hub
  focus: { minutes: 25, breakMinutes: 5, autoStatus: true, chime: true, pill: true, streak: true },
  quickaccess: { side: 'left', ttlSec: 0 },   // pilha de capturas: canto (left/right) e auto-dismiss em segundos (0 = nunca)
  clipboard: { enabled: true, max: 60 },   // histórico da área de transferência (aba no notch)   // ex.: "CommandOrControl+Shift+Space"
  update: { auto: true },
  maestri: {                  // Maestri Wire (https://www.themaestri.app/pt-br/docs/wire)
    enabled: false, host: '127.0.0.1', port: 7434, token: '', keyHash: '', deviceId: '', deviceIdentifier: '', role: '', alternateHosts: [],
    pollSeconds: 4, notifyAttention: true
  },
  notch: {                    // notch no topo do monitor (convive com a barra lateral)
    enabled: true, displayId: null, offsetX: 0,
    show: { music: true, system: true, calendar: true, clock: true, weather: true, hub: true },
    tab: 'hub'
  },
  sidebar: { enabled: true, aiTools: true },
  docks: {                    // dois docks independentes, cada um com lado / posição / monitor
    hub: { enabled: true, side: 'right', vertical: 'center', offset: 0, y: null, displayId: null, compact: 'dots', gear: { gap: 12, size: 40, arc: 255, dx: 0 } },
    ai:  { enabled: true, side: 'left',  vertical: 'center', offset: 0, y: null, displayId: null, compact: 'dots', gear: { gap: 12, size: 40, arc: 255, dx: 0 } }
  },   // aiTools: botões de sessões do Claude Code / não perturbe na barra
  webapps: null,              // null = lista padrão (apps.DEFAULT_WEBAPPS); [{id,name,url}]
  pinnedApps: [],             // ids de apps do Menu Iniciar fixados
  calendar: { sources: [], refreshMinutes: 15 },  // [{name, url, color}]
  weather: { lat: '', lon: '', label: '' },        // vazio = localização automática por IP
  hub: {                      // Medsystem Hub (Supabase). Sessão fica cifrada em hub-session.bin (DPAPI), nunca aqui.
    enabled: true, url: '', anon: '', site: '',     // vazios = padrão do Hub de produção
    pollSeconds: 60, notify: true, toast: false, sound: true, markReadOnOpen: true, showBadge: true, pinned: [], dockCount: 5, dock: [], custom: [], chatNotify: true,   // dock: ids dos atalhos no dock (ordem); custom: [{id,name,path,ix,kind}]
    soundPreset: 'pop', soundChat: 'message', volume: 0.6, soundFile: ''   // presets: pop | bell | message | soft | chime | windows | file | none
  }
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = this._load();
  }
  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return deepMerge(structuredClone(DEFAULTS), raw);
    } catch { return structuredClone(DEFAULTS); }
  }
  get() { return this.data; }
  set(patch) {
    this.data = deepMerge(this.data, patch);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return this.data;
  }
}

function deepMerge(a, b) {
  for (const k of Object.keys(b || {})) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') a[k] = deepMerge(a[k], b[k]);
    else a[k] = b[k];
  }
  return a;
}

module.exports = { Store, DEFAULTS };
