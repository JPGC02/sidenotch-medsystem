// Pausa do café: um timer por pessoa, vários ao mesmo tempo. Quando passa do limite não para —
// continua contando o excedente (em vermelho) até alguém encerrar. Cada pausa encerrada vai para
// coffee_breaks no Supabase, que é privado de quem registra (RLS por owner_id).
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const TICK = 1000;

class Coffee extends EventEmitter {
  constructor({ userData, hub, notify, getSettings } = {}) {
    super();
    this.file = userData ? path.join(userData, 'coffee.json') : null;
    this.hub = hub || null; this.notify = notify || (() => {}); this.getSettings = getSettings || (() => ({}));
    this.running = {};      // pessoa -> { startedAt, limite, avisou }
    this.pending = [];      // pausas encerradas ainda não gravadas
    this.summary = { people: [], last: [] };
    this.timer = null;
    this._load();
    if (Object.keys(this.running).length) this._tick();
  }
  hubRef(h) { this.hub = h; }

  cfg() {
    const c = (this.getSettings() || {}).coffee || {};
    const nomes = Array.isArray(c.people) && c.people.length ? c.people : ['Marina', 'Julia'];
    return { people: nomes.map((n) => String(n).trim()).filter(Boolean).slice(0, 8), limite: Math.max(60, Math.round((Number(c.minutes) || 20) * 60)), avisar: c.alert !== false };
  }
  _load() { try { const j = JSON.parse(fs.readFileSync(this.file, 'utf8')); this.running = j.running || {}; this.pending = j.pending || []; this.summary = j.summary || this.summary; } catch { /* primeira vez */ } }
  _save() { try { fs.writeFileSync(this.file, JSON.stringify({ running: this.running, pending: this.pending, summary: this.summary }), 'utf8'); } catch { /* ignore */ } }

  start(pessoa, limiteSec) {
    const nome = String(pessoa || '').trim(); if (!nome) return this.state();
    if (this.running[nome]) return this.state();                     // já está correndo
    this.running[nome] = { startedAt: Date.now(), limite: Math.max(60, Math.round(limiteSec || this.cfg().limite)), avisou: false };
    this._save(); this._tick(); this.emit('change', this.state());
    return this.state();
  }
  // encerra e devolve o registro (que vai para o banco)
  stop(pessoa) {
    const nome = String(pessoa || '').trim(); const r = this.running[nome]; if (!r) return this.state();
    const secs = Math.max(0, Math.round((Date.now() - r.startedAt) / 1000));
    delete this.running[nome];
    if (secs >= 5) { this.pending.push({ pessoa: nome, seconds: secs, limite: r.limite, startedAt: r.startedAt }); this.flush(); }
    this._save();
    if (!Object.keys(this.running).length) this._stopTimer();
    this.emit('change', this.state());
    return this.state();
  }
  toggle(pessoa, limite) { return this.running[String(pessoa || '').trim()] ? this.stop(pessoa) : this.start(pessoa, limite); }
  cancel(pessoa) { delete this.running[String(pessoa || '').trim()]; this._save(); if (!Object.keys(this.running).length) this._stopTimer(); this.emit('change', this.state()); return this.state(); }

  _stopTimer() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
  _tick() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const nomes = Object.keys(this.running);
      if (!nomes.length) return this._stopTimer();
      const { avisar } = this.cfg();
      for (const n of nomes) {
        const r = this.running[n];
        const passou = (Date.now() - r.startedAt) / 1000 - r.limite;
        if (passou >= 0 && !r.avisou) {                              // estourou o limite: avisa uma vez e segue contando
          r.avisou = true; this._save();
          if (avisar) this.notify({ type: 'coffee', title: `☕ ${n} passou de ${Math.round(r.limite / 60)} min`, text: 'O timer continua contando até você encerrar.' });
        }
      }
      this.emit('tick', this.state());
    }, TICK);
  }

  async flush() {
    if (!this.pending.length || !this.hub || !this.hub.linked || !this.hub.linked()) return false;
    for (const b of [...this.pending]) {
      try { await this.hub.coffeeLog(b); this.pending = this.pending.filter((x) => x !== b); }
      catch { break; }                                               // sem rede: tenta depois
    }
    this._save();
    await this.refresh();
    return true;
  }
  async refresh() {
    if (!this.hub || !this.hub.linked || !this.hub.linked()) return this.summary;
    try { this.summary = await this.hub.coffeeSummary(30); this._save(); this.emit('change', this.state()); } catch { /* mantém o cache */ }
    return this.summary;
  }

  state() {
    const { people, limite } = this.cfg();
    const nomes = [...new Set([...people, ...Object.keys(this.running)])];
    const agora = Date.now();
    return {
      limite,
      pending: this.pending.length,
      people: nomes.map((n) => {
        const r = this.running[n];
        const elapsed = r ? Math.round((agora - r.startedAt) / 1000) : 0;
        const lim = r ? r.limite : limite;
        const resumo = (this.summary.people || []).find((p) => p.pessoa === n) || {};
        return {
          nome: n, running: !!r, elapsed, limite: lim,
          remaining: r ? Math.max(0, lim - elapsed) : lim,
          over: r ? Math.max(0, elapsed - lim) : 0,
          progress: r ? Math.min(1, elapsed / lim) : 0,
          startedAt: r ? r.startedAt : null,
          hoje: resumo.hoje || 0, hojeN: resumo.hojeN || 0, media: resumo.media || 0, semana: resumo.semana || 0, excedeu: resumo.excedeu || 0
        };
      }),
      last: (this.summary.last || []).slice(0, 12)
    };
  }
  dispose() { this._stopTimer(); this._save(); }
}

module.exports = { Coffee };
