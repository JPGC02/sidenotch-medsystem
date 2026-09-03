// Semáforo estilo macOS (fechar · minimizar · maximizar) no canto superior esquerdo de cada janela.
// Os símbolos só aparecem no hover, como no Mac; as ações vão pelo IPC win:ctl.
(function () {
  const css = `
    #traffic { position: fixed; top: 12px; left: 14px; display: flex; gap: 8px; z-index: 60; -webkit-app-region: no-drag; }
    #traffic button { width: 12px; height: 12px; border-radius: 50%; border: 1px solid rgba(0,0,0,.25); padding: 0; cursor: default; display: grid; place-items: center;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.35), 0 1px 2px rgba(0,0,0,.3); background: #ff5f57; transition: filter .12s; }
    #traffic button:hover { filter: brightness(1.1); }
    #traffic .min { background: #febc2e; } #traffic .max { background: #28c840; }
    #traffic svg { width: 7px; height: 7px; opacity: 0; stroke: rgba(0,0,0,.65); stroke-width: 1.6; fill: none; stroke-linecap: round; transition: opacity .12s; }
    #traffic:hover svg { opacity: 1; }
    body.win-blur #traffic button { background: #4d4d52; }   /* janela sem foco: cinza, como no Mac */
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const box = document.createElement('div'); box.id = 'traffic';
  box.innerHTML = `
    <button class="close" title="Fechar"><svg viewBox="0 0 10 10"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5"/></svg></button>
    <button class="min" title="Minimizar"><svg viewBox="0 0 10 10"><path d="M2 5h6"/></svg></button>
    <button class="max" title="Maximizar"><svg viewBox="0 0 10 10"><path d="M2.5 6.5V2.5h4M7.5 3.5v4h-4"/></svg></button>`;
  document.body.appendChild(box);
  const api = window.sidenotch;
  box.querySelector('.close').onclick = () => api && api.winCtl ? api.winCtl('close') : window.close();
  box.querySelector('.min').onclick = () => api && api.winCtl && api.winCtl('min');
  box.querySelector('.max').onclick = () => api && api.winCtl && api.winCtl('max');
  // maximizada: o Windows não aplica acrílico, então a própria página pinta o fundo
  if (api && api.onWinState) api.onWinState((st) => document.body.classList.toggle('solid', !!(st && st.maximized) || new URLSearchParams(location.search).has('solid')));
  window.addEventListener('blur', () => document.body.classList.add('win-blur'));
  window.addEventListener('focus', () => document.body.classList.remove('win-blur'));
  // clique duplo na faixa de arrasto maximiza, como no Mac
  document.addEventListener('dblclick', (e) => { if (e.target.closest('#drag, #dragzone, .brand')) api && api.winCtl && api.winCtl('max'); });
})();
