// Ideia Central — segundo cliente Supabase (projeto khumibmkasycrfifomev), separado do Medsystem Hub.
// O que o notch precisa de lá: render que está rodando (e avisar quando termina ou quebra), ideias
// capturadas pelo Telegram/atalho do iPhone, publicações agendadas e um campo para jogar ideia nova.
// Nenhuma tabela de job está no realtime do projeto, então aqui é consulta periódica; as ações
// (publicar agendados, rodar automação) vão pelo endpoint com a sessão do dono ou o x-automation-secret.
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const DEFAULT_URL = 'https://khumibmkasycrfifomev.supabase.co';
const RECENTE_MS = 12 * 60 * 60 * 1000;      // terminou nas últimas 12 h: ainda interessa ver

// Cada fila do Ideia Central: onde ler, o que é "rodando", o que é fim feliz e o que é erro.
const FILAS = [
  { id: 'recap', tabela: 'movie_recap_jobs', rotulo: 'Recap de filme', ix: 'Play',
    sel: 'id,status,work_title,drive_file_name,error,created_at,updated_at',
    titulo: (r) => r.work_title || r.drive_file_name, etapa: (r) => r.status,
    rodando: ['queued', 'transcribing', 'scripting', 'narrating', 'rendering'], parado: ['review'], ok: ['done'], erro: ['failed'] },
  { id: 'musical', tabela: 'music_video_projects', rotulo: 'Vídeo musical', ix: 'Music',
    sel: 'id,status,title,error,created_at,updated_at',
    titulo: (r) => r.title, etapa: (r) => r.status,
    rodando: ['normalizing', 'blocking', 'mixing', 'mastering'], ok: ['ready'], erro: ['failed'] },
  { id: 'cenas', tabela: 'scene_clip_jobs', rotulo: 'Cortes de cena', ix: 'Monitor',
    sel: 'id,status,stage,source_name,error,created_at,updated_at',
    titulo: (r) => r.source_name, etapa: (r) => r.stage || r.status,
    rodando: ['queued', 'processing'], ok: ['ready', 'done'], erro: ['failed'] },
  { id: 'imagens', tabela: 'generation_jobs', rotulo: 'Geração de imagem', ix: 'Brush2',
    sel: 'id,status,prompt,error,created_at,updated_at',
    titulo: (r) => r.prompt, etapa: (r) => r.status,
    rodando: ['queued', 'generating', 'publishing'], ok: ['ready', 'published'], erro: ['failed'] },
  { id: 'tiktok', tabela: 'tiktok_automation_jobs', rotulo: 'Automação TikTok', ix: 'Flash',
    sel: 'id,status,drive_file_name,scheduled_at,error,created_at,updated_at',
    titulo: (r) => r.drive_file_name, etapa: (r) => r.status,
    rodando: ['queued', 'processing'], ok: ['completed'], erro: ['failed'] },
  { id: 'estudio', tabela: 'estudio_generations', rotulo: 'Estúdio', ix: 'Lamp',
    sel: 'id,status,kind,prompt,error,created_at,updated_at',
    titulo: (r) => r.prompt, etapa: (r) => r.kind || r.status,
    rodando: ['pending', 'in_progress'], ok: ['completed'], erro: ['failed'] },
  { id: 'shorts', tabela: 'youtube_clip_candidates', rotulo: 'Corte do YouTube', ix: 'PlayCircle',
    sel: 'id,render_status,title,render_error,created_at,updated_at', campoStatus: 'render_status', campoErro: 'render_error',
    titulo: (r) => r.title, etapa: () => 'render',
    rodando: ['rendering'], ok: ['ready'], erro: ['failed'] }
];

// Publicações: o que está para sair (e o que falhou) em cada plataforma.
const AGENDA = [
  { id: 'instagram', tabela: 'planned_posts', rotulo: 'Instagram', sel: 'id,kind,caption,scheduled_at,status,permalink,error', quando: 'scheduled_at', titulo: (r) => r.caption, ativos: ['scheduled', 'publishing', 'failed'] },
  { id: 'instagram2', tabela: 'instagram_publications', rotulo: 'Instagram', sel: 'id,caption,scheduled_at,status,permalink,error', quando: 'scheduled_at', titulo: (r) => r.caption, ativos: ['queued', 'publishing', 'failed'] },
  { id: 'tiktok', tabela: 'tiktok_posts', rotulo: 'TikTok', sel: 'id,kind,caption,scheduled_at,status,tiktok_post_url,error', quando: 'scheduled_at', titulo: (r) => r.caption, ativos: ['scheduled', 'publishing', 'failed', 'partial'] },
  { id: 'youtube', tabela: 'youtube_uploads', rotulo: 'YouTube', sel: 'id,title,status,privacy,youtube_url,error,created_at', quando: 'created_at', titulo: (r) => r.title, ativos: ['queued', 'uploading', 'failed'] }
];

// Ações que o notch dispara. Function = edge function do Supabase; site = rota do app na Vercel.
const ACOES = {
  publicar: { alvo: 'function', rota: 'planner-publish', corpo: {}, nome: 'Publicar agendados' },
  imagens: { alvo: 'function', rota: 'generate-images', corpo: {}, nome: 'Gerar imagens da fila' },
  tiktok: { alvo: 'site', rota: '/api/tiktok/automation', corpo: {}, nome: 'Rodar automação do TikTok' },
  youtube: { alvo: 'site', rota: '/api/youtube/process', corpo: {}, nome: 'Processar fila do YouTube' }
};

const decodeJwt = (t) => { try { return JSON.parse(Buffer.from(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return {}; } };
const corta = (s, n = 70) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

class IdeiaClient extends EventEmitter {
  /** @param {object} o { dir, secret, getCfg, fetch, notify } */
  constructor(o = {}) {
    super();
    this.dir = o.dir; this.secret = o.secret || null; this.getCfg = o.getCfg || (() => ({}));
    this.fetch = o.fetch || globalThis.fetch; this.notify = o.notify || (() => {});
    this.session = null; this.autoSecret = '';
    this.jobs = []; this.ideias = []; this.posts = []; this.error = null; this.lastAt = 0; this.loading = false;
    this.visto = {};                 // id do job -> último status conhecido (não repete aviso)
    this.primeira = true;            // a 1ª leitura só popula: nada de avalanche de avisos ao abrir o app
    this.timer = null; this.refreshTimer = null;
    this.file = this.dir ? path.join(this.dir, 'ideia-session.bin') : null;
    this._load();
  }

  cfg() {
    const c = this.getCfg() || {};
    return {
      enabled: c.enabled !== false,
      url: (c.url || DEFAULT_URL).replace(/\/$/, ''),
      anon: c.anon || '',
      site: (c.site || '').replace(/\/$/, ''),
      pollSec: Math.max(20, Math.min(900, Number(c.pollSec) || 60)),
      avisarJobs: c.notifyJobs !== false, avisarIdeias: c.notifyIdeias !== false, avisarPosts: c.notifyPosts !== false
    };
  }
  configurado() { return !!this.cfg().anon; }

  // ---------- sessão (mesmo cofre do Hub: safeStorage do Windows) ----------
  _save() {
    if (!this.file) return;
    try {
      if (!this.session && !this.autoSecret) { fs.rmSync(this.file, { force: true }); return; }
      const raw = JSON.stringify({ refresh_token: this.session ? this.session.refresh_token : null, email: this.session ? this.session.user.email : null, autoSecret: this.autoSecret || '' });
      fs.writeFileSync(this.file, this.secret ? this.secret.encrypt(raw) : Buffer.from(raw, 'utf8'));
    } catch (e) { this.error = 'Não consegui guardar a sessão: ' + e.message; }
  }
  _load() {
    if (!this.file || !fs.existsSync(this.file)) return null;
    try {
      const j = JSON.parse(this.secret ? this.secret.decrypt(fs.readFileSync(this.file)) : fs.readFileSync(this.file, 'utf8'));
      this.autoSecret = j.autoSecret || ''; this._salvo = j;
      return j;
    } catch { return null; }
  }
  linked() { return !!(this.session && this.session.refresh_token) || !!(this._salvo && this._salvo.refresh_token); }
  email() { return (this.session && this.session.user.email) || (this._salvo && this._salvo.email) || ''; }
  setSecret(s) { this.autoSecret = String(s || '').trim(); this._save(); this.emit('change', this.state()); return this.state(); }
  temSecret() { return !!this.autoSecret; }

  async _auth(grant, body) {
    const { url, anon } = this.cfg();
    if (!anon) throw new Error('Falta a chave pública (anon) do Ideia Central nas configurações.');
    const res = await this.fetch(`${url}/auth/v1/token?grant_type=${grant}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anon }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error_description || j.msg || j.message || j.error || `HTTP ${res.status}`);
    const exp = decodeJwt(j.access_token).exp;
    this.session = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: exp ? exp * 1000 : Date.now() + 3600000, user: { id: j.user && j.user.id, email: j.user && j.user.email } };
    this._salvo = { refresh_token: this.session.refresh_token, email: this.session.user.email };
    this._save(); this._agendarRefresh();
    return this.session;
  }
  _agendarRefresh() {
    clearTimeout(this.refreshTimer);
    if (!this.session) return;
    this.refreshTimer = setTimeout(() => this._refresh().catch(() => {}), Math.max(30000, this.session.expires_at - Date.now() - 120000));
  }
  _refresh() {
    if (!this._refreshing) this._refreshing = (async () => {
      const rt = this.session ? this.session.refresh_token : (this._salvo || {}).refresh_token;
      if (!rt) throw new Error('não vinculado');
      try { await this._auth('refresh_token', { refresh_token: rt }); this.error = null; }
      catch (e) {
        if (/invalid|revoked|not found|expired/i.test(e.message)) { this.logout(); this.error = 'Sessão do Ideia Central expirou — entre de novo.'; this.emit('change', this.state()); }
        throw e;
      }
      return this.session;
    })().finally(() => { this._refreshing = null; });
    return this._refreshing;
  }
  async login(email, password) {
    await this._auth('password', { email: String(email).trim(), password });
    this.error = null; this.primeira = true;
    await this.refresh();
    this.start();
    this.emit('change', this.state());
    return this.state();
  }
  logout() {
    clearTimeout(this.refreshTimer); this.stop();
    this.session = null; this._salvo = null; this.jobs = []; this.ideias = []; this.posts = []; this.visto = {};
    this._save(); this.emit('change', this.state());
  }

  // ---------- REST ----------
  async _ensure() {
    if (!this.session) { if (!this.linked()) throw new Error('não vinculado'); await this._refresh(); }
    else if (this.session.expires_at - Date.now() < 60000) await this._refresh();
  }
  async rest(method, pathq, body, extra) {
    await this._ensure();
    const { url, anon } = this.cfg();
    const res = await this.fetch(`${url}/rest/v1/${pathq}`, { method, headers: { apikey: anon, Authorization: `Bearer ${this.session.access_token}`, 'Content-Type': 'application/json', ...(extra || {}) }, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) { await this._refresh(); return this.rest(method, pathq, body, extra); }
    const txt = await res.text();
    if (!res.ok) { let m = txt; try { m = JSON.parse(txt).message || txt; } catch { /* texto cru */ } throw new Error(`${m} (HTTP ${res.status})`); }
    return txt ? JSON.parse(txt) : null;
  }

  // ---------- leitura ----------
  // duas chamadas ao mesmo tempo (o timer e o botão Atualizar) compartilham a mesma consulta
  refresh() {
    if (!this.cfg().enabled || !this.linked() || !this.configurado()) return Promise.resolve(this.state());
    if (!this._inflight) this._inflight = this._refreshNow().finally(() => { this._inflight = null; });
    return this._inflight;
  }
  async _refreshNow() {
    this.loading = true;
    const avisos = [];
    let falhou = null;
    try {
      const jobs = [];
      for (const f of FILAS) {
        const campo = f.campoStatus || 'status';
        let linhas = [];
        try { linhas = await this.rest('GET', `${f.tabela}?select=${f.sel}&order=updated_at.desc&limit=12`) || []; }
        catch (e) { falhou = `${f.rotulo}: ${e.message}`; continue; }
        for (const r of linhas) {
          const st = r[campo];
          const rodando = f.rodando.includes(st), parado = (f.parado || []).includes(st);
          const ok = f.ok.includes(st), erro = f.erro.includes(st);
          const quando = Date.parse(r.updated_at || r.created_at || 0) || 0;
          const recente = Date.now() - quando < RECENTE_MS;
          if (!rodando && !parado && !(recente && (ok || erro))) continue;
          const item = { key: `${f.id}:${r.id}`, fila: f.id, rotulo: f.rotulo, ix: f.ix, id: r.id, status: st,
            titulo: corta(f.titulo(r)) || f.rotulo, etapa: f.etapa(r) || st, erro: r[f.campoErro || 'error'] || null,
            rodando, parado, ok, erro_ok: erro, quando };
          jobs.push(item);
          // avisa só na virada de estado, e nunca na primeira leitura da sessão
          const antes = this.visto[item.key];
          if (!this.primeira && antes && antes !== st) {
            if (erro) avisos.push({ tipo: 'erro', title: `${f.rotulo} falhou`, text: `${item.titulo}${item.erro ? ' — ' + corta(item.erro, 90) : ''}` });
            else if (ok) avisos.push({ tipo: 'ok', title: `${f.rotulo} pronto`, text: item.titulo });
            else if (parado) avisos.push({ tipo: 'ok', title: `${f.rotulo} esperando você`, text: `${item.titulo} — está em revisão` });
          }
          this.visto[item.key] = st;
        }
      }
      jobs.sort((a, b) => (b.rodando - a.rodando) || (b.quando - a.quando));
      this.jobs = jobs.slice(0, 24);

      // ideias capturadas ainda não trabalhadas
      const antesIdeias = new Set(this.ideias.map((i) => i.id));
      try {
        const rows = await this.rest('GET', 'saved_content?status=eq.novo&select=id,title,summary,raw_text,source,platform,content_type,source_url,created_at&order=created_at.desc&limit=12') || [];
        this.ideias = rows.map((r) => ({ id: r.id, titulo: corta(r.title || r.summary || r.raw_text, 90) || '(sem texto)', fonte: r.source || r.platform || '', tipo: r.content_type, url: r.source_url, quando: Date.parse(r.created_at) || 0 }));
        if (!this.primeira) for (const i of this.ideias) if (!antesIdeias.has(i.id)) avisos.push({ tipo: 'ideia', title: 'Ideia capturada', text: i.titulo });
      } catch (e) { falhou = 'Ideias: ' + e.message; }

      // publicações a sair / travadas
      const posts = [];
      for (const a of AGENDA) {
        try {
          const rows = await this.rest('GET', `${a.tabela}?select=${a.sel}&${'status'}=in.(${a.ativos.join(',')})&order=${a.quando}.asc&limit=8`) || [];
          for (const r of rows) posts.push({ key: `${a.id}:${r.id}`, plataforma: a.rotulo, id: r.id, status: r.status, titulo: corta(a.titulo(r), 60) || a.rotulo, quando: Date.parse(r[a.quando]) || 0, erro: r.error || null, link: r.permalink || r.tiktok_post_url || r.youtube_url || null });
        } catch (e) { falhou = `${a.rotulo}: ${e.message}`; }
      }
      posts.sort((a, b) => (a.quando || Infinity) - (b.quando || Infinity));
      this.posts = posts.slice(0, 12);
      if (!this.primeira) for (const p of this.posts) {
        const antes = this.visto[p.key];
        if (antes && antes !== p.status && p.status === 'failed') avisos.push({ tipo: 'erro', title: `Publicação no ${p.plataforma} falhou`, text: `${p.titulo}${p.erro ? ' — ' + corta(p.erro, 80) : ''}` });
        this.visto[p.key] = p.status;
      } else for (const p of this.posts) this.visto[p.key] = p.status;

      this.lastAt = Date.now();
      this.error = falhou;                       // some sozinho quando a consulta volta a funcionar
    } finally { this.loading = false; }

    const c = this.cfg();
    for (const a of avisos) {
      if (a.tipo === 'ideia' ? c.avisarIdeias : (a.tipo === 'erro' && /Publicação/.test(a.title) ? c.avisarPosts : c.avisarJobs)) this.notify(a);
    }
    this.primeira = false;
    this.emit('change', this.state());
    return this.state();
  }

  start() {
    this.stop();
    if (!this.cfg().enabled || !this.linked() || !this.configurado()) return;
    this.timer = setInterval(() => this.refresh().catch(() => {}), this.cfg().pollSec * 1000);
    if (Date.now() - this.lastAt > 5000) this.refresh().catch(() => {});   // acabou de ler no login: não lê de novo
  }
  stop() { clearInterval(this.timer); this.timer = null; }

  // ---------- escrita ----------
  async novaIdeia({ texto, titulo, url, tags } = {}) {
    const t = String(texto || '').trim();
    if (!t && !url) throw new Error('escreva a ideia');
    const row = { raw_text: t || null, title: titulo || null, source_url: url || null, source: 'sidenotch', content_type: 'project_idea', status: 'novo', tags: Array.isArray(tags) ? tags : [] };
    const r = await this.rest('POST', 'saved_content', row, { Prefer: 'return=representation' });
    await this.refresh().catch(() => {});
    return Array.isArray(r) ? r[0] : r;
  }
  async marcarIdeia(id, status = 'processado') {
    await this.rest('PATCH', `saved_content?id=eq.${encodeURIComponent(id)}`, { status });
    this.ideias = this.ideias.filter((i) => i.id !== id);
    this.emit('change', this.state());
    return this.state();
  }

  // ---------- ações (endpoint do Ideia Central) ----------
  async acao(id) {
    const a = ACOES[id]; if (!a) throw new Error('ação desconhecida');
    const { url, anon, site } = this.cfg();
    let alvo, headers = { 'Content-Type': 'application/json' };
    if (a.alvo === 'function') {
      alvo = `${url}/functions/v1/${a.rota}`; headers.apikey = anon;
      if (this.linked()) { await this._ensure(); headers.Authorization = `Bearer ${this.session.access_token}`; }
      if (this.autoSecret) headers['x-automation-secret'] = this.autoSecret;
    } else {
      if (!site) throw new Error('Falta o endereço do app (ex.: https://ideiacentral.vercel.app) nas configurações.');
      if (!this.autoSecret) throw new Error('Essa ação usa o x-automation-secret — cadastre-o nas configurações.');
      alvo = `${site}${a.rota}`; headers['x-automation-secret'] = this.autoSecret;
    }
    const res = await this.fetch(alvo, { method: 'POST', headers, body: JSON.stringify(a.corpo) });
    const txt = await res.text();
    let body = txt; try { body = JSON.parse(txt); } catch { /* texto */ }
    if (!res.ok) throw new Error((body && (body.error || body.message)) || `HTTP ${res.status}`);
    setTimeout(() => this.refresh().catch(() => {}), 4000);
    return { ok: true, nome: a.nome, body };
  }

  state() {
    const rodando = this.jobs.filter((j) => j.rodando);
    return {
      enabled: this.cfg().enabled, configurado: this.configurado(), linked: this.linked(), email: this.email(),
      temSecret: !!this.autoSecret, site: this.cfg().site, error: this.error, lastAt: this.lastAt,
      jobs: this.jobs, ideias: this.ideias, posts: this.posts,
      counts: {
        rodando: rodando.length,
        parados: this.jobs.filter((j) => j.parado).length,
        falhas: this.jobs.filter((j) => j.erro_ok).length,
        ideias: this.ideias.length,
        agendados: this.posts.filter((p) => p.status !== 'failed').length,
        postFalhas: this.posts.filter((p) => p.status === 'failed').length
      },
      acoes: Object.entries(ACOES).map(([id, a]) => ({ id, nome: a.nome, precisaSecret: a.alvo === 'site' }))
    };
  }
  dispose() { this.stop(); clearTimeout(this.refreshTimer); }
}

module.exports = { IdeiaClient, FILAS, AGENDA, ACOES, DEFAULT_URL };
