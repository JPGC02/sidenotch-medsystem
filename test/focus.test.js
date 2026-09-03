// Foco (pomodoro): contagem, pausa/retomada, gravação no Hub (fila offline), streak e conclusão da tarefa.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Focus } = require('../src/focus');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snm-focus-'));
const logged = [];
let statusCalls = [];
const hub = {
  linked: () => true,
  logFocus: async (s) => { logged.push(s); return 'id'; },
  focusSummary: async () => ({ days: [{ day: '2026-09-01', seconds: 3000 }, { day: '2026-09-03', seconds: 1500 }], streak: 3, today: 1500, total: 4500 }),
  setTaskStatus: async (id, st) => { statusCalls.push([id, st]); }
};
const settings = { focus: { minutes: 25, breakMinutes: 5, autoStatus: true, chime: false } };
const notes = [];
const f = new Focus({ userData: dir, hub, getSettings: () => settings, notify: (n) => notes.push(n) });

// ---- ciclo simples ----
let st = f.start({ id: 'task-1', title: 'Fazer laudo' });
assert.strictEqual(st.active, true, 'ativo');
assert.strictEqual(st.running, true, 'rodando');
assert.strictEqual(st.planned, 1500, 'ciclo de 25 min');
assert.deepStrictEqual(statusCalls, [['task-1', 'in_progress']], 'marca em andamento no Hub');

// simula 10 minutos: mexe no relógio interno (lastAt) em vez de esperar
f.cur.lastAt -= 600 * 1000;
st = f.pause();
assert.ok(st.elapsed >= 600 && st.elapsed < 601, 'contou 10 min: ' + st.elapsed);
assert.strictEqual(st.running, false, 'pausado');
const paused = f.state().elapsed;
st = f.state();
assert.strictEqual(st.elapsed, paused, 'pausado não avança');

st = f.resume();
assert.strictEqual(st.running, true, 'retomado');
f.cur.lastAt -= 30 * 1000;

// ---- encerrar grava no Hub e soma na tarefa ----
(async () => {
  f.stop('user');
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(logged.length, 1, 'gravou uma sessão');
  assert.strictEqual(logged[0].taskId, 'task-1');
  assert.ok(logged[0].seconds >= 630, 'somou o tempo dos dois trechos: ' + logged[0].seconds);
  assert.strictEqual(logged[0].completed, false, 'não completou o ciclo');
  assert.strictEqual(f.state().active, false, 'sem ciclo ativo');

  // ---- streak vem do resumo ----
  await f.refresh();
  assert.strictEqual(f.state().streak, 3, 'streak do Supabase');
  assert.strictEqual(f.state().days.length, 2, 'dias do heatmap');

  // ---- fila offline: sem Hub o tempo fica em disco e sai na próxima sincronização ----
  const off = new Focus({ userData: dir, hub: { linked: () => false }, getSettings: () => settings, notify: () => {} });
  off.start({ id: 'task-2', title: 'Sem rede' });
  off.cur.lastAt -= 120 * 1000;
  off.stop('user');
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(off.state().pending, 1, 'ficou pendente');
  assert.ok(fs.existsSync(path.join(dir, 'focus.json')), 'salvou em disco');
  off.hubRef(hub);
  await off.flush();
  assert.strictEqual(off.state().pending, 0, 'sincronizou depois');
  assert.strictEqual(logged.length, 2, 'segunda sessão gravada');

  // ---- trocar de tarefa fecha a anterior ----
  logged.length = 0;
  f.start({ id: 'task-3', title: 'A' });
  f.cur.lastAt -= 60 * 1000;
  f.start({ id: 'task-4', title: 'B' });
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(logged.length, 1, 'gravou a tarefa anterior ao trocar');
  assert.strictEqual(logged[0].taskId, 'task-3');
  assert.strictEqual(f.state().taskId, 'task-4', 'ciclo passou para a nova tarefa');

  // ---- ciclo cumprido avisa e marca completed ----
  logged.length = 0; notes.length = 0;
  f.cur.planned = 60; f.cur.lastAt -= 61 * 1000;
  await new Promise((r) => setTimeout(r, 1100));   // deixa um tick rodar
  assert.strictEqual(f.state().active, false, 'ciclo encerrou sozinho');
  assert.strictEqual(logged[0].completed, true, 'gravou como concluído');
  assert.strictEqual(notes.length, 1, 'avisou o fim do ciclo');

  // ---- concluir tarefa encerra o foco e fecha no Hub ----
  statusCalls = [];
  f.start({ id: 'task-5', title: 'Concluir' });
  f.cur.lastAt -= 30 * 1000;
  await f.complete('task-5');
  assert.ok(statusCalls.some(([id, stt]) => id === 'task-5' && stt === 'completed'), 'fechou a tarefa no Hub');
  assert.strictEqual(f.state().active, false, 'ciclo encerrado ao concluir');

  // ---- toggle: mesma tarefa pausa/retoma, outra troca ----
  f.start({ id: 'task-6', title: 'T' });
  assert.strictEqual(f.toggle({ id: 'task-6' }).running, false, 'toggle pausa a mesma tarefa');
  assert.strictEqual(f.toggle({ id: 'task-6' }).running, true, 'toggle retoma');
  assert.strictEqual(f.toggle({ id: 'task-7', title: 'U' }).taskId, 'task-7', 'toggle em outra tarefa troca');
  f.dispose();

  console.log('foco OK');
})().catch((e) => { console.error(e); process.exit(1); });
