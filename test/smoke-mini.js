// Fora do `npm test` porque precisa do jsdom (não é dependência do app): `npm i -D jsdom && node test/smoke-mini.js`.
// A pastilha fechada é um resumo: com tudo ligado ela corta o menos importante em vez de estourar.
const { JSDOM } = require('jsdom'); const fs = require('fs');
const html = fs.readFileSync('src/renderer/notch.html', 'utf8');
const corte = html.lastIndexOf('<script>');
const dom = new JSDOM(html.slice(0, corte), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const w = dom.window, d = w.document;
const nada = () => Promise.resolve(null); const noop = () => {};
const ev = {};                       // guarda os callbacks do preload para alimentar o renderer pelo caminho real
const on = (k) => (fn) => { ev[k] = fn; };
w.sidenotch = new Proxy({
  getSettings: async () => ({ modules: {}, notch: { show: {}, miniWidth: 520, miniMax: 8 }, hub: {}, focus: {} }),
  getApprovals: async () => ({ pending: [], maestri: null }),
  notchHot: noop, setIgnoreMouse: noop, setFocusable: noop, openSettings: noop
}, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' && k.startsWith('on') ? on(k) : nada)) });
w.eval(fs.readFileSync('src/renderer/iconsax.js', 'utf8'));
w.eval(fs.readFileSync('src/renderer/logos.js', 'utf8'));
w.eval(html.slice(corte + 8, html.indexOf('</scr' + 'ipt>', corte)));

setTimeout(() => {
  // jsdom não faz layout: cada .segwrap vale LARG px, só para haver o que medir
  let LARG = 120;
  Object.defineProperty(w, 'innerWidth', { configurable: true, value: 1600 });
  Object.defineProperty(w.HTMLElement.prototype, 'scrollWidth', { configurable: true, get() { return this.id === 'mini' ? this.querySelectorAll('.segwrap').length * LARG : 0; } });
  const cfg = (miniWidth, miniMax) => ({ modules: {}, notch: { show: {}, miniWidth, miniMax }, hub: {}, focus: {} });
  const encher = (miniWidth = 520, miniMax = 8) => {
    ev.onSettings(cfg(miniWidth, miniMax));
    ev.onSystem({ cpu: 27, mem: { percent: 60 }, media: { title: 'R&B/Soul', artist: 'Billie Eilish, SZA', playing: true, art: '' } });
    ev.onWeather({ ok: true, icon: '☀', temp: 28, desc: 'sol' });
    ev.onCalendar({ next: { start: Date.now() + 3600000, title: 'Reunião de equipe' } });
    ev.onApprovals({ pending: [{}], maestri: null });
    ev.onHub({ linked: true, unread: 47, tasks: [1, 2, 3], overdue: 0, chatUnread: 869, hasBoard: true, board: { stats: { emDev: 2, paradas: 1, bloqueadas: 0 } }, boardFeed: [], boardAlerts: null, profile: {} });
    ev.onCoffee({ people: [{ nome: 'Marina', running: true, over: 0, remaining: 1180, limite: 1200 }], last: [], limite: 1200, counts: {} });
    ev.onIdeia({ linked: true, configurado: true, counts: { rodando: 2, falhas: 0 }, jobs: [], ideias: [], posts: [], acoes: [] });
    ev.onFocus({ active: true, running: true, remaining: 900, title: 'Terminar o relatório', streak: 4 });
  };
  encher();
  const mini = d.querySelector('#mini');
  const itens = () => [...mini.querySelectorAll('.segwrap')];
  const txt = () => mini.textContent;
  console.assert(itens().length <= 4, 'corta até caber em 520 px (4 itens de 120 px): ' + itens().length);
  console.assert(/\d{2}:\d{2}/.test(txt()), 'o relógio nunca é cortado: ' + txt());
  console.assert(/⚠/.test(txt()), 'alerta de aprovação fica: ' + txt());
  console.assert(!/Billie/.test(txt()), 'música é a primeira a sair');
  console.assert(!/28°/.test(txt()), 'clima sai antes do que importa');
  const larg = parseInt(d.querySelector('#pill').style.width, 10);
  console.assert(larg <= 520, 'a pastilha respeita o teto: ' + larg);

  LARG = 60; ev.onSettings(cfg(1300, 14));
  console.assert(itens().length >= 12, 'com largura, mostra o resto: ' + itens().length);
  console.assert(/Billie/.test(txt()), 'música volta quando cabe');

  ev.onSettings(cfg(1300, 4));
  console.assert(itens().length === 4, 'respeita o máximo de itens: ' + itens().length);
  console.assert(/\d{2}:\d{2}/.test(txt()) && /⚠/.test(txt()), 'e mantém relógio e alerta: ' + txt());

  ev.onSystem(null); ev.onWeather(null); ev.onCalendar(null); ev.onApprovals({ pending: [], maestri: null });
  ev.onHub({ linked: false }); ev.onCoffee({ people: [], last: [] }); ev.onIdeia({ linked: false, counts: {} }); ev.onFocus({ active: false });
  ev.onSettings({ modules: {}, notch: { show: { clock: false }, miniWidth: 1300, miniMax: 8 }, hub: {}, focus: {} });
  console.assert(/SideNotch/.test(mini.textContent), 'sem nada, mostra o nome: ' + mini.textContent);
  console.log('pastilha fechada OK');
  process.exit(0);
}, 200);
