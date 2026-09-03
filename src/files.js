// Bandeja de arquivos: guarda referências (não copia nada), permite arrastar de volta para qualquer app
// e transformar em link assinado de 7 dias no Storage do Hub (bucket "bandeja").
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const MAX = 60;
const MAX_UPLOAD = 100 * 1024 * 1024;   // o bucket corta em 100 MB

const KIND = [
  [/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i, 'image'],
  [/\.(pdf)$/i, 'pdf'],
  [/\.(docx?|odt|rtf)$/i, 'doc'],
  [/\.(xlsx?|xlsm|csv|ods)$/i, 'sheet'],
  [/\.(pptx?|odp)$/i, 'slide'],
  [/\.(zip|rar|7z|tar|gz)$/i, 'zip'],
  [/\.(mp4|mov|avi|mkv|webm)$/i, 'video'],
  [/\.(mp3|wav|ogg|m4a|flac)$/i, 'audio'],
  [/\.(txt|md|json|xml|log|ya?ml)$/i, 'text']
];
const kindOf = (p) => (KIND.find(([re]) => re.test(p)) || [null, 'file'])[1];
const MIME = { image: 'image/*', pdf: 'application/pdf', video: 'video/*', audio: 'audio/*', text: 'text/plain' };

class FileTray extends EventEmitter {
  constructor(dir) {
    super();
    this.file = dir ? path.join(dir, 'tray.json') : null;
    this.items = [];
    this._load();
  }
  _load() { try { const j = JSON.parse(fs.readFileSync(this.file, 'utf8')); this.items = Array.isArray(j.items) ? j.items : []; } catch { /* primeira vez */ } }
  _save() { try { fs.writeFileSync(this.file, JSON.stringify({ items: this.items }), 'utf8'); } catch { /* ignore */ } this.emit('change', this.list()); }

  add(paths) {
    const out = [];
    for (const p of [].concat(paths || [])) {
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) continue;                       // pasta não entra (arrastar pasta some do destino)
      const exist = this.items.find((x) => x.path === p);
      if (exist) { exist.at = Date.now(); out.push(exist); continue; }
      const it = { id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), path: p, name: path.basename(p), ext: path.extname(p).slice(1).toLowerCase(), kind: kindOf(p), size: st.size, at: Date.now(), pinned: false };
      this.items.unshift(it); out.push(it);
    }
    if (this.items.length > MAX) this.items = [...this.items.filter((i) => i.pinned), ...this.items.filter((i) => !i.pinned)].slice(0, MAX);
    this._save();
    return out;
  }
  get(id) { return this.items.find((x) => x.id === id) || null; }
  remove(id) { this.items = this.items.filter((x) => x.id !== id); this._save(); return this.list(); }
  clear() { this.items = this.items.filter((x) => x.pinned); this._save(); return this.list(); }
  pin(id, v) { const it = this.get(id); if (it) { it.pinned = v == null ? !it.pinned : !!v; this._save(); } return it ? it.pinned : false; }
  // some da lista o que o usuário apagou/moveu no disco
  prune() { const before = this.items.length; this.items = this.items.filter((i) => { try { return fs.existsSync(i.path); } catch { return false; } }); if (this.items.length !== before) this._save(); return this.list(); }
  list() { return this.items.map((i) => ({ ...i, missing: !safeExists(i.path) })); }

  async upload(id, hub) {
    const it = this.get(id); if (!it) throw new Error('arquivo não está mais na bandeja');
    if (!safeExists(it.path)) throw new Error('o arquivo saiu do lugar');
    if (!hub || !hub.session) throw new Error('vincule o Medsystem Hub para gerar o link');
    if (it.size > MAX_UPLOAD) throw new Error(`arquivo grande demais (${(it.size / 1048576).toFixed(0)} MB; limite 100 MB)`);
    await hub._ensure();
    const uid = hub.session.user.id;
    const safe = it.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\- ]+/g, '_').slice(-90);
    const objPath = `${uid}/${it.id}-${safe}`;
    const buf = fs.readFileSync(it.path);
    const up = await hub.fetch(`${hub.url}/storage/v1/object/bandeja/${encodeURI(objPath)}`, {
      method: 'POST',
      headers: { apikey: hub.anon, Authorization: `Bearer ${hub.session.access_token}`, 'Content-Type': MIME[it.kind] || 'application/octet-stream', 'x-upsert': 'true' },
      body: buf
    });
    if (!up.ok) throw new Error('upload falhou: ' + (await up.text()).slice(0, 160));
    const sg = await hub.fetch(`${hub.url}/storage/v1/object/sign/bandeja/${encodeURI(objPath)}`, {
      method: 'POST', headers: { apikey: hub.anon, Authorization: `Bearer ${hub.session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 7 * 24 * 3600 })
    });
    const j = await sg.json().catch(() => ({}));
    if (!sg.ok || !j.signedURL) throw new Error('não consegui assinar a URL');
    const url = `${hub.url}/storage/v1${j.signedURL}`;
    it.url = url; it.uploadedAt = Date.now(); this._save();
    return url;
  }
}
function safeExists(p) { try { return fs.existsSync(p); } catch { return false; } }

module.exports = { FileTray, kindOf, MAX_UPLOAD };
