// Brilho especular do vidro: escreve a posição do mouse (em %) na superfície sob o cursor.
// Um rAF por movimento — sem custo perceptível mesmo com muitos painéis.
(function () {
  const SEL = '.glass, .g-panel';
  let raf = null, last = null;
  function paint(e) {
    raf = null;
    const el = e.target && e.target.closest ? e.target.closest(SEL) : null;
    if (last && last !== el) last.style.removeProperty('--gx'), last.style.removeProperty('--gy');
    if (!el) { last = null; return; }
    const r = el.getBoundingClientRect();
    el.style.setProperty('--gx', (((e.clientX - r.left) / r.width) * 100).toFixed(1) + '%');
    el.style.setProperty('--gy', (((e.clientY - r.top) / r.height) * 100).toFixed(1) + '%');
    last = el;
  }
  document.addEventListener('pointermove', (e) => { if (raf) return; raf = requestAnimationFrame(() => paint(e)); }, { passive: true });
  document.addEventListener('pointerleave', () => { if (last) { last.style.removeProperty('--gx'); last.style.removeProperty('--gy'); last = null; } });
  // sem acrílico do sistema (query ?solid=1): o corpo pinta o próprio fundo
  if (new URLSearchParams(location.search).get('solid')) document.body.classList.add('solid');
})();
