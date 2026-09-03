// Anotações em coordenadas normalizadas 0–1 (dados, não pixels). Formas: arrow, rect, blur, text.
// render(ctx, shapes, W, H, img) desenha sobre um canvas de W×H; a espessura escala com a largura (W/200 × 3).
(function (g) {
  const RED = '#FF3B30';
  function lw(W) { return Math.max(1.5, (W / 200) * 3); }
  function render(ctx, shapes, W, H, img, selIdx = -1) {
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i]; const x1 = s.x1 * W, y1 = s.y1 * H, x2 = s.x2 * W, y2 = s.y2 * H;
      ctx.save(); ctx.lineWidth = lw(W); ctx.strokeStyle = s.color || RED; ctx.fillStyle = s.color || RED; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (s.type === 'rect') { ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); }
      else if (s.type === 'arrow') {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        const a = Math.atan2(y2 - y1, x2 - x1), h = lw(W) * 4.5;
        ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - h * Math.cos(a - 0.45), y2 - h * Math.sin(a - 0.45)); ctx.lineTo(x2 - h * Math.cos(a + 0.45), y2 - h * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill();
      } else if (s.type === 'blur' && img) {
        const rx = Math.min(x1, x2), ry = Math.min(y1, y2), rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
        if (rw > 2 && rh > 2) {
          // pixelização: reduz e amplia sem suavização
          const px = Math.max(6, Math.round(W / 60)); const off = document.createElement('canvas'); off.width = Math.max(1, Math.round(rw / px)); off.height = Math.max(1, Math.round(rh / px));
          const o = off.getContext('2d'); o.imageSmoothingEnabled = true; o.drawImage(img, rx * (img.width / W), ry * (img.height / H), rw * (img.width / W), rh * (img.height / H), 0, 0, off.width, off.height);
          ctx.imageSmoothingEnabled = false; ctx.drawImage(off, 0, 0, off.width, off.height, rx, ry, rw, rh); ctx.imageSmoothingEnabled = true;
        }
      } else if (s.type === 'text') {
        const fs = Math.max(12, (W / 200) * 9 * (s.size || 1)); ctx.font = `600 ${fs}px "Instrument Sans", "Segoe UI", sans-serif`; ctx.textBaseline = 'top';
        const lines = String(s.text || '').split('\n'); const pad = fs * 0.35;
        const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)); ctx.fillStyle = 'rgba(10,11,12,.72)'; roundRect(ctx, x1 - pad, y1 - pad, tw + pad * 2, lines.length * fs * 1.25 + pad * 2, fs * 0.4); ctx.fill();
        ctx.fillStyle = s.color || RED; lines.forEach((l, k) => ctx.fillText(l, x1, y1 + k * fs * 1.25));
      }
      if (i === selIdx) { ctx.setLineDash([4, 4]); ctx.strokeStyle = '#0A84FF'; ctx.lineWidth = 1; ctx.strokeRect(Math.min(x1, x2) - 4, Math.min(y1, y2) - 4, Math.abs(x2 - x1) + 8, Math.abs(y2 - y1) + 8); }
      ctx.restore();
    }
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function hit(shapes, nx, ny, tol = 0.02) {
    for (let i = shapes.length - 1; i >= 0; i--) { const s = shapes[i]; const x1 = Math.min(s.x1, s.x2) - tol, x2 = Math.max(s.x1, s.x2) + tol, y1 = Math.min(s.y1, s.y2) - tol, y2 = Math.max(s.y1, s.y2) + tol; if (nx >= x1 && nx <= x2 && ny >= y1 && ny <= y2) return i; }
    return -1;
  }
  // rasteriza a imagem + formas num PNG data URL (tamanho original)
  function rasterize(img, shapes) { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); render(ctx, shapes, c.width, c.height, img); return c.toDataURL('image/png'); }
  g.Annotations = { render, hit, rasterize, RED, lw };
})(window);
