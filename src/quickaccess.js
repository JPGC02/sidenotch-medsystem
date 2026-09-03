// Quick Access de capturas (inspirado no CleanShot X): captura de área → pilha de cards no canto → editar / copiar / salvar /
// enviar (Supabase Storage, URL assinada 7 dias) / OCR (tesseract.js) / arrastar PNG real para outros apps.
const { BrowserWindow, screen, desktopCapturer, nativeImage, clipboard, ipcMain, dialog, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { Captures } = require('./captures');

class QuickAccess {
  constructor({ userData, getSettings, hub, notify, broadcast }) {
    this.caps = new Captures(userData);
    this.getSettings = getSettings; this.hub = hub; this.notify = notify || (() => {}); this.broadcast = broadcast || (() => {});
    this.stack = null; this.select = null; this.editor = null; this.shot = null;
    this.caps.on('change', () => this.broadcast('captures', this.caps.list()));
    this._ipc();
  }
  hubRef(h) { this.hub = h; }

  // ---------- captura de área ----------
  async captureArea() {
    if (this.select && !this.select.isDestroyed()) { this.select.focus(); return; }
    const cur = screen.getCursorScreenPoint();
    const d = screen.getDisplayNearestPoint(cur);
    const scale = d.scaleFactor || 1;
    // 1) tira a foto do monitor antes de mostrar qualquer coisa
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.size.width * scale), height: Math.round(d.size.height * scale) } });
    const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[0];
    if (!src) { this.notify({ type: 'error', title: 'Captura', text: 'Nenhuma tela disponível para capturar.' }); return; }
    this.shot = { image: src.thumbnail, display: d, scale };
    // 2) overlay de seleção transparente sobre o desktop (sem escurecer)
    const win = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false, hasShadow: false, fullscreenable: false, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
    });
    this.select = win;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setMenu(null);
    win.loadFile(path.join(__dirname, 'renderer', 'select.html'));
    win.once('ready-to-show', () => { win.show(); win.focus(); });
    win.on('closed', () => { if (this.select === win) this.select = null; });
  }
  _finishSelection(rect) {
    const s = this.shot; if (this.select && !this.select.isDestroyed()) this.select.close(); this.select = null;
    if (!s || !rect || rect.w < 3 || rect.h < 3) return null;
    const crop = s.image.crop({ x: Math.round(rect.x * s.scale), y: Math.round(rect.y * s.scale), width: Math.round(rect.w * s.scale), height: Math.round(rect.h * s.scale) });
    const png = crop.toPNG(); const size = crop.getSize();
    const item = this.caps.add(png, { w: size.width, h: size.height, source: 'area', displayId: String(s.display.id) });
    this.shot = null;
    this.showStack(s.display); this._push(item);
    return item;
  }

  // ---------- pilha ----------
  showStack(display) {
    const d = display || screen.getPrimaryDisplay();
    const cfg = this.getSettings().quickaccess || {};
    const W = 300, H = Math.min(d.workArea.height, 900);
    if (!this.stack || this.stack.isDestroyed()) {
      const win = new BrowserWindow({
        width: W, height: H, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false, hasShadow: false, focusable: false, show: false,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
      });
      this.stack = win;
      win.setAlwaysOnTop(true, 'screen-saver'); win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); win.setMenu(null);
      win.setIgnoreMouseEvents(true, { forward: true });
      win.loadFile(path.join(__dirname, 'renderer', 'qa.html'));
      win.on('closed', () => { this.stack = null; });
      win.webContents.on('did-finish-load', () => win.webContents.send('qa:config', { ttl: Number(cfg.ttlSec) || 0, side: cfg.side || 'left' }));
    }
    const side = cfg.side || 'left';
    const x = side === 'right' ? d.workArea.x + d.workArea.width - W : d.workArea.x;
    this.stack.setBounds({ x, y: d.workArea.y + d.workArea.height - H, width: W, height: H });
    if (!this.stack.isVisible()) this.stack.show();
  }
  _push(item) { const send = () => this.stack && !this.stack.isDestroyed() && this.stack.webContents.send('qa:push', this._card(item)); if (this.stack.webContents.isLoading()) this.stack.webContents.once('did-finish-load', () => setTimeout(send, 50)); else send(); }
  _card(item) { const it = this.caps.get(item.id) || item; return { ...it, thumb: 'file:///' + this.caps.best(it.id).replace(/\\/g, '/') + '?v=' + (it.editedAt || it.at) }; }
  restore(id) { const it = this.caps.get(id); if (!it) return false; this.showStack(); this._push(it); return true; }

  // ---------- ações ----------
  copy(id) { const it = this.caps.get(id); if (!it) return false; clipboard.writeImage(nativeImage.createFromPath(this.caps.best(id))); return true; }
  async saveAs(id) {
    const it = this.caps.get(id); if (!it) return null;
    const r = await dialog.showSaveDialog({ title: 'Salvar captura', defaultPath: path.join(app.getPath('pictures'), `captura-${new Date(it.at).toISOString().slice(0, 19).replace(/[T:]/g, '-')}.png`), filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (r.canceled) return null;
    fs.copyFileSync(this.caps.best(id), r.filePath); return r.filePath;
  }
  startDrag(webContents, id) {
    const it = this.caps.get(id); if (!it) return;
    const file = this.caps.best(id);
    const icon = nativeImage.createFromPath(file).resize({ width: 128 });
    webContents.startDrag({ file, icon });
  }
  async upload(id) {
    const it = this.caps.get(id); if (!it) throw new Error('captura não encontrada');
    if (!this.hub || !this.hub.session) throw new Error('vincule o Medsystem Hub para enviar');
    await this.hub._ensure();
    const uid = this.hub.session.user.id; const objPath = `${uid}/${id}${it.annotated ? '-annotated' : ''}.png`;
    const buf = fs.readFileSync(this.caps.best(id));
    const up = await this.hub.fetch(`${this.hub.url}/storage/v1/object/captures/${objPath}`, { method: 'POST', headers: { apikey: this.hub.anon, Authorization: `Bearer ${this.hub.session.access_token}`, 'Content-Type': 'image/png', 'x-upsert': 'true' }, body: buf });
    if (!up.ok) throw new Error('upload falhou: ' + (await up.text()).slice(0, 200));
    const sg = await this.hub.fetch(`${this.hub.url}/storage/v1/object/sign/captures/${objPath}`, { method: 'POST', headers: { apikey: this.hub.anon, Authorization: `Bearer ${this.hub.session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 7 * 24 * 3600 }) });
    const j = await sg.json().catch(() => ({}));
    if (!sg.ok || !j.signedURL) throw new Error('não consegui assinar a URL');
    const url = `${this.hub.url}/storage/v1${j.signedURL}`;
    clipboard.writeText(url);
    this.caps.update(id, { uploadedUrl: url, uploadedAt: Date.now() });
    return url;
  }
  async ocr(id) {
    const it = this.caps.get(id); if (!it) throw new Error('captura não encontrada');
    let T; try { T = require('tesseract.js'); } catch { throw new Error('OCR indisponível (tesseract.js não instalado)'); }
    const worker = await T.createWorker('por', 1, { cachePath: path.join(app.getPath('userData'), 'tessdata'), logger: () => {} });
    try {
      const { data } = await worker.recognize(this.caps.file(id));
      const text = (data.text || '').trim();
      this.caps.update(id, { text });
      if (text) clipboard.writeText(text);
      return text;
    } finally { await worker.terminate().catch(() => {}); }
  }

  // ---------- editor ----------
  openEditor(id) {
    const it = this.caps.get(id); if (!it) return;
    if (this.editor && !this.editor.isDestroyed()) { this.editor.close(); }
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const w = Math.min(d.workArea.width - 80, Math.max(720, it.w + 260)), h = Math.min(d.workArea.height - 80, Math.max(520, it.h + 140));
    const win = new BrowserWindow({ width: w, height: h, title: 'Editar captura', backgroundColor: '#0B0C0E', autoHideMenuBar: true, icon: path.join(__dirname, 'assets', 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
    this.editor = win; win.setMenu(null);
    win.loadFile(path.join(__dirname, 'renderer', 'editor.html'), { query: { id } });
    win.on('closed', () => { if (this.editor === win) this.editor = null; });
  }

  // ---------- IPC ----------
  _ipc() {
    ipcMain.handle('qa:select-done', (_e, rect) => { const it = this._finishSelection(rect); return it ? it.id : null; });
    ipcMain.on('qa:select-cancel', () => { if (this.select && !this.select.isDestroyed()) this.select.close(); this.select = null; this.shot = null; });
    ipcMain.on('qa:interactive', (e, on) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.setIgnoreMouseEvents(!on, { forward: true }); });
    ipcMain.on('qa:drag', (e, id) => this.startDrag(e.sender, id));
    ipcMain.handle('qa:copy', (_e, id) => this.copy(id));
    ipcMain.handle('qa:save', (_e, id) => this.saveAs(id));
    ipcMain.handle('qa:upload', async (_e, id) => { try { return { ok: true, url: await this.upload(id) }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
    ipcMain.handle('qa:ocr', async (_e, id) => { try { return { ok: true, text: await this.ocr(id) }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
    ipcMain.handle('qa:pin', (_e, id, v) => { const it = this.caps.get(id); if (it) this.caps.update(id, { pinned: v == null ? !it.pinned : !!v }); return it ? this.caps.get(id).pinned : false; });
    ipcMain.handle('qa:edit', (_e, id) => { this.openEditor(id); return true; });
    ipcMain.handle('qa:list', () => this.caps.list());
    ipcMain.handle('qa:search', (_e, q) => this.caps.search(q).map((i) => this._card(i)));
    ipcMain.handle('qa:remove', (_e, id) => { this.caps.remove(id); return this.caps.list(); });
    ipcMain.handle('qa:restore', (_e, id) => this.restore(id));
    ipcMain.handle('qa:capture', () => { this.captureArea(); return true; });
    ipcMain.handle('qa:open-file', (_e, id) => { const it = this.caps.get(id); if (it) shell.openPath(this.caps.best(id)); return !!it; });
    ipcMain.handle('qa:editor-load', (_e, id) => { const it = this.caps.get(id); if (!it) return null; return { item: it, image: 'file:///' + this.caps.file(id).replace(/\\/g, '/'), shapes: this.caps.annotations(id) }; });
    ipcMain.handle('qa:editor-save', (_e, id, shapes, dataUrl) => {
      const png = dataUrl ? Buffer.from(String(dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64') : null;
      const it = this.caps.setAnnotations(id, shapes, png);
      if (this.stack && !this.stack.isDestroyed()) this.stack.webContents.send('qa:update', this._card(it));
      return true;
    });
    ipcMain.on('qa:stack-empty', () => { if (this.stack && !this.stack.isDestroyed()) this.stack.hide(); });
  }
}

module.exports = { QuickAccess };
