// Histórico da área de transferência (estilo Win+V): observa o clipboard, guarda texto e imagens, permite fixar e recolocar.
// Persistido em userData/clipboard.json (imagens como PNG data URL, limitadas em tamanho).
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ClipboardHistory extends EventEmitter {
  constructor(dir, clip, { max = 60, imageMax = 400 * 1024, pollMs = 700 } = {}) {
    super();
    this.file = path.join(dir, 'clipboard.json');
    this.clip = clip;               // electron.clipboard (ou fake nos testes)
    this.max = max; this.imageMax = imageMax; this.pollMs = pollMs;
    this.items = this._load();
    this.lastHash = null; this.timer = null; this.paused = false; this.ignoreOnce = null;
  }
  _load() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')).items || []; } catch { return []; } }
  _save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify({ items: this.items })); } catch { /* ignore */ } }

  start() { this.stop(); this.timer = setInterval(() => this.poll(), this.pollMs); this.poll(); }
  stop() { clearInterval(this.timer); this.timer = null; }

  poll() {
    if (this.paused) return;
    try {
      const formats = this.clip.availableFormats ? this.clip.availableFormats() : ['text/plain'];
      let entry = null;
      if (formats.some((f) => /^image\//.test(f))) {
        const img = this.clip.readImage(); if (img && !img.isEmpty()) {
          const png = img.toPNG(); if (png.length <= this.imageMax) { const size = img.getSize(); entry = { type: 'image', data: 'data:image/png;base64,' + png.toString('base64'), w: size.width, h: size.height, hash: crypto.createHash('sha1').update(png).digest('hex') }; }
        }
      }
      if (!entry) {
        const text = this.clip.readText();
        if (text && text.trim()) entry = { type: 'text', text: text.slice(0, 20000), hash: crypto.createHash('sha1').update(text).digest('hex') };
      }
      if (!entry) return;
      if (entry.hash === this.lastHash) return;
      this.lastHash = entry.hash;
      if (this.ignoreOnce === entry.hash) { this.ignoreOnce = null; return; }
      this.add(entry);
    } catch { /* clipboard ocupado por outro app */ }
  }

  add(entry) {
    const existing = this.items.find((i) => i.hash === entry.hash);
    if (existing) { existing.at = Date.now(); this.items = [existing, ...this.items.filter((i) => i !== existing)]; }
    else {
      const item = { id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), pinned: false, ...entry };
      if (item.type === 'text') { item.preview = item.text.replace(/\s+/g, ' ').trim().slice(0, 160); item.kind = classify(item.text); }
      this.items.unshift(item);
      const pinned = this.items.filter((i) => i.pinned), rest = this.items.filter((i) => !i.pinned).slice(0, this.max);
      this.items = [...pinned, ...rest].sort((a, b) => b.at - a.at || 0);
    }
    this._save(); this.emit('change');
  }

  // recoloca o item no clipboard (sem registrar de novo como entrada nova)
  use(id) {
    const it = this.items.find((i) => i.id === id); if (!it) return false;
    this.ignoreOnce = it.hash; this.lastHash = it.hash;
    if (it.type === 'image') { const { nativeImage } = require('electron'); this.clip.writeImage(nativeImage.createFromDataURL(it.data)); }
    else this.clip.writeText(it.text);
    it.at = Date.now(); this.items = [it, ...this.items.filter((i) => i !== it)]; this._save(); this.emit('change');
    return true;
  }
  pin(id, v) { const it = this.items.find((i) => i.id === id); if (it) { it.pinned = v == null ? !it.pinned : !!v; this._save(); this.emit('change'); } }
  remove(id) { this.items = this.items.filter((i) => i.id !== id); this._save(); this.emit('change'); }
  clear(keepPinned = true) { this.items = keepPinned ? this.items.filter((i) => i.pinned) : []; this._save(); this.emit('change'); }
  list() { return this.items.map((i) => (i.type === 'image' ? { id: i.id, type: 'image', at: i.at, pinned: i.pinned, w: i.w, h: i.h, data: i.data } : { id: i.id, type: 'text', at: i.at, pinned: i.pinned, preview: i.preview, kind: i.kind, len: i.text.length, text: i.text.slice(0, 2000) })); }
}

function classify(t) {
  const s = t.trim();
  if (/^https?:\/\/\S+$/i.test(s)) return 'url';
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(s)) return 'email';
  if (/^#?[0-9a-f]{6}$/i.test(s)) return 'color';
  if (/^[a-z]:\\|^\\\\/i.test(s)) return 'path';
  if (/^[\d\s().+-]{8,}$/.test(s)) return 'phone';
  if (/^\d+([.,]\d+)?$/.test(s)) return 'number';
  if (/\n/.test(s) && /[{};=]|^\s*(const|let|function|import|def|class)\b/m.test(s)) return 'code';
  return 'text';
}

module.exports = { ClipboardHistory, classify };
