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

// Atalhos do lançador: {id, name, path, module (null = sempre), icon, kind: 'form' | 'page'}
const SHORTCUTS = [
  { id: 'chamado', name: 'Abrir chamado', path: '/chamados', module: 'chamados', icon: '🎧', kind: 'form' },
  { id: 'reportar', name: 'Reportar problema', path: '/sistemas/ideias/reportar', module: null, icon: '🐞', kind: 'form' },
  { id: 'tarefas', name: 'Minhas tarefas', path: '/tarefas', module: 'tarefas', icon: '✅', kind: 'page' },
  { id: 'demanda', name: 'Nova demanda', path: '/demandas', module: 'demandas', icon: '📌', kind: 'form' },
  { id: 'cotacao', name: 'Nova cotação', path: '/compras/cotacoes/nova', module: 'compras', icon: '🧾', kind: 'form' },
  { id: 'pedido-internet', name: 'Pedido internet', path: '/compras/pedidos-internet/novo', module: 'compras', icon: '🛒', kind: 'form' },
  { id: 'cotacao-item', name: 'Cotação de item', path: '/cotacao-item', module: 'cotacao-item', icon: '🔍', kind: 'form' },
  { id: 'ideia', name: 'Nova ideia (PEM)', path: '/sistemas/ideias/nova', module: 'sistemas', icon: '💡', kind: 'form' },
  { id: 'sistema', name: 'Novo sistema', path: '/sistemas/novo', module: 'sistemas', icon: '🧩', kind: 'form' },
  { id: 'nf', name: 'Solicitar NF', path: '/financeiro/solicitacoes/nova-nf', module: 'financeiro-solicitacoes', icon: '📄', kind: 'form' },
  { id: 'marketing', name: 'Produção marketing', path: '/marketing/nova', module: 'marketing', icon: '🎨', kind: 'form' },
  { id: 'logistica', name: 'Logística', path: '/logistica', module: 'logistica', icon: '🚚', kind: 'page' },
  { id: 'agenda', name: 'Agenda', path: '/agenda', module: 'agenda-compartilhada', icon: '📅', kind: 'page' },
  { id: 'comunicacao', name: 'Comunicação', path: '/comunicacao', module: 'comunicacao', icon: '📣', kind: 'page' },
  { id: 'onboarding', name: 'Documentação', path: '/onboarding', module: 'onboarding', icon: '📚', kind: 'page' },
  { id: 'licitacao', name: 'Licitações', path: '/licitacao/filtros', module: 'licitacao', icon: '⚖️', kind: 'page' },
  { id: 'eng', name: 'Engenharia clínica', path: '/engenharia-clinica', module: 'engenharia-clinica', icon: '🩺', kind: 'page' },
  { id: 'rh', name: 'RH', path: '/rh', module: 'rh', icon: '👥', kind: 'page' },
  { id: 'chat', name: 'Chat', path: '/chat', module: 'chat', icon: '💬', kind: 'page' },
  { id: 'planos', name: 'Planos de ação', path: '/planos-acao', module: 'planos-acao', icon: '🎯', kind: 'page' },
  { id: 'fluxos', name: 'Fluxos', path: '/fluxos', module: 'fluxos', icon: '🔁', kind: 'page' },
  { id: 'dashboard', name: 'Dashboard', path: '/dashboard', module: null, icon: '🏠', kind: 'page' }
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
    this.profile = null;           // { name, email, sector:{slug,name}, role:{slug,level}, modules:[] }
    this.notifications = []; this.tasks = []; this.error = null; this.connected = false; this.realtime = 'off';
    this.ws = null; this.hb = null; this.refreshTimer = null; this.pollTimer = null; this.ref = 0; this.lastSig = '';
    this.sessionFile = this.dir ? path.join(this.dir, 'hub-session.bin') : null;
  }

  // ---------- sessão ----------
  _saveSession() {
    if (!this.sessionFile) return;
    try {
      if (!this.session) { fs.rmSync(this.sessionFile, { force: true }); return; }
      const raw = JSON.stringify({ refresh_token: this.session.refresh_token, email: this.session.user.email });
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
    await this.loadProfile();
    await this.sync();
    this.connect();
    this.emit('change');
    return this.state();
  }
  async refreshSession() {
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
    this.session = null; this.profile = null; this.notifications = []; this.tasks = []; this.connected = false;
    this._saveSession();
  }

  // ---------- REST ----------
  _h(extra = {}) { return { apikey: this.anon, Authorization: `Bearer ${this.session.access_token}`, 'Content-Type': 'application/json', ...extra }; }
  async _ensure() {
    if (!this.session) { const s = this._loadSession(); if (!s) throw new Error('não vinculado'); await this.refreshSession(); }
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
    const rows = await this.rest('GET', `tasks?assignee_id=eq.${uid}&status=neq.completed&select=id,title,description,status,priority,due_date,created_at&order=due_date.asc.nullslast,created_at.desc&limit=60`) || [];
    this.tasks = rows;
    return rows;
  }
  async sync() {
    try { await Promise.all([this.loadNotifications(), this.loadTasks()]); this.error = null; this.connected = true; }
    catch (e) { this.error = String(e.message || e); this.connected = false; }
    this._emitIfChanged();
  }
  _emitIfChanged() {
    const sig = JSON.stringify([this.notifications.map((n) => n.id + n.lida), this.tasks.map((t) => t.id + t.status), this.error, this.realtime]);
    if (sig !== this.lastSig) { this.lastSig = sig; this.emit('change'); }
  }
  async markRead(id) {
    if (id === '*') { await this.rest('PATCH', `notificacoes?usuario_id=eq.${this.session.user.id}&lida=eq.false`, { lida: true }, { Prefer: 'return=minimal' }); for (const n of this.notifications) n.lida = true; }
    else { await this.rest('PATCH', `notificacoes?id=eq.${id}`, { lida: true }, { Prefer: 'return=minimal' }); const n = this.notifications.find((x) => x.id === id); if (n) n.lida = true; }
    this._emitIfChanged();
  }
  async setTaskStatus(id, status) {
    if (!['pending', 'in_progress', 'completed'].includes(status)) throw new Error('status inválido');
    await this.rest('PATCH', `tasks?id=eq.${id}&assignee_id=eq.${this.session.user.id}`, { status }, { Prefer: 'return=minimal' });
    if (status === 'completed') this.tasks = this.tasks.filter((t) => t.id !== id); else { const t = this.tasks.find((x) => x.id === id); if (t) t.status = status; }
    this._emitIfChanged();
  }

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
      send(`realtime:sidenotch-${uid}`, 'phx_join', { config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [
        { event: 'INSERT', schema: 'public', table: 'notificacoes', filter: `usuario_id=eq.${uid}` },
        { event: '*', schema: 'public', table: 'tasks', filter: `assignee_id=eq.${uid}` }
      ] }, access_token: this.session.access_token });
      clearInterval(this.hb); this.hb = setInterval(() => send('phoenix', 'heartbeat', {}), 25000);
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.event === 'phx_reply' && m.payload && m.payload.status === 'ok' && /^realtime:/.test(m.topic) && this.realtime !== 'on') { this.realtime = 'on'; this._emitIfChanged(); }
      if (m.event === 'phx_reply' && m.payload && m.payload.status === 'error') { this.realtime = 'error'; this._emitIfChanged(); }
      if (m.event === 'postgres_changes') {
        const d = m.payload && m.payload.data || {};
        if (d.table === 'notificacoes' && d.type === 'INSERT' && d.record) {
          const n = d.record;
          if (!this.notifications.some((x) => x.id === n.id)) { this.notifications.unshift(n); this.notifications = this.notifications.slice(0, 60); this.emit('notification', n); this._emitIfChanged(); }
        } else if (d.table === 'tasks') { this.loadTasks().then(() => this._emitIfChanged()).catch(() => {}); }
      }
    };
    ws.onclose = () => { clearInterval(this.hb); if (this.ws === ws) { this.ws = null; this.realtime = 'off'; this._emitIfChanged(); this._reconnect = setTimeout(() => this.connect(), 15000); } };
    ws.onerror = () => { this.realtime = 'error'; };
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
    return SHORTCUTS.filter((s) => !s.module || admin || mods.has(s.module)).map((s) => ({ ...s, url: this.site + s.path }));
  }
  urlFor(link) { if (!link) return this.site; if (/^https?:/.test(link)) return link; return this.site + (link.startsWith('/') ? '' : '/') + link; }
  state() {
    const unread = this.notifications.filter((n) => !n.lida);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const overdue = this.tasks.filter((t) => t.due_date && new Date(t.due_date + 'T23:59:59') < today).length;
    return {
      linked: this.linked(), connected: this.connected, realtime: this.realtime, error: this.error, site: this.site,
      profile: this.profile ? { name: this.profile.name, email: this.profile.email, sector: this.profile.sector && this.profile.sector.name, role: this.profile.role.name || this.profile.role.slug, modules: this.profile.modules } : null,
      notifications: this.notifications, unread: unread.length,
      tasks: this.tasks, overdue,
      shortcuts: this.shortcuts()
    };
  }
}

module.exports = { HubClient, SHORTCUTS, SECTOR_MODULE_ACCESS, ROLE_MODULE_ACCESS, DEFAULT_URL, DEFAULT_ANON, DEFAULT_SITE, decodeJwt };
