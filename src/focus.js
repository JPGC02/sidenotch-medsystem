// Foco (pomodoro) por tarefa do Hub: um ciclo por vez, tempo contado por relógio (não por ticks),
// gravado no Supabase (RPC focus_log → soma em tasks.focus_seconds) e resumido em streak/heatmap (focus_summary).
// O tempo pendente fica em disco: se o app fechar no meio, a próxima sessão sincroniza.
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const DEFAULT_PLANNED = 25 * 60;   // 25 min
const DEFAULT_BREAK = 5 * 60;
const TICK = 1000;

class Focus extends EventEmitter {
  constructor({ userData, hub, notify, getSettings } = {}) {
    super();
    this.file = userData ? path.join(userData, 'focus.json') : null;
    this.hub = hub || null; this.notify = notify || (() => {}); this.getSettings = getSettings || (() => ({}));
    this.cur = null;              // { taskId, title, planned, startedAt, elapsed, running, lastAt, kind }
    this.summary = { days: [], streak: 0, today: 0, total: 0 };
    this.pending = [];            // sessões que ainda não foram gravadas
    this.timer = null;
    this._load();
  }
  hubRef(h) { this.hub = h; }

  _cfg() { const f = (this.getSettings() || {}).focus || {}; return { planned: Math.max(60, Number(f.minutes || 25) * 60), brk: Math.max(60, Number(f.breakMinutes || 5) * 60), autoStatus: f.autoStatus !== false, chime: f.chime !== false }; }
  _load() {
    try { const j = JSON.parse(fs.readFileSync(this.file, 'utf8')); this.pending = Array.isArray(j.pending) ? j.pending : []; this.summary = j.summary || this.summary; } catch { /* primeira vez */ }
  }
  _save() { try { fs.writeFileSync(this.file, JSON.stringify({ pending: this.pending, summary: this.summary }), 'utf8'); } catch { /* ignore */ } }

  // ---------- ciclo ----------
  start(task) {
    const t = task || {};
    const { planned } = this._cfg();
    if (this.cur && this.cur.taskId === (t.id || null)) { if (!this.cur.running) return this.resume(); return this.state(); }
    if (this.cur) this.stop('switch');
    this.cur = { taskId: t.id || null, title: t.title || 'Foco', kind: String(t.id || '').startsWith('at:') ? 'at' : (t.id ? 'task' : 'free'), planned: Math.max(60, Math.round((t.minutes ? t.minutes * 60 : planned))), startedAt: Date.now(), elapsed: 0, running: true, lastAt: Date.now(), break: false };
    this._tick(true);
    if (t.id && this._cfg().autoStatus) this._setStatus(t.id, 'in_progress');
    this.emit('change', this.state());
    return this.state();
  }
  pause() { if (!this.cur || !this.cur.running) return this.state(); this._accrue(); this.cur.running = false; this._stopTimer(); this.emit('change', this.state()); return this.state(); }
  resume() { if (!this.cur || this.cur.running) return this.state(); this.cur.running = true; this.cur.lastAt = Date.now(); this._tick(true); this.emit('change', this.state()); return this.state(); }
  toggle(task) {
    if (task && task.id && (!this.cur || this.cur.taskId !== task.id)) return this.start(task);
    if (!this.cur) return task ? this.start(task) : this.state();
    return this.cur.running ? this.pause() : this.resume();
  }
  // encerra o ciclo (reason: 'user' | 'done' | 'switch')
  stop(reason = 'user') {
    if (!this.cur) return this.state();
    this._accrue();
    const s = this.cur; this.cur = null; this._stopTimer();
    if (s.elapsed >= 5) { this.pending.push({ taskId: s.taskId, title: s.title, seconds: Math.round(s.elapsed), planned: s.planned, completed: reason === 'done', startedAt: s.startedAt }); this._save(); this.flush(); }
    this.emit('change', this.state());
    return this.state();
  }
  async complete(taskId) {   // concluir a tarefa (círculo do To Do)
    const id = taskId || (this.cur && this.cur.taskId);
    if (this.cur && this.cur.taskId === id) this.stop('done');
    if (id && this.hub) await this.hub.setTaskStatus(id, 'completed').catch(() => {});
    return this.state();
  }

  _accrue() { if (!this.cur || !this.cur.running) return; const now = Date.now(); this.cur.elapsed += Math.max(0, (now - this.cur.lastAt) / 1000); this.cur.lastAt = now; }
  _stopTimer() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
  _tick(restart) {
    if (restart) this._stopTimer();
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.cur || !this.cur.running) return this._stopTimer();
      this._accrue();
      if (this.cur.elapsed >= this.cur.planned) {
        const title = this.cur.title;
        this.notify({ type: 'focus', title: 'Ciclo concluído', text: `${Math.round(this.cur.planned / 60)} min em “${title}”. Hora da pausa.` });
        this.stop('done');
        return;
      }
      this.emit('tick', this.state());
    }, TICK);
  }
  _setStatus(id, status) { if (this.hub && this.hub.linked && this.hub.linked()) this.hub.setTaskStatus(id, status).catch(() => {}); }

  // ---------- sincronização ----------
  async flush() {
    if (!this.pending.length || !this.hub || !this.hub.linked || !this.hub.linked()) return false;
    const queue = [...this.pending];
    for (const s of queue) {
      try { await this.hub.logFocus(s); this.pending = this.pending.filter((x) => x !== s); }
      catch { break; }   // sem rede: tenta na próxima
    }
    this._save();
    await this.refresh();
    return true;
  }
  async refresh() {
    if (!this.hub || !this.hub.linked || !this.hub.linked()) return this.summary;
    try { this.summary = await this.hub.focusSummary(84); this._save(); this.emit('change', this.state()); } catch { /* mantém o cache */ }
    return this.summary;
  }

  state() {
    const c = this.cur;
    const cfg = this._cfg();
    let elapsed = c ? c.elapsed : 0;
    if (c && c.running) elapsed += Math.max(0, (Date.now() - c.lastAt) / 1000);
    return {
      active: !!c,
      running: !!(c && c.running),
      taskId: c ? c.taskId : null,
      title: c ? c.title : null,
      planned: c ? c.planned : cfg.planned,
      elapsed: Math.min(c ? c.planned : cfg.planned, Math.round(elapsed)),
      remaining: Math.max(0, Math.round((c ? c.planned : cfg.planned) - elapsed)),
      progress: c ? Math.max(0, Math.min(1, elapsed / c.planned)) : 0,
      streak: this.summary.streak || 0,
      todaySeconds: (this.summary.today || 0) + Math.round(elapsed),
      days: this.summary.days || [],
      pending: this.pending.length,
      minutes: Math.round(cfg.planned / 60)
    };
  }
  dispose() { this._stopTimer(); if (this.cur) this.stop('user'); }
}

module.exports = { Focus, DEFAULT_PLANNED, DEFAULT_BREAK };
