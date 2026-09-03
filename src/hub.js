// Medsystem Hub — cliente Supabase enxuto (Auth + PostgREST + Realtime) sem depender do supabase-js.
// O app só LÊ (notificações, tarefas, perfil) e grava duas coisas: notificacoes.lida e tasks.status do próprio usuário.
// A anon key é pública (já vai no bundle do site); toda autorização vem das RLS do Hub.
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const DEFAULT_URL = 'https://xyhkkwajxdlnpxdrmthg.supabase.co';
const DEFAULT_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5aGtrd2FqeGRsbnB4ZHJtdGhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0NzY2MDYsImV4cCI6MjA4NDA1MjYwNn0.bp6MjBvR7XSUDGa5u1pM99Lcaz9k-myTRE7aj4flPdE';
const DEFAULT_SITE = 'https://medsystem-hub.vercel.app';

// Mesmo fallback do Hub (src/stores/authStore.ts) — usado só se as tabelas de permissão não responderem.
const SECTOR_MODULE_ACCESS = {
  'ti-sistemas': ['dashboard', 'tarefas', 'comunicacao', 'onboarding', 'chamados', 'newsletters', 'logistica'],
  'assistencia-tecnica': ['dashboard', 'tarefas', 'comunicacao', 'chamados'],
  'calibracao': ['dashboard', 'tarefas', 'comunicacao', 'chamados'],
  'logistica': ['dashboard', 'tarefas', 'comunicacao', 'chamados', 'logistica'],
  'engenharia': ['dashboard', 'tarefas', 'comunicacao', 'chamados', 'engenharia-clinica'],
  'comercial': ['dashboard', 'tarefas', 'comunicacao', 'chamados', 'licitacao'],
  'rh': ['dashboard', 'tarefas', 'comunicacao', 'chamados', 'onboarding'],
  'administrativo': ['dashboard', 'tarefas', 'comunicacao', 'chamados', 'onboarding', 'licitacao', 'logistica'],
  'ecommerce-marketing': ['dashboard', 'tarefas', 'comunicacao', 'chamados', 'marketing']
};
const ROLE_MODULE_ACCESS = { 'adm-rh': ['dashboard', 'tarefas', 'comunicacao', 'chamados', 'chat', 'onboarding', 'agenda-compartilhada', 'planos-acao', 'logistica', 'rh'] };

// Atalhos do lançador: {id, name, path, module (null = sempre), icon (emoji, fallback), ix (nome do ícone Iconsax), kind: 'form' | 'page'}
const SHORTCUTS = [
  { id: 'chamado', name: 'Abrir chamado', path: '/chamados', module: 'chamados', icon: '🎧', ix: 'Headphone', kind: 'form' },
  { id: 'reportar', name: 'Reportar problema', path: '/sistemas/ideias/reportar', module: null, icon: '🐞', ix: 'Danger', kind: 'form' },
  { id: 'tarefas', name: 'Minhas tarefas', path: '/tarefas', module: 'tarefas', icon: '✅', ix: 'TaskSquare', kind: 'page' },
  { id: 'demanda', name: 'Nova demanda', path: '/demandas', module: 'demandas', icon: '📌', ix: 'Flag', kind: 'form' },
  { id: 'cotacao', name: 'Nova cotação', path: '/compras/cotacoes/nova', module: 'compras', icon: '🧾', ix: 'Receipt2', kind: 'form' },
  { id: 'pedido-internet', name: 'Pedido internet', path: '/compras/pedidos-internet/novo', module: 'compras', icon: '🛒', ix: 'ShoppingCart', kind: 'form' },
  { id: 'cotacao-item', name: 'Cotação de item', path: '/cotacao-item', module: 'cotacao-item', icon: '🔍', ix: 'SearchZoomIn', kind: 'form' },
  { id: 'ideia', name: 'Nova ideia (PEM)', path: '/sistemas/ideias/nova', module: 'sistemas', icon: '💡', ix: 'Lamp', kind: 'form' },
  { id: 'sistema', name: 'Novo sistema', path: '/sistemas/novo', module: 'sistemas', icon: '🧩', ix: 'Code', kind: 'form' },
  { id: 'nf', name: 'Solicitar NF', path: '/financeiro/solicitacoes/nova-nf', module: 'financeiro-solicitacoes', icon: '📄', ix: 'DocumentText', kind: 'form' },
  { id: 'marketing', name: 'Produção marketing', path: '/marketing/nova', module: 'marketing', icon: '🎨', ix: 'Brush2', kind: 'form' },
  { id: 'logistica', name: 'Logística', path: '/logistica', module: 'logistica', icon: '🚚', ix: 'Truck', kind: 'page' },
  { id: 'agenda', name: 'Agenda', path: '/agenda', module: 'agenda-compartilhada', icon: '📅', ix: 'Calendar1', kind: 'page' },
  { id: 'comunicacao', name: 'Comunicação', path: '/comunicacao', module: 'comunicacao', icon: '📣', ix: 'VolumeHigh', kind: 'page' },
  { id: 'onboarding', name: 'Documentação', path: '/onboarding', module: 'onboarding', icon: '📚', ix: 'Book1', kind: 'page' },
  { id: 'licitacao', name: 'Licitações', path: '/licitacao/filtros', module: 'licitacao', icon: '⚖️', ix: 'Judge', kind: 'page' },
  { id: 'eng', name: 'Engenharia clínica', path: '/engenharia-clinica', module: 'engenharia-clinica', icon: '🩺', ix: 'Health', kind: 'page' },
  { id: 'rh', name: 'RH', path: '/rh', module: 'rh', icon: '👥', ix: 'People', kind: 'page' },
  { id: 'chat', name: 'Chat', path: '/chat', module: 'chat', icon: '💬', ix: 'MessageText', kind: 'page' },
  { id: 'planos', name: 'Planos de ação', path: '/planos-acao', module: 'planos-acao', icon: '🎯', ix: 'Flag', kind: 'page' },
  { id: 'fluxos', name: 'Fluxos', path: '/fluxos', module: 'fluxos', icon: '🔁', ix: 'Repeat', kind: 'page' },
  { id: 'dashboard', name: 'Dashboard', path: '/dashboard', module: null, icon: '🏠', ix: 'Element3', kind: 'page' },
  // ---- mais páginas e formulários do Hub (aparecem só para quem tem o módulo) ----
  { id: 'contatos', name: 'Organizador de Contato', path: '/contatos', module: null, icon: '💬', ix: 'Whatsapp', kind: 'page' },
  { id: 'contatos-board', name: 'Kanban de conversas', path: '/contatos/board', module: null, icon: '📋', ix: 'Element3', kind: 'page' },
  { id: 'ideias-central', name: 'Central de Ideias', path: '/sistemas/ideias', module: 'sistemas', icon: '💡', ix: 'Lamp', kind: 'page' },
  { id: 'sistemas', name: 'Sistemas', path: '/sistemas', module: 'sistemas', icon: '🧩', ix: 'Code', kind: 'page' },
  { id: 'compras', name: 'Compras', path: '/compras', module: 'compras', icon: '🛒', ix: 'ShoppingCart', kind: 'page' },
  { id: 'pedidos-internet', name: 'Pedidos internet', path: '/compras/pedidos-internet', module: 'compras', icon: '🛒', ix: 'Global', kind: 'page' },
  { id: 'estoque', name: 'Estoque', path: '/estoque', module: 'estoque', icon: '📦', ix: 'Box', kind: 'page' },
  { id: 'veiculos', name: 'Veículos', path: '/veiculos', module: 'veiculos', icon: '🚗', ix: 'Truck', kind: 'page' },
  { id: 'mais-pratico', name: 'Mais Prático', path: '/mais-pratico', module: 'mais-pratico', icon: '🗂️', ix: 'Folder', kind: 'page' },
  { id: 'newsletters', name: 'Newsletters', path: '/newsletters', module: 'newsletters', icon: '📰', ix: 'DocumentText', kind: 'page' },
  { id: 'cursos', name: 'Cursos', path: '/cursos', module: 'cursos', icon: '🎓', ix: 'Book1', kind: 'page' },
  { id: 'cowork', name: 'Cowork Monitor', path: '/cowork-monitor', module: 'cowork-monitor', icon: '🖥️', ix: 'Monitor', kind: 'page' },
  { id: 'fin-inad', name: 'Inadimplentes', path: '/financeiro/inadimplentes', module: 'financeiro-inadimplentes', icon: '💳', ix: 'Receipt2', kind: 'page' },
  { id: 'fin-nf', name: 'Notas fiscais', path: '/financeiro/notas-fiscais', module: 'financeiro-notas-fiscais', icon: '🧾', ix: 'DocumentText', kind: 'page' },
  { id: 'fin-sol', name: 'Solicitações financeiras', path: '/financeiro/solicitacoes', module: 'financeiro-solicitacoes', icon: '💰', ix: 'Receipt2', kind: 'page' },
  { id: 'qualidade', name: 'Planejamento da qualidade', path: '/planejamento-qualidade', module: 'planejamento-qualidade', icon: '✅', ix: 'ArchiveTick', kind: 'page' },
  { id: 'precos', name: 'Formação de preços', path: '/formacao-precos', module: 'formacao-precos', icon: '🏷️', ix: 'Receipt2', kind: 'page' },
  { id: 'pos-venda', name: 'Pós-venda', path: '/pos-venda', module: 'pos-venda', icon: '🤝', ix: 'People', kind: 'page' },
  { id: 'efetivacao', name: 'Efetivação de clientes', path: '/efetivacao-clientes', module: 'efetivacao-clientes', icon: '📝', ix: 'ArchiveTick', kind: 'form' },
  { id: 'portais', name: 'Portais', path: '/comercial/portais', module: 'portais', icon: '🌐', ix: 'Global', kind: 'page' },
  { id: 'comercial', name: 'Comercial', path: '/comercial', module: 'comercial', icon: '📈', ix: 'Element3', kind: 'page' },
  { id: 'cal-painel', name: 'Calibração · painel', path: '/calibracao/painel', module: 'setor-calibracao', icon: '🎛️', ix: 'Cpu', kind: 'page' },
  { id: 'cal-padroes', name: 'Calibração · padrões', path: '/calibracao/padroes', module: 'calibracao-padroes', icon: '📏', ix: 'Cpu', kind: 'page' },
  { id: 'cal-prop', name: 'Calibração · propostas', path: '/calibracao/propostas', module: 'calibracao-propostas', icon: '📄', ix: 'DocumentText', kind: 'form' },
  { id: 'at-painel', name: 'AT · painel', path: '/assistencia-tecnica/painel', module: 'setor-assistencia-tecnica', icon: '🔧', ix: 'Monitor', kind: 'page' },
  { id: 'at-fluxo', name: 'AT · fluxo', path: '/assistencia-tecnica/fluxo', module: 'assistencia-tecnica-fluxo', icon: '🔁', ix: 'Repeat', kind: 'page' },
  { id: 'at-os', name: 'AT · ordens de serviço', path: '/assistencia-tecnica/ordens', module: 'assistencia-tecnica-os', icon: '🛠️', ix: 'Driver', kind: 'page' },
  { id: 'locacao', name: 'Locação', path: '/locacao/painel', module: 'locacao-painel', icon: '🏢', ix: 'Building', kind: 'page' },
  { id: 'odonto', name: 'Odonto', path: '/odonto/financeiro', module: 'setor-odonto', icon: '🦷', ix: 'Health', kind: 'page' },
  { id: 'projetos', name: 'Projetos', path: '/projetos/dashboard', module: 'setor-projetos', icon: '📐', ix: 'Element3', kind: 'page' },
  { id: 'filiais', name: 'Filiais', path: '/filiais', module: 'setor-filiais', icon: '🏬', ix: 'Building', kind: 'page' },
  { id: 'ecommerce', name: 'E-commerce', path: '/e-commerce', module: 'e-commerce', icon: '🛍️', ix: 'ShoppingCart', kind: 'page' },
  { id: 'auditoria', name: 'Auditoria', path: '/auditoria', module: 'auditoria', icon: '🔎', ix: 'SearchZoomIn', kind: 'page' },
  { id: 'diretoria', name: 'Diretoria', path: '/diretoria', module: 'diretoria', icon: '🏛️', ix: 'Building', kind: 'page' },
  { id: 'onboarding-rh', name: 'Onboarding RH', path: '/onboarding-rh', module: 'onboarding-rh', icon: '🧑‍💼', ix: 'People', kind: 'page' },
  { id: 'docs-novo', name: 'Novo artigo (documentação)', path: '/onboarding/admin/articles/new', module: 'onboarding', icon: '📝', ix: 'DocumentText', kind: 'form' },
  { id: 'automacoes', name: 'Automações', path: '/automacoes', module: 'automacoes', icon: '⚙️', ix: 'Setting2', kind: 'page' }
];

function decodeJwt(t) { try { return JSON.parse(Buffer.from(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return {}; } }

class HubClient extends EventEmitter {
  /**
   * @param {object} o  { dir, getCfg, secret: { encrypt(str)->Buffer, decrypt(Buffer)->str } | null, url, anon, site, fetch, WebSocket }
   */
  constructor(o = {}) {
    super();
    this.dir = o.dir; this.getCfg = o.getCfg || (() => ({}));
    this.secret = o.secret || null;
    this.url = (o.url || DEFAULT_URL).replace(/\/$/, ''); this.anon = o.anon || DEFAULT_ANON; this.site = (o.site || DEFAULT_SITE).replace(/\/$/, '');
    this.fetch = o.fetch || globalThis.fetch; this.WebSocket = o.WebSocket || null;
    this.session = null;           // { access_token, refresh_token, expires_at, user: {id,email} }
    this.web = null;               // 2ª sessão (família de refresh token própria) injetada na janela do Hub para não pedir login de novo
    this.profile = null;           // { name, email, sector:{slug,name}, role:{slug,level}, modules:[] }
    this.notifications = []; this.tasks = []; this.agenda = []; this.chats = []; this.instances = []; this.error = null; this.connected = false; this.realtime = 'off';
    this.board = null; this.boardFeed = []; this.boardAlerts = null; this.boardAt = 0;
    this.ws = null; this.hb = null; this.refreshTimer = null; this.pollTimer = null; this.ref = 0; this.lastSig = '';
    this.sessionFile = this.dir ? path.join(this.dir, 'hub-session.bin') : null;
  }

  // ---------- sessão ----------
  _saveSession() {
    if (!this.sessionFile) return;
    try {
      if (!this.session) { fs.rmSync(this.sessionFile, { force: true }); return; }
      const raw = JSON.stringify({ refresh_token: this.session.refresh_token, email: this.session.user.email, web: this.web || null });
      const buf = this.secret ? this.secret.encrypt(raw) : Buffer.from(raw, 'utf8');
      fs.mkdirSync(path.dirname(this.sessionFile), { recursive: true });
      fs.writeFileSync(this.sessionFile, buf);
    } catch (e) { this.error = 'Não consegui guardar a sessão: ' + e.message; }
  }
  _loadSession() {
    if (!this.sessionFile || !fs.existsSync(this.sessionFile)) return null;
    try { const buf = fs.readFileSync(this.sessionFile); return JSON.parse(this.secret ? this.secret.decrypt(buf) : buf.toString('utf8')); } catch { return null; }
  }
  linked() { return !!(this.session && this.session.refresh_token) || !!this._loadSession(); }

  async _auth(grant, body) {
    const res = await this.fetch(`${this.url}/auth/v1/token?grant_type=${grant}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: this.anon }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error_description || j.msg || j.message || j.error || `HTTP ${res.status}`);
    const exp = decodeJwt(j.access_token).exp;
    this.session = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: exp ? exp * 1000 : Date.now() + 3600000, user: { id: j.user && j.user.id, email: j.user && j.user.email } };
    this._saveSession(); this._scheduleRefresh();
    return this.session;
  }
  _scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    if (!this.session) return;
    const ms = Math.max(30000, this.session.expires_at - Date.now() - 120000);
    this.refreshTimer = setTimeout(() => this.refreshSession().catch(() => {}), ms);
  }
  async login(email, password) {
    await this._auth('password', { email: String(email).trim(), password });
    // segunda sessão independente para o site (supabase-js roda a própria rotação de refresh token; se compartilhássemos a mesma, uma derrubaria a outra)
    try {
      const res = await this.fetch(`${this.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: this.anon }, body: JSON.stringify({ email: String(email).trim(), password }) });
      const j = await res.json();
      if (res.ok && j.access_token) { const exp = decodeJwt(j.access_token).exp; this.web = { ...j, expires_at: exp || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), token_type: 'bearer' }; this._saveSession(); }
    } catch { /* sem sessão web: o usuário loga uma vez na janela */ }
    await this.loadProfile();
    await this.sync();
    this.connect();
    this.emit('change');
    return this.state();
  }
  // sessão para o localStorage do site (chave sb-<ref>-auth-token); só entrega uma vez por janela
  webSession() {
    if (!this.web) { const s = this._loadSession(); if (s && s.web) this.web = s.web; }
    if (!this.web) return null;
    const ref = (new URL(this.url).hostname.split('.')[0]) || 'supabase';
    return { key: `sb-${ref}-auth-token`, value: JSON.stringify(this.web) };
  }
  refreshSession() {
    // chamadas paralelas compartilham o mesmo refresh (o refresh token é de uso único)
    if (!this._refreshing) this._refreshing = this._refreshNow().finally(() => { this._refreshing = null; });
    return this._refreshing;
  }
  async _refreshNow() {
    const rt = this.session ? this.session.refresh_token : (this._loadSession() || {}).refresh_token;
    if (!rt) throw new Error('não vinculado');
    try { await this._auth('refresh_token', { refresh_token: rt }); this.error = null; }
    catch (e) {
      // refresh inválido/revogado → desvincula (o admin desativou ou a sessão expirou)
      if (/invalid|revoked|not found|expired/i.test(e.message)) { this.logout(); this.error = 'Sessão expirada — vincule de novo.'; this.emit('change'); }
      throw e;
    }
    return this.session;
  }
  logout() {
    clearTimeout(this.refreshTimer); clearInterval(this.pollTimer); this._closeWs();
    if (this.session) { this.fetch(`${this.url}/auth/v1/logout`, { method: 'POST', headers: this._h() }).catch(() => {}); }
    this.session = null; this.web = null; this.profile = null; this.notifications = []; this.tasks = []; this.agenda = []; this.chats = []; this.instances = []; this.connected = false;
    this._saveSession();
  }

  // ---------- REST ----------
  _h(extra = {}) { return { apikey: this.anon, Authorization: `Bearer ${this.session.access_token}`, 'Content-Type': 'application/json', ...extra }; }
  async _ensure() {
    if (!this.session) { const s = this._loadSession(); if (!s) throw new Error('não vinculado'); this.web = s.web || null; await this.refreshSession(); }
    else if (this.session.expires_at - Date.now() < 60000) await this.refreshSession();
  }
  async rest(method, pathq, body, extra) {
    await this._ensure();
    const res = await this.fetch(`${this.url}/rest/v1/${pathq}`, { method, headers: this._h(extra), body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) { await this.refreshSession(); return this.rest(method, pathq, body, extra); }
    const text = await res.text();
    if (!res.ok) { let m = text; try { m = JSON.parse(text).message || text; } catch { /* texto */ } throw new Error(`${m} (HTTP ${res.status})`); }
    return text ? JSON.parse(text) : null;
  }
  async rpc(name, args) { return this.rest('POST', `rpc/${name}`, args || {}); }

  async loadProfile() {
    const uid = this.session.user.id;
    let p = null;
    try { p = await this.rpc('get_user_profile', { _user_id: uid }); } catch { /* cai no select */ }
    if (!p || !p.id) {
      const rows = await this.rest('GET', `profiles?id=eq.${uid}&select=id,name,email,sector_id,sectors(name,slug)`).catch(() => []);
      const r = rows && rows[0] || {};
      p = { id: uid, name: r.name, email: r.email || this.session.user.email, sector: r.sectors ? { id: r.sector_id, name: r.sectors.name, slug: r.sectors.slug } : null, role: null };
    }
    const role = p.role || {};
    this.profile = { id: uid, name: p.name || p.full_name || this.session.user.email, email: p.email || this.session.user.email, sector: p.sector || null, role: { slug: role.slug || '', name: role.name || '', level: Number(role.level) || 0 }, modules: [] };
    this.profile.modules = await this._modules().catch(() => ['dashboard']);
    return this.profile;
  }
  async _modules() {
    const pr = this.profile; const uid = pr.id;
    const all = await this.rest('GET', 'modules?select=id,slug').catch(() => null);
    const slugOf = (id) => all && (all.find((m) => m.id === id) || {}).slug;
    if (pr.role.level >= 100 && all) return all.map((m) => m.slug);
    let base = ['dashboard'];
    if (pr.sector && pr.sector.id) {
      const rows = await this.rest('GET', `sector_module_access?sector_id=eq.${pr.sector.id}&select=module_id,is_enabled`).catch(() => null);
      const fromDb = rows && rows.filter((r) => r.is_enabled).map((r) => slugOf(r.module_id)).filter(Boolean);
      base = fromDb && fromDb.length ? fromDb : (SECTOR_MODULE_ACCESS[pr.sector.slug] || ['dashboard']);
    }
    if (ROLE_MODULE_ACCESS[pr.role.slug]) base = [...new Set([...base, ...ROLE_MODULE_ACCESS[pr.role.slug]])];
    const custom = await this.rest('GET', `user_module_access?user_id=eq.${uid}&select=module_id,has_access`).catch(() => null);
    if (custom && custom.length && all) {
      const ov = {}; for (const c of custom) { const s = slugOf(c.module_id); if (s) ov[s] = !!c.has_access; }
      base = all.map((m) => m.slug).filter((s) => (s in ov ? ov[s] : base.includes(s)));
    }
    if (pr.role.level >= 90 && !base.includes('chamados')) base.push('chamados');
    return base;
  }

  async loadNotifications() {
    const uid = this.session.user.id;
    this.notifications = await this.rest('GET', `notificacoes?usuario_id=eq.${uid}&select=id,tipo,titulo,mensagem,link,lida,created_at&order=created_at.desc&limit=60`) || [];
    return this.notifications;
  }
  async loadTasks() {
    const uid = this.session.user.id;
    const [gerais, at] = await Promise.all([
      this.rest('GET', `tasks?or=(assignee_id.eq.${uid},created_by.eq.${uid})&status=neq.completed&select=id,title,description,status,priority,due_date,created_at,assignee_id,created_by&order=due_date.asc.nullslast,created_at.desc&limit=60`).then((r) => (r || []).map((t) => ({ ...t, source: 'geral', label: null, link: `/tarefas?id=${t.id}` }))),
      // OS que o Fluxo da AT encarregou ao usuário (mesma fonte da Central de Tarefas do Hub)
      this.rest('GET', `at_os_tarefa?responsavel=eq.${uid}&situacao=not.in.(concluida,cancelada)&select=id,codigo_os,cliente,equipamento,urgencia,situacao,prazo,observacao,criado_em&order=prazo.asc.nullslast,criado_em.desc&limit=80`).then((r) => (r || []).map((t) => ({
        id: 'at:' + t.id, title: `OS ${t.codigo_os}${t.cliente ? ' · ' + t.cliente : ''}`, description: [t.equipamento, t.observacao].filter(Boolean).join(' — '),
        status: { pendente: 'pending', em_andamento: 'in_progress' }[t.situacao] || 'pending', priority: { baixa: 'low', media: 'medium', alta: 'high', critica: 'urgent' }[t.urgencia] || 'medium',
        due_date: t.prazo, created_at: t.criado_em, source: 'at', label: `AT · OS ${t.codigo_os}`, link: '/assistencia-tecnica/fluxo/tarefas', codigoOs: t.codigo_os
      }))).catch(() => [])
    ]);
    const all = [...gerais, ...at];
    all.sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : (a.due_date || '9999') > (b.due_date || '9999') ? 1 : (b.created_at || '').localeCompare(a.created_at || ''));
    this.tasks = all;
    return all;
  }
  async sync() {
    try {
      await Promise.all([this.loadNotifications(), this.loadTasks(), this.loadAgenda().catch(() => {}), this.loadChats().catch(() => {}),
        this.hasBoard() ? Promise.all([this.loadBoard().catch(() => {}), this.loadBoardFeed().catch(() => {}), this.loadBoardAlerts().catch(() => {})]) : Promise.resolve()]);
      this.error = null; this.connected = true;
    }
    catch (e) { this.error = String(e.message || e); this.connected = false; }
    this._emitIfChanged();
  }
  _emitIfChanged() {
    const sig = JSON.stringify([this.notifications.map((n) => n.id + n.lida), this.tasks.map((t) => t.id + t.status), this.board && (this.board.cards || []).map((c) => c.id + c.status + (c.responsavel_id || '') + (c.bloqueado ? 1 : 0)), (this.boardFeed || []).length && this.boardFeed[0].id, this.agenda.map((e) => e.id + e.start), this.chats.map((c) => c.id + c.unread + c.at + (c.mine ? 1 : 0)), this.error, this.realtime]);
    if (sig !== this.lastSig) { this.lastSig = sig; this.emit('change'); }
  }
  async markRead(id) {
    if (id === '*') { await this.rest('PATCH', `notificacoes?usuario_id=eq.${this.session.user.id}&lida=eq.false`, { lida: true }, { Prefer: 'return=minimal' }); for (const n of this.notifications) n.lida = true; }
    else { await this.rest('PATCH', `notificacoes?id=eq.${id}`, { lida: true }, { Prefer: 'return=minimal' }); const n = this.notifications.find((x) => x.id === id); if (n) n.lida = true; }
    this._emitIfChanged();
  }
  async setTaskStatus(id, status) {
    if (!['pending', 'in_progress', 'completed'].includes(status)) throw new Error('status inválido');
    if (String(id).startsWith('at:')) await this.rest('PATCH', `at_os_tarefa?id=eq.${id.slice(3)}&responsavel=eq.${this.session.user.id}`, { situacao: { pending: 'pendente', in_progress: 'em_andamento', completed: 'concluida' }[status] }, { Prefer: 'return=minimal' });
    else await this.rest('PATCH', `tasks?id=eq.${id}&or=(assignee_id.eq.${this.session.user.id},created_by.eq.${this.session.user.id})`, { status }, { Prefer: 'return=minimal' });
    if (status === 'completed') this.tasks = this.tasks.filter((t) => t.id !== id); else { const t = this.tasks.find((x) => x.id === id); if (t) t.status = status; }
    this._emitIfChanged();
  }

  // cria tarefa avulsa para si mesmo (mesmos campos da página /tarefas; a RLS exige created_by = eu e assignee = eu)
  async createTask({ title, description, due_date, priority }) {
    title = String(title || '').trim(); if (!title) throw new Error('título obrigatório');
    const uid = this.session.user.id;
    const row = { title: title.slice(0, 255), description: description ? String(description).slice(0, 4000) : null, priority: ['low', 'medium', 'high', 'urgent'].includes(priority) ? priority : 'medium', status: 'pending', due_date: due_date || null, assignee_id: uid, created_by: uid, sector_id: this.profile && this.profile.sector ? this.profile.sector.id : null };
    const out = await this.rest('POST', 'tasks?select=id,title,description,status,priority,due_date,created_at', row, { Prefer: 'return=representation' });
    const t = Array.isArray(out) ? out[0] : out;
    if (t) { this.tasks.unshift({ ...t, source: 'geral', label: null, link: `/tarefas?id=${t.id}` }); this._emitIfChanged(); }
    return t;
  }

  // ---------- foco (pomodoro) ----------
  // grava a sessão e soma o tempo na própria tarefa (RPC focus_log)
  async logFocus({ taskId, seconds, planned, completed, startedAt, title, kind }) {
    const secs = Math.max(0, Math.round(seconds || 0)); if (secs < 5) return null;
    const at = String(taskId || '').startsWith('at:');
    return this.rpc('focus_log', {
      p_task_id: taskId ? (at ? taskId.slice(3) : taskId) : null,
      p_task_kind: taskId ? (kind || (at ? 'at' : 'task')) : 'free',
      p_task_title: title ? String(title).slice(0, 200) : null,
      p_seconds: secs, p_planned_seconds: Math.max(60, Math.round(planned || 1500)), p_completed: !!completed,
      p_started_at: new Date(startedAt || Date.now() - secs * 1000).toISOString()
    });
  }
  // dias com foco (heatmap) + streak atual
  async focusSummary(days = 84) {
    const r = await this.rpc('focus_summary', { p_days: days });
    const s = Array.isArray(r) ? r[0] : r;
    return s && typeof s === 'object' ? { days: s.days || [], streak: s.streak || 0, today: s.today || 0, total: s.total || 0 } : { days: [], streak: 0, today: 0, total: 0 };
  }
  // estimativa em minutos que aparece no chip da tarefa
  async setTaskEstimate(id, minutes) {
    if (String(id).startsWith('at:')) return false;
    const m = minutes == null ? null : Math.max(1, Math.min(600, Math.round(minutes)));
    await this.rest('PATCH', `tasks?id=eq.${id}&or=(assignee_id.eq.${this.session.user.id},created_by.eq.${this.session.user.id})`, { focus_estimate_min: m }, { Prefer: 'return=minimal' });
    const t = this.tasks.find((x) => x.id === id); if (t) t.focus_estimate_min = m;
    this._emitIfChanged(); return true;
  }
  async deleteTask(id) {
    if (String(id).startsWith('at:')) throw new Error('OS da AT não pode ser apagada aqui');
    await this.rest('DELETE', `tasks?id=eq.${id}&created_by=eq.${this.session.user.id}`, undefined, { Prefer: 'return=minimal' });
    this.tasks = this.tasks.filter((t) => t.id !== id); this._emitIfChanged(); return true;
  }
  async updateTask(id, { title, description, due_date, priority }) {
    if (String(id).startsWith('at:')) throw new Error('OS da AT não pode ser editada aqui');
    const patch = {};
    if (title != null) patch.title = String(title).trim().slice(0, 255);
    if (description != null) patch.description = String(description).slice(0, 4000) || null;
    if (due_date !== undefined) patch.due_date = due_date || null;
    if (priority && ['low', 'medium', 'high', 'urgent'].includes(priority)) patch.priority = priority;
    if (!Object.keys(patch).length) return false;
    await this.rest('PATCH', `tasks?id=eq.${id}&or=(assignee_id.eq.${this.session.user.id},created_by.eq.${this.session.user.id})`, patch, { Prefer: 'return=minimal' });
    const t = this.tasks.find((x) => x.id === id); if (t) Object.assign(t, patch);
    this._emitIfChanged(); return true;
  }

  // agenda do Hub: eventos em que sou participante/criador + calendários pessoal, do setor e da empresa (mesma lógica de /agenda)
  async loadAgenda() {
    const uid = this.session.user.id; const sec = this.profile && this.profile.sector ? this.profile.sector.id : null;
    const from = new Date(Date.now() - 86400000).toISOString(), to = new Date(Date.now() + 45 * 86400000).toISOString();
    const cals = await this.rest('GET', `agenda_calendarios?ativo=eq.true&or=(and(tipo.eq.pessoal,dono_id.eq.${uid}),visivel_todos.eq.true${sec ? `,and(tipo.eq.setor,setor_id.eq.${sec})` : ''})&select=id,nome,cor,tipo`).catch(() => []);
    const parts = await this.rest('GET', `agenda_evento_participantes?usuario_id=eq.${uid}&status=neq.recusado&select=evento_id`).catch(() => []);
    const ids = [...new Set([...(parts || []).map((p) => p.evento_id)])];
    const ors = [`criador_id.eq.${uid}`]; if (cals && cals.length) ors.push(`calendario_id.in.(${cals.map((c) => c.id).join(',')})`); if (ids.length) ors.push(`id.in.(${ids.slice(0, 200).join(',')})`);
    const sel = 'id,titulo,descricao,inicio,fim,dia_inteiro,local,tipo,cor,calendario_id,meet_link,criador_id';
    const evs = await this.rest('GET', `agenda_eventos?or=(${ors.join(',')})&fim=gte.${from}&inicio=lte.${to}&select=${sel}&order=inicio.asc&limit=200`).catch(() => []);
    const calColor = Object.fromEntries((cals || []).map((c) => [c.id, c.cor]));
    const calName = Object.fromEntries((cals || []).map((c) => [c.id, c.nome]));
    this.agenda = (evs || []).map((e) => ({ id: 'hub-' + e.id, title: e.titulo, start: new Date(e.inicio).getTime(), end: new Date(e.fim).getTime(), allDay: !!e.dia_inteiro, location: e.local || (e.meet_link ? 'Meet' : ''), description: (e.descricao || '').slice(0, 300), color: e.cor || calColor[e.calendario_id] || '#0a84ff', source: calName[e.calendario_id] || 'Hub', link: `/agenda?evento=${e.id}`, hub: true }));
    return this.agenda;
  }

  // conversas do WhatsApp (Organizador de Contato) no meu escopo: instâncias das quais sou membro, ou atribuídas a mim
  async loadChats() {
    const uid = this.session.user.id;
    const mem = await this.rest('GET', `whatsapp_instance_members?user_id=eq.${uid}&select=instance_id`).catch(() => []);
    this.instances = [...new Set((mem || []).map((m) => m.instance_id))];
    const inst = this.instances.length ? `instance_id.in.(${this.instances.join(',')}),assigned_to_instance_id.in.(${this.instances.join(',')}),` : '';
    const rows = await this.rest('GET', `whatsapp_conversations?or=(${inst}assigned_to.eq.${uid})&attendance_status=eq.open&select=id,instance_id,assigned_to,assigned_to_instance_id,transferred_from_instance_id,active_transfer_started_at,unread_count,last_message_at,last_message_preview,label,contact:whatsapp_contacts(name,phone_number,profile_picture_url,is_group)&order=last_message_at.desc.nullslast&limit=60`).catch((e) => { this.chatError = String(e.message || e); return []; });
    const names = await this._instanceNames();
    this.chats = (rows || []).map((c) => this._chatRow(c, names, uid));
    return this.chats;
  }
  async _instanceNames() {
    if (this._instNames) return this._instNames;
    const list = await this.rest('GET', 'whatsapp_instances?select=id,name').catch(() => []);
    this._instNames = Object.fromEntries((list || []).map((i) => [i.id, i.name]));
    return this._instNames;
  }
  _chatRow(c, names, uid) {
    const ct = c.contact || {};
    const curInst = c.assigned_to_instance_id || c.instance_id;
    const transferred = !!c.transferred_from_instance_id && this.instances.includes(curInst) && !this.instances.includes(c.transferred_from_instance_id);
    return { id: c.id, name: ct.name || ct.phone_number || 'Contato', phone: ct.phone_number || '', avatar: ct.profile_picture_url || null, group: !!ct.is_group, preview: c.last_message_preview || '', at: c.last_message_at ? new Date(c.last_message_at).getTime() : 0, unread: Number(c.unread_count) || 0,
      mine: c.assigned_to === uid, unassigned: !c.assigned_to, sector: names[curInst] || '', transferred, transferredFrom: names[c.transferred_from_instance_id] || '', transferAt: c.active_transfer_started_at ? new Date(c.active_transfer_started_at).getTime() : 0, label: c.label || '', link: `/contatos?conversa=${c.id}` };
  }
  inScope(conv) { if (!conv) return false; return conv.assigned_to === this.session.user.id || this.instances.includes(conv.instance_id) || this.instances.includes(conv.assigned_to_instance_id); }

  // ---------- Realtime (protocolo Phoenix do Supabase) ----------
  connect() {
    if (!this.WebSocket || !this.session) return;
    this._closeWs();
    const wsUrl = this.url.replace(/^http/, 'ws') + `/realtime/v1/websocket?apikey=${encodeURIComponent(this.anon)}&vsn=1.0.0`;
    let ws;
    try { ws = new this.WebSocket(wsUrl); } catch (e) { this.realtime = 'error'; return; }
    this.ws = ws;
    const send = (topic, event, payload) => { try { ws.send(JSON.stringify({ topic, event, payload, ref: String(++this.ref) })); } catch { /* fechado */ } };
    ws.onopen = () => {
      this.realtime = 'joining';
      const uid = this.session.user.id;
      // canais separados: se `tasks` não estiver na publicação Realtime do Hub, só esse canal falha e as notificações seguem ao vivo
      const cfg = (pc) => ({ config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: pc }, access_token: this.session.access_token });
      send(`realtime:sidenotch-notif-${uid}`, 'phx_join', cfg([{ event: 'INSERT', schema: 'public', table: 'notificacoes', filter: `usuario_id=eq.${uid}` }]));
      send(`realtime:sidenotch-tasks-${uid}`, 'phx_join', cfg([{ event: '*', schema: 'public', table: 'tasks', filter: `assignee_id=eq.${uid}` }]));
      send(`realtime:sidenotch-at-${uid}`, 'phx_join', cfg([{ event: '*', schema: 'public', table: 'at_os_tarefa', filter: `responsavel=eq.${uid}` }]));
      // WhatsApp: mensagens recebidas e mudanças de conversa (transferências/atribuições) — filtragem por escopo é feita aqui
      send(`realtime:sidenotch-wa-${uid}`, 'phx_join', cfg([{ event: 'INSERT', schema: 'public', table: 'whatsapp_messages' }, { event: 'UPDATE', schema: 'public', table: 'whatsapp_conversations' }]));
      // quadro do time de Sistemas: cartões, histórico (quem fez o quê) e atribuições
      if (this.hasBoard()) send(`realtime:sidenotch-sis-${uid}`, 'phx_join', cfg([
        { event: '*', schema: 'public', table: 'sistemas_ideias' },
        { event: 'INSERT', schema: 'public', table: 'sistemas_ideia_historico' },
        { event: '*', schema: 'public', table: 'sistemas_ideia_atribuicoes' }
      ]));
      clearInterval(this.hb); this.hb = setInterval(() => send('phoenix', 'heartbeat', {}), 25000);
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.event === 'phx_reply' && m.payload && /^realtime:sidenotch-notif-/.test(m.topic)) { const st = m.payload.status === 'ok' ? 'on' : 'error'; if (this.realtime !== st) { this.realtime = st; this._emitIfChanged(); } }
      if (m.event === 'phx_error' && /^realtime:sidenotch-notif-/.test(m.topic)) { this.realtime = 'error'; this._emitIfChanged(); }
      if (m.event === 'postgres_changes') {
        const d = m.payload && m.payload.data || {};
        if (d.table === 'notificacoes' && d.type === 'INSERT' && d.record) {
          const n = d.record;
          if (!this.notifications.some((x) => x.id === n.id)) { this.notifications.unshift(n); this.notifications = this.notifications.slice(0, 60); this.emit('notification', n); this._emitIfChanged(); }
        } else if (d.table === 'tasks' || d.table === 'at_os_tarefa') { this.loadTasks().then(() => this._emitIfChanged()).catch(() => {}); }
        else if (d.table === 'sistemas_ideia_historico' && d.type === 'INSERT' && d.record) this._onBoardEvent(d.record);
        else if (d.table === 'sistemas_ideias' || d.table === 'sistemas_ideia_atribuicoes') this._boardSoon(d);
        else if (d.table === 'whatsapp_messages' && d.type === 'INSERT' && d.record && !d.record.is_from_me) this._onWaMessage(d.record);
        else if (d.table === 'whatsapp_conversations' && d.type === 'UPDATE' && d.record) this._onWaConversation(d.record, d.old_record || {});
      }
    };
    ws.onclose = () => { clearInterval(this.hb); if (this.ws === ws) { this.ws = null; this.realtime = 'off'; this._emitIfChanged(); this._reconnect = setTimeout(() => this.connect(), 15000); } };
    ws.onerror = () => { this.realtime = 'error'; };
  }
  async _onWaMessage(m) {
    let conv = this.chats.find((c) => c.id === m.conversation_id);
    if (!conv) {   // conversa fora da lista: confere no banco se está no meu escopo
      const rows = await this.rest('GET', `whatsapp_conversations?id=eq.${m.conversation_id}&select=id,instance_id,assigned_to,assigned_to_instance_id,transferred_from_instance_id,active_transfer_started_at,unread_count,last_message_at,last_message_preview,label,attendance_status,contact:whatsapp_contacts(name,phone_number,profile_picture_url,is_group)`).catch(() => []);
      const r = rows && rows[0]; if (!r || !this.inScope(r) || r.attendance_status !== 'open') return;
      conv = this._chatRow(r, await this._instanceNames(), this.session.user.id); this.chats.unshift(conv);
    }
    conv.preview = m.message_type && m.message_type !== 'text' ? `[${m.message_type}]` : (m.content || ''); conv.at = m.timestamp ? new Date(m.timestamp).getTime() : Date.now(); conv.unread = (conv.unread || 0) + 1;
    this.chats.sort((a, b) => b.at - a.at);
    this.emit('chat', { conv, text: conv.preview, kind: 'message' });
    this._emitIfChanged();
  }
  async _onWaConversation(rec, old) {
    const uid = this.session.user.id;
    const nowMine = this.inScope(rec) && rec.attendance_status === 'open';
    const wasMine = this.chats.some((c) => c.id === rec.id);
    const names = await this._instanceNames();
    if (!nowMine) { if (wasMine) { this.chats = this.chats.filter((c) => c.id !== rec.id); this._emitIfChanged(); } return; }
    const prev = this.chats.find((c) => c.id === rec.id);
    let contact = prev ? { name: prev.name, phone_number: prev.phone, profile_picture_url: prev.avatar, is_group: prev.group } : null;
    if (!contact) { const rows = await this.rest('GET', `whatsapp_conversations?id=eq.${rec.id}&select=contact:whatsapp_contacts(name,phone_number,profile_picture_url,is_group)`).catch(() => []); contact = rows && rows[0] && rows[0].contact || {}; }
    const row = this._chatRow({ ...rec, contact }, names, uid);
    if (prev) Object.assign(prev, row); else this.chats.unshift(row);
    this.chats.sort((a, b) => b.at - a.at);
    const transferredIn = rec.assigned_to_instance_id && rec.assigned_to_instance_id !== old.assigned_to_instance_id && this.instances.includes(rec.assigned_to_instance_id) && !this.instances.includes(old.assigned_to_instance_id || rec.instance_id);
    const assignedToMe = rec.assigned_to === uid && old.assigned_to !== uid;
    if (transferredIn) this.emit('chat', { conv: row, kind: 'transfer', text: `Conversa transferida de ${names[rec.transferred_from_instance_id] || 'outro setor'} para ${row.sector || 'seu setor'}` });
    else if (assignedToMe) this.emit('chat', { conv: row, kind: 'assign', text: 'Conversa atribuída a você' });
    this._emitIfChanged();
  }
  _closeWs() { clearTimeout(this._reconnect); clearInterval(this.hb); if (this.ws) { const w = this.ws; this.ws = null; try { w.close(); } catch { /* ignore */ } } }

  // ---------- ciclo de vida ----------
  async start(pollSec = 90) {
    clearInterval(this.pollTimer);
    if (!this.linked()) return;
    try { await this._ensure(); if (!this.profile) await this.loadProfile(); await this.sync(); this.connect(); }
    catch (e) { if (!this.error) this.error = String(e.message || e); this.emit('change'); }
    if (!this.linked()) return;
    this.pollTimer = setInterval(() => { this.sync(); if (!this.ws) this.connect(); }, Math.max(30, pollSec) * 1000);
  }
  stop() { clearInterval(this.pollTimer); clearTimeout(this.refreshTimer); this._closeWs(); }

  // ---------- estado para a UI ----------
  shortcuts() {
    const mods = new Set(this.profile ? this.profile.modules : []);
    const admin = this.profile && this.profile.role.level >= 100;
    const cfg = this.getCfg() || {};
    const custom = (cfg.custom || []).filter((c) => c && c.path && this.allowedPath(c.path)).map((c) => ({ id: 'u:' + (c.id || c.path), name: c.name || c.path, path: /^(https?:|\/)/.test(c.path) ? c.path : '/' + c.path, module: null, icon: c.icon || '🔗', ix: c.ix || 'Global', kind: c.kind || 'page', custom: true }));
    return [...SHORTCUTS.filter((s) => !s.module || admin || mods.has(s.module)), ...custom].map((s) => ({ ...s, url: this.urlFor(s.path) }));
  }
  // módulo do Hub responsável por uma rota (prefixo mais longo do catálogo); null = rota livre/desconhecida
  moduleForPath(p) {
    let route = String(p || '');
    if (/^https?:/i.test(route)) { if (!route.toLowerCase().startsWith(this.site.toLowerCase())) return { external: true }; route = route.slice(this.site.length) || '/'; }
    route = route.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    let best = null;
    for (const s of SHORTCUTS) { const sp = s.path.split(/[?#]/)[0].replace(/\/+$/, ''); if (route === sp || route.startsWith(sp + '/')) if (!best || sp.length > best.path.length) best = { path: sp, module: s.module, id: s.id }; }
    return best ? { module: best.module, match: best.id } : { module: null, match: null };
  }
  // pode abrir/usar esta rota? (mesma regra do lançador: módulo permitido; URL externa sempre pode)
  allowedPath(p) {
    const m = this.moduleForPath(p); if (m.external || !m.module) return true;
    const admin = this.profile && this.profile.role.level >= 100;
    return admin || (this.profile ? this.profile.modules : []).includes(m.module);
  }
  // catálogo completo (para a tela de configurações), marcando o que o usuário tem acesso
  catalog() {
    const allowed = new Set(this.shortcuts().map((s) => s.id));
    return SHORTCUTS.map((s) => ({ id: s.id, name: s.name, path: s.path, ix: s.ix, kind: s.kind, module: s.module, allowed: allowed.has(s.id) }));
  }
  // ---------- WhatsApp: responder pela edge function do Hub (mesma que o site usa) ----------
  async sendChat(conversationId, text) {
    const t = String(text || '').trim(); if (!t) throw new Error('escreva a mensagem');
    if (!this.session) throw new Error('vincule o Medsystem Hub');
    await this._ensure();
    const r = await this.fetch(`${this.url}/functions/v1/send-whatsapp-message`, {
      method: 'POST',
      headers: { apikey: this.anon, Authorization: `Bearer ${this.session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, content: t.slice(0, 4000), messageType: 'text' })
    });
    const j = await r.json().catch(() => ({}));
    // a edge devolve HTTP 200 mesmo em erro de negócio
    if (!r.ok || j.success === false) throw new Error(String(j.error || j.message || 'não consegui enviar').slice(0, 200));
    const conv = this.chats.find((c) => c.id === conversationId);
    if (conv) { conv.preview = t; conv.at = Date.now(); conv.unread = 0; conv.mine = true; this.chats.sort((a, b) => b.at - a.at); this._emitIfChanged(); }
    return j.message || true;
  }

  // ---------- quadro do time de Sistemas ----------
  hasBoard() { return !!(this.profile && (this.profile.modules || []).includes('sistemas')); }
  async loadBoard() {
    if (!this.hasBoard()) { this.board = null; return null; }
    const r = await this.rpc('sistemas_board', { p_limit: 200 });
    const b = Array.isArray(r) ? r[0] : r;
    if (b && typeof b === 'object') { this.board = b; this.boardAt = Date.now(); }
    return this.board;
  }
  async loadBoardAlerts(cfg = {}) {
    if (!this.hasBoard()) return null;
    const r = await this.rpc('sistemas_alerts', { p_sem_dono_horas: cfg.semDonoHoras || 24, p_parado_dias: cfg.paradoDias || 2, p_wip: cfg.wip || 2 });
    const a = Array.isArray(r) ? r[0] : r;
    if (a && typeof a === 'object') this.boardAlerts = a;
    return this.boardAlerts;
  }
  async loadBoardFeed(limit = 40) {
    if (!this.hasBoard()) return [];
    const r = await this.rpc('sistemas_feed', { p_limit: limit, p_since: null });
    this.boardFeed = Array.isArray(r) ? r : (r ? [r] : []);
    if (this.boardFeed.length) this.feedSeen = this.boardFeed[0].created_at;
    return this.boardFeed;
  }
  // uma atualização por rajada de eventos (arrastar um cartão dispara vários)
  _boardSoon() { clearTimeout(this._bTimer); this._bTimer = setTimeout(() => this.loadBoard().then(() => this._emitIfChanged()).catch(() => {}), 800); }
  // evento do time → cartão no feed + notificação (o main decide se avisa)
  _onBoardEvent(h) {
    if (!this.hasBoard()) return;
    const mine = h.usuario_id === (this.session && this.session.user.id);
    const ev = { id: h.id, at: h.created_at, acao: h.acao, quem: h.usuario_nome || 'alguém', quemId: h.usuario_id, ideiaId: h.ideia_id, detalhes: h.detalhes || '', de: h.de || null, para: h.para || null, mine };
    this.boardFeed = [ev, ...(this.boardFeed || [])].slice(0, 60);
    const card = (this.board && this.board.cards || []).find((c) => c.id === h.ideia_id);
    if (card) { ev.numero = card.numero_sequencial; ev.titulo = card.titulo; ev.trilha = card.trilha; }
    this._boardSoon();
    if (!mine) this.emit('board', ev);
    this._emitIfChanged();
  }
  async boardTake(id, startDev = true) { const r = await this.rpc('sistemas_take', { p_ideia: id, p_start_dev: !!startDev }); await this.loadBoard(); this._emitIfChanged(); return r; }
  async boardMove(id, status, motivo) { const r = await this.rpc('sistemas_move', { p_ideia: id, p_status: status, p_motivo: motivo || null }); await this.loadBoard(); this._emitIfChanged(); return r; }
  async boardBlock(id, on, motivo) { const r = await this.rpc('sistemas_block', { p_ideia: id, p_bloqueado: !!on, p_motivo: motivo || null }); await this.loadBoard(); this._emitIfChanged(); return r; }

  urlFor(link) { if (!link) return this.site; if (/^https?:/.test(link)) return link; return this.site + (link.startsWith('/') ? '' : '/') + link; }
  state() {
    const unread = this.notifications.filter((n) => !n.lida);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const overdue = this.tasks.filter((t) => t.due_date && new Date(t.due_date + 'T23:59:59') < today).length;
    return {
      linked: this.linked(), connected: this.connected, realtime: this.realtime, error: this.error, site: this.site,
      profile: this.profile ? { id: this.session && this.session.user && this.session.user.id, name: this.profile.name, email: this.profile.email, sector: this.profile.sector && this.profile.sector.name, role: this.profile.role.name || this.profile.role.slug, modules: this.profile.modules } : null,
      notifications: this.notifications, unread: unread.length,
      tasks: this.tasks.map((t) => ({ ...t, focusSeconds: t.focus_seconds || 0, estimateMin: t.focus_estimate_min || null })), overdue,
      agenda: this.agenda,
      chats: this.chats, chatUnread: this.chats.reduce((a, c) => a + (c.unread || 0), 0), chatTransfers: this.chats.filter((c) => c.transferred && c.unassigned).length, hasWhatsapp: this.instances.length > 0 || this.chats.length > 0,
      shortcuts: this.shortcuts(), catalog: this.catalog(),
      hasBoard: this.hasBoard(), board: this.board, boardFeed: (this.boardFeed || []).slice(0, 40), boardAlerts: this.boardAlerts
    };
  }
}

module.exports = { HubClient, SHORTCUTS, SECTOR_MODULE_ACCESS, ROLE_MODULE_ACCESS, DEFAULT_URL, DEFAULT_ANON, DEFAULT_SITE, decodeJwt };
