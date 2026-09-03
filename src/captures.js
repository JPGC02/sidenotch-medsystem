// Histórico de capturas (fonte de verdade da pilha Quick Access): PNGs em userData/captures/<id>.png,
// anotações em <id>.json (coordenadas normalizadas 0–1), rasterização em <id>-annotated.png, índice em index.json.
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class Captures extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = path.join(dir, 'captures');
    this.indexFile = path.join(this.dir, 'index.json');
    fs.mkdirSync(this.dir, { recursive: true });
    this.items = this._load();
  }
  _load() { try { return JSON.parse(fs.readFileSync(this.indexFile, 'utf8')).items || []; } catch { return []; } }
  _save() { try { fs.writeFileSync(this.indexFile, JSON.stringify({ items: this.items })); } catch { /* ignore */ } this.emit('change'); }

  file(id, kind = 'png') { return path.join(this.dir, kind === 'png' ? `${id}.png` : kind === 'json' ? `${id}.json` : `${id}-annotated.png`); }
  // caminho da melhor imagem para mostrar/exportar (anotada se existir)
  best(id) { const a = this.file(id, 'annotated'); return fs.existsSync(a) ? a : this.file(id, 'png'); }

  add(pngBuffer, { w, h, source = 'area', displayId = null } = {}) {
    const id = 'cap' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    fs.writeFileSync(this.file(id), pngBuffer);
    const item = { id, at: Date.now(), w, h, source, displayId, pinned: false, annotated: false, text: null, uploadedUrl: null, uploadedAt: null, bytes: pngBuffer.length };
    this.items.unshift(item);
    if (this.items.length > 500) { for (const old of this.items.splice(500)) this._unlink(old.id); }
    this._save();
    return item;
  }
  get(id) { return this.items.find((i) => i.id === id) || null; }
  update(id, patch) { const it = this.get(id); if (!it) return null; Object.assign(it, patch); this._save(); return it; }
  setAnnotations(id, shapes, rasterPng) {
    const it = this.get(id); if (!it) return null;
    fs.writeFileSync(this.file(id, 'json'), JSON.stringify({ v: 1, shapes: shapes || [] }));
    if (rasterPng) fs.writeFileSync(this.file(id, 'annotated'), rasterPng);
    it.annotated = !!(shapes && shapes.length); it.editedAt = Date.now();
    this._save(); return it;
  }
  annotations(id) { try { return JSON.parse(fs.readFileSync(this.file(id, 'json'), 'utf8')).shapes || []; } catch { return []; } }
  _unlink(id) { for (const k of ['png', 'json', 'annotated']) { try { fs.unlinkSync(this.file(id, k)); } catch { /* ignore */ } } }
  remove(id) { this.items = this.items.filter((i) => i.id !== id); this._unlink(id); this._save(); }
  clear(keepPinned = true) { for (const it of this.items) if (!(keepPinned && it.pinned)) this._unlink(it.id); this.items = keepPinned ? this.items.filter((i) => i.pinned) : []; this._save(); }
  search(q) {
    const s = String(q || '').trim().toLowerCase();
    return this.items.filter((i) => !s || (i.text || '').toLowerCase().includes(s) || (i.title || '').toLowerCase().includes(s));
  }
  list(limit = 200) { return this.items.slice(0, limit).map((i) => ({ ...i, file: this.best(i.id), thumb: 'file:///' + this.best(i.id).replace(/\\/g, '/') + '?v=' + (i.editedAt || i.at) })); }
}

module.exports = { Captures };
