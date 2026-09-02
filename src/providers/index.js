const providers = {
  claude: require('./claude'),
  codex: require('./codex'),
  cursor: require('./cursor'),
  gemini: require('./gemini'),
  antigravity: require('./antigravity'),
  openrouter: require('./openrouter'),
  nvidia: require('./nvidia'),
  opencode: require('./opencode')
};

// Estado por provedor: último resultado bom, próximo horário permitido e contagem de 429s
const state = {};
const MIN_INTERVAL_MS = 60 * 1000;          // mesmo clicando no anel, não consulta o mesmo provedor 2x em 1 min
const MIN_INTERVAL_BY = { claude: 5 * 60 * 1000 };   // o endpoint do Claude limita por token: 1 consulta a cada 5 min já basta
const minInterval = (id) => MIN_INTERVAL_BY[id] || MIN_INTERVAL_MS;
// último valor bom por provedor persistido em disco: após reiniciar, um 429 na 1ª consulta não apaga o anel
const fs = require('fs'); const path = require('path');
let cacheFile = null;
function setCacheDir(dir) {
  cacheFile = path.join(dir, 'usage-cache.json');
  try { const j = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); for (const [id, last] of Object.entries(j)) state[id] = { last, nextAt: 0, fails: 0 }; } catch { /* sem cache */ }
}
function saveCache() { if (!cacheFile) return; try { const out = {}; for (const [id, st] of Object.entries(state)) if (st.last) out[id] = st.last; fs.writeFileSync(cacheFile, JSON.stringify(out)); } catch { /* ignore */ } }
const BACKOFF_BASE_MS = 3 * 60 * 1000;      // 429: 3 → 6 → 12 → 15 min (máx.)
const BACKOFF_MAX_MS = 15 * 60 * 1000;

function withStale(r, last, note) {
  // mantém o último valor bom visível, marcando que está desatualizado
  if (!last) return r;
  return { ...last, stale: true, staleReason: note || r.error, staleHint: r.hint || null, nextTryAt: state[r.id].nextAt ? new Date(state[r.id].nextAt).toISOString() : null };
}

async function fetchOne(id, settings, force) {
  const p = providers[id];
  const st = state[id] || (state[id] = { last: null, nextAt: 0, fails: 0 });
  const now = Date.now();
  if (now < st.nextAt && !(force && st.fails === 0)) {
    const r = st.last ? { ...st.last, stale: true, staleReason: st.fails ? 'aguardando limite de requisições' : 'cache', nextTryAt: new Date(st.nextAt).toISOString() } : st.lastFail;
    if (r) return r;
  }
  let r;
  try { r = await p.fetchUsage(settings.providers[id]); }
  catch (e) { r = { id, name: p.name, ok: false, error: String(e), updatedAt: new Date().toISOString() }; }
  if (r.ok) {
    st.last = r; st.fails = 0; st.nextAt = now + minInterval(id); saveCache();
    return r;
  }
  st.lastFail = r;
  if (r.status === 429) {
    st.fails++;
    const wait = r.retryAfter ? r.retryAfter * 1000 : Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (st.fails - 1));
    st.nextAt = now + wait;
    return withStale(r, st.last, `limite de requisições (429) — nova tentativa em ${Math.round(wait / 60000)} min`);
  }
  st.nextAt = now + minInterval(id);
  return withStale(r, st.last);
}

// Busca todos os provedores habilitados em paralelo; nunca lança
async function fetchAll(settings, { force = false } = {}) {
  const order = settings.order || Object.keys(providers);
  const ids = order.filter((id) => providers[id] && settings.providers[id] && settings.providers[id].enabled);
  return Promise.all(ids.map((id) => fetchOne(id, settings, force)));
}

function resetCache() { for (const k of Object.keys(state)) { state[k].nextAt = 0; state[k].fails = 0; } }   // mantém o último valor bom; só libera nova consulta

module.exports = { providers, fetchAll, resetCache, setCacheDir };
