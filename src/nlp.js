// Tarefa em linguagem natural (pt-BR): "amanhã 14h ligar pro hospital !alta 30min" →
// { title: 'ligar pro hospital', due_date: '2026-09-04', time: '14:00', priority: 'high', minutes: 30 }
// Sem dependências e sem IA: regras simples, previsíveis, e o que não casar continua no título.

const DIAS = { domingo: 0, segunda: 1, terca: 2, 'terça': 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6, 'sábado': 6 };
const MESES = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
const PRI = [
  [/\b(urgent[ei]|urgência|urgencia|agora|imediat[oa])\b|!!/i, 'urgent'],
  [/\b(alta|importante|prioridade alta)\b|!alta|!a\b/i, 'high'],
  [/\b(baixa|quando der|sem pressa)\b|!baixa|!b\b/i, 'low']
];

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function parseTask(input, now = new Date()) {
  const raw = String(input || '');
  let s = ' ' + raw + ' ';
  const out = { title: '', due_date: null, time: null, priority: null, minutes: null, matched: [] };
  const eat = (re, fn) => {
    const m = re.exec(s); if (!m) return false;
    if (fn) fn(m);
    out.matched.push(m[0].trim());
    s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    return true;
  };
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const set = (d) => { out.due_date = ymd(d); };

  // ---- prioridade ----
  for (const [re, p] of PRI) if (!out.priority && eat(re, () => { out.priority = p; })) break;

  // ---- duração em minutos (sempre explícita) ----
  eat(/(?:^|\s)~?(\d{1,3})\s*(?:min|minutos?|mins)\b/i, (m) => { out.minutes = Number(m[1]); });
  if (out.minutes == null) eat(/(?:^|\s)~?(\d{1,2})(?:[.,](\d))?\s*horas?\b/i, (m) => { out.minutes = Number(m[1]) * 60 + (m[2] ? Number(m[2]) * 6 : 0); });

  // ---- data ----
  eat(/(?:^|\s)depois de amanh[ãa](?=\s|$|[,.;!?])/i, () => { const d = new Date(base); d.setDate(d.getDate() + 2); set(d); });
  if (!out.due_date) eat(/(?:^|\s)hoje(?=\s|$|[,.;!?])/i, () => set(base));
  if (!out.due_date) eat(/(?:^|\s)amanh[ãa](?=\s|$|[,.;!?])/i, () => { const d = new Date(base); d.setDate(d.getDate() + 1); set(d); });
  if (!out.due_date) eat(/\bem\s+(\d{1,3})\s*(dias?|semanas?|m[êe]s(?:es)?)\b/i, (m) => {
    const n = Number(m[1]); const d = new Date(base);
    if (/semana/i.test(m[2])) d.setDate(d.getDate() + n * 7);
    else if (/m[êe]s/i.test(m[2])) d.setMonth(d.getMonth() + n);
    else d.setDate(d.getDate() + n);
    set(d);
  });
  if (!out.due_date) eat(/(?:^|\s)(?:pr[óo]xim[ao]\s+)?(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)(?:-feira)?(?=\s|$|[,.;!?])/i, (m) => {
    const alvo = DIAS[m[1].toLowerCase()] ?? DIAS[m[1].toLowerCase().replace('á', 'a').replace('ç', 'c')];
    if (alvo == null) return;
    const d = new Date(base); const delta = (alvo - d.getDay() + 7) % 7 || 7;   // sempre o próximo
    d.setDate(d.getDate() + delta); set(d);
  });
  if (!out.due_date) eat(/\b(\d{1,2})[/\-](\d{1,2})(?:[/\-](\d{2,4}))?\b/, (m) => {
    const dia = Number(m[1]), mes = Number(m[2]) - 1;
    let ano = m[3] ? Number(m[3]) : now.getFullYear(); if (ano < 100) ano += 2000;
    const d = new Date(ano, mes, dia);
    if (!m[3] && d < base) d.setFullYear(ano + 1);
    if (!isNaN(d)) set(d);
  });
  if (!out.due_date) eat(/\b(?:dia\s+)?(\d{1,2})\s+de\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\b/i, (m) => {
    const d = new Date(now.getFullYear(), MESES[m[2].toLowerCase()], Number(m[1]));
    if (d < base) d.setFullYear(d.getFullYear() + 1);
    set(d);
  });

  // ---- hora ----
  // "9:30", "14h30", "às 14h". Um "2h" solto só vira hora quando a frase fala de quando (às, hoje, amanhã, dia da semana…);
  // caso contrário é duração ("corrigir o bug 2h").
  const falaDeQuando = /(?:^|\s)[àa]s\s|hoje|amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|\d{1,2}[/\-]\d{1,2}|\bdia\s+\d/i.test(raw);
  eat(/(?:^|\s)(?:[àa]s\s+)?([01]?\d|2[0-3])(?::|h)([0-5]\d)\b/i, (m) => { out.time = `${pad(m[1])}:${m[2]}`; });
  if (!out.time && (falaDeQuando || out.minutes != null)) eat(/(?:^|\s)(?:[àa]s\s+)?([01]?\d|2[0-3])\s*h\b(?!\w)/i, (m) => { out.time = `${pad(m[1])}:00`; });
  if (out.minutes == null) eat(/(?:^|\s)~?(\d{1,2})\s*h\s?([0-5]\d)(?=\s|$|[,.;!?])/i, (m) => { out.minutes = Number(m[1]) * 60 + Number(m[2]); });
  if (out.time == null && out.minutes == null) eat(/(?:^|\s)~?(\d{1,2})\s*h(?=\s|$|[,.;!?])/i, (m) => { out.minutes = Number(m[1]) * 60; });
  if (out.time && !out.due_date) {                       // "às 15h" sozinho = hoje (ou amanhã, se já passou)
    const [hh, mm] = out.time.split(':').map(Number);
    const d = new Date(base); d.setHours(hh, mm, 0, 0);
    if (d < now) d.setDate(d.getDate() + 1);
    set(d);
  }

  // ---- limpeza do título ----
  out.title = s.replace(/\s+/g, ' ')
    .replace(/^[\s,;.\-–—]+|[\s,;.\-–—]+$/g, '')
    .replace(/(?:^|\s)(?:[àa]s|para|pra|pro|no dia|na|em|de)\s*$/i, '')
    .replace(/^(?:[àa]s|de|em|no dia)\s+/i, '')
    .trim();
  if (out.title) out.title = cap(out.title);
  return out;
}

// texto curto do que foi entendido, para a prévia da interface
function describe(p) {
  const bits = [];
  if (p.due_date) {
    const d = new Date(p.due_date + 'T12:00');
    const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
    const dif = Math.round((d - hoje) / 86400000);
    bits.push(dif === 0 ? 'hoje' : dif === 1 ? 'amanhã' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', ''));
  }
  if (p.time) bits.push(p.time);
  if (p.priority) bits.push({ urgent: 'crítica', high: 'alta', low: 'baixa' }[p.priority]);
  if (p.minutes) bits.push(p.minutes >= 60 ? `${(p.minutes / 60).toFixed(p.minutes % 60 ? 1 : 0)} h` : `${p.minutes} min`);
  return bits.join(' · ');
}

module.exports = { parseTask, describe };
