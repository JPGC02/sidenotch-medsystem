// O popup nativo do <select> não desenha direito em janela transparente/acrílica do Windows —
// e às vezes prende o mouse ao fechar. Este script troca cada <select> por um menu em HTML,
// mantendo o elemento original escondido (o código existente continua lendo .value e ouvindo 'change').
(function () {
  const CSS = `
    .selx { position: relative; display: inline-flex; }
    .selx > select { position: absolute; inset: 0; opacity: 0; pointer-events: none; width: 100%; height: 100%; }
    .selx > .cur { display: flex; align-items: center; gap: 8px; justify-content: space-between; width: 100%; min-height: 32px;
      background: rgba(0,0,0,.28); color: inherit; border: 1px solid rgba(255,255,255,.16); border-radius: 10px; padding: 6px 10px;
      font: inherit; font-size: 12.5px; cursor: pointer; box-shadow: inset 0 1px 2px rgba(0,0,0,.3); text-align: left; }
    .selx > .cur:hover { background: rgba(0,0,0,.34); border-color: rgba(255,255,255,.24); }
    .selx > .cur span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .selx > .cur i { font-style: normal; opacity: .55; font-size: 11px; margin-top: -1px; }
    .selx.open > .cur { border-color: rgba(120,160,255,.6); }
    .selx-menu { position: fixed; z-index: 999; min-width: 160px; max-height: 280px; overflow: auto;
      background: rgba(22,22,28,.99); border: 1px solid rgba(255,255,255,.14); border-radius: 12px; padding: 4px;
      box-shadow: 0 20px 46px rgba(0,0,0,.6); }
    .selx-menu div { padding: 7px 11px; border-radius: 8px; font-size: 12.5px; cursor: pointer; white-space: nowrap; color: #f0f0f3; }
    .selx-menu div:hover { background: rgba(255,255,255,.1); }
    .selx-menu div.on { background: #0a84ff; color: #fff; }
    .selx select:disabled ~ .cur { opacity: .5; cursor: default; }
  `;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  let openMenu = null;
  const closeAll = () => { if (openMenu) { openMenu.menu.remove(); openMenu.box.classList.remove('open'); openMenu = null; } };
  document.addEventListener('click', closeAll);
  window.addEventListener('blur', closeAll);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

  function wrap(sel) {
    if (sel.dataset.selx || sel.closest('.pick')) return;
    sel.dataset.selx = '1';
    const box = document.createElement('span'); box.className = 'selx';
    if (sel.style.width) box.style.width = sel.style.width;
    sel.parentNode.insertBefore(box, sel); box.appendChild(sel);
    const cur = document.createElement('button'); cur.type = 'button'; cur.className = 'cur';
    cur.innerHTML = '<span></span><i>⌄</i>';
    box.appendChild(cur);
    const paint = () => { const o = sel.selectedOptions[0]; cur.querySelector('span').textContent = o ? o.textContent : ''; };
    paint();
    sel.addEventListener('change', paint);
    // o código da página pode trocar as opções: repinta quando isso acontece
    new MutationObserver(paint).observe(sel, { childList: true, subtree: true });

    cur.onclick = (e) => {
      e.stopPropagation();
      if (sel.disabled) return;
      const abrindo = !openMenu || openMenu.box !== box;
      closeAll();
      if (!abrindo) return;
      const menu = document.createElement('div'); menu.className = 'selx-menu';
      menu.innerHTML = [...sel.options].map((o, i) => `<div data-i="${i}" class="${o.selected ? 'on' : ''}">${o.textContent.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</div>`).join('');
      const r = cur.getBoundingClientRect();
      menu.style.minWidth = Math.max(160, r.width) + 'px';
      menu.style.visibility = 'hidden';
      document.body.appendChild(menu);
      const alt = menu.offsetHeight, larg = menu.offsetWidth;      // mede já com o estilo aplicado
      menu.style.left = Math.max(8, Math.min(r.left, innerWidth - larg - 8)) + 'px';
      const abaixo = r.bottom + 6 + alt < innerHeight;
      menu.style.top = (abaixo ? r.bottom + 6 : Math.max(8, r.top - alt - 6)) + 'px';
      menu.style.visibility = '';
      box.classList.add('open');
      openMenu = { box, menu };
      menu.onclick = (ev) => {
        const d = ev.target.closest('[data-i]'); if (!d) return;
        ev.stopPropagation();
        sel.selectedIndex = Number(d.dataset.i);
        paint(); closeAll();
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      };
    };
  }
  const scan = () => document.querySelectorAll('select:not([data-selx])').forEach(wrap);
  scan();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
})();
