// Pausa do café: dois cronômetros ao mesmo tempo, aviso único ao estourar o limite (sem parar de contar),
// registro no Hub ao encerrar e fila local quando não há rede.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Coffee } = require('../src/coffee');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snm-cof-'));
const avisos = [];
const gravadas = [];
let online = false;
const hub = {
  linked: () => online,
  coffeeLog: async (b) => { if (!online) throw new Error('offline'); gravadas.push(b); return 'id'; },
  coffeeSummary: async () => ({ people: [{ pessoa: 'Marina', hoje: 900, hojeN: 1, media: 900, semana: 1800, excedeu: 1 }], last: [{ pessoa: 'Marina', seconds: 900, excedeu: 0, at: '2026-09-04T12:00:00Z' }] })
};
const cfg = { coffee: { people: ['Marina', 'Julia'], minutes: 15, alert: true } };
const c = new Coffee({ userData: dir, hub, getSettings: () => cfg, notify: (n) => avisos.push(n) });

(async () => {
  // ---- estado inicial: as duas aparecem, ninguém correndo ----
  let st = c.state();
  assert.deepStrictEqual(st.people.map((p) => p.nome), ['Marina', 'Julia'], 'as duas pessoas do controle');
  assert.strictEqual(st.people[0].running, false);
  assert.strictEqual(st.limite, 900, 'limite de 15 min em segundos');

  // ---- dois timers ao mesmo tempo, cada um com seu horário ----
  c.start('Marina');
  await new Promise((r) => setTimeout(r, 20));
  c.start('Julia');
  st = c.state();
  assert.strictEqual(st.people.filter((p) => p.running).length, 2, 'dois controles simultâneos');
  assert.ok(st.people[0].startedAt <= st.people[1].startedAt, 'horários independentes');
  assert.strictEqual(c.start('Marina').people[0].running, true, 'começar de novo não reinicia quem já saiu');

  // ---- estourou o limite: avisa uma vez e continua contando ----
  c.running.Marina.startedAt = Date.now() - 1000 * 1000;      // 16min40 de pausa, limite 15min
  await new Promise((r) => setTimeout(r, 1100));
  st = c.state();
  const marina = st.people.find((p) => p.nome === 'Marina');
  assert.ok(marina.over >= 100, 'segue contando o excedente');
  assert.strictEqual(marina.remaining, 0, 'restante zerado');
  assert.strictEqual(marina.progress, 1, 'trilho cheio');
  assert.strictEqual(avisos.length, 1, 'avisa uma única vez');
  assert.ok(/Marina/.test(avisos[0].title) && /15 min/.test(avisos[0].title), 'aviso diz quem e o limite');
  await new Promise((r) => setTimeout(r, 1100));
  assert.strictEqual(avisos.length, 1, 'não repete o aviso a cada segundo');

  // ---- sem rede: encerra e a pausa fica na fila ----
  c.stop('Marina');
  assert.strictEqual(c.state().people.find((p) => p.nome === 'Marina').running, false, 'encerrou');
  assert.strictEqual(gravadas.length, 0, 'nada gravado offline');
  assert.strictEqual(c.state().pending, 1, 'ficou na fila');
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'coffee.json'), 'utf8')).pending.length, 'fila sobrevive ao arquivo');

  // ---- voltou a rede: sobe a fila e traz o resumo ----
  online = true;
  await c.flush();
  assert.strictEqual(gravadas.length, 1, 'gravou ao voltar a rede');
  assert.strictEqual(gravadas[0].pessoa, 'Marina');
  assert.ok(gravadas[0].seconds >= 1000, 'duração real, incluindo o excedente');
  assert.strictEqual(gravadas[0].limite, 900);
  assert.strictEqual(c.state().pending, 0, 'fila vazia');
  const resumo = c.state().people.find((p) => p.nome === 'Marina');
  assert.strictEqual(resumo.hoje, 900, 'totais do resumo entram no state');
  assert.strictEqual(c.state().last.length, 1, 'últimas pausas');

  // ---- descartar não registra ----
  c.cancel('Julia');
  assert.strictEqual(gravadas.length, 1, 'descarte não vira registro');
  assert.strictEqual(c.state().people.every((p) => !p.running), true, 'ninguém correndo');

  // ---- pausa de 2 segundos não é ruído, mas 1 s é descartada ----
  c.start('Julia'); c.running.Julia.startedAt = Date.now() - 1000; c.stop('Julia');
  assert.strictEqual(gravadas.length, 1, 'pausa de menos de 5 s não é gravada');

  // ---- mudar a lista nas configurações muda o controle ----
  cfg.coffee = { people: ['Ana'], minutes: 5, alert: false };
  st = c.state();
  assert.deepStrictEqual(st.people.map((p) => p.nome), ['Ana'], 'segue as configurações');
  assert.strictEqual(st.limite, 300, 'novo limite');

  c.dispose();
  console.log('pausa do café OK');
})().catch((e) => { console.error(e); c.dispose(); process.exitCode = 1; });

// ---- o mouse não pode ficar preso: só a pastilha recebe o cursor ----
const { decideIgnore } = require('../src/hotrect');
const janela = { x: 0, y: 0, width: 960, height: 560 };     // a janela do notch é quase toda transparente
const hot = { x: 360, y: 0, w: 240, h: 30 };                 // a pastilha de verdade
assert.strictEqual(decideIgnore({ x: 480, y: 15 }, janela, hot), false, 'em cima da pastilha: recebe o mouse');
assert.strictEqual(decideIgnore({ x: 100, y: 300 }, janela, hot), true, 'na área transparente: deixa passar (era aqui que travava)');
assert.strictEqual(decideIgnore({ x: 480, y: 500 }, janela, hot), true, 'abaixo da pastilha: deixa passar');
assert.strictEqual(decideIgnore({ x: 480, y: 36 }, janela, hot), null, 'na folga da borda: não fica alternando');
assert.strictEqual(decideIgnore({ x: 480, y: 15 }, janela, null), null, 'sem retângulo ainda, dentro da janela: não mexe');
assert.strictEqual(decideIgnore({ x: 1500, y: 800 }, janela, null), true, 'sem retângulo, fora da janela: deixa passar');
assert.strictEqual(decideIgnore({ x: 1290, y: 15 }, { x: 800, y: 0, width: 960, height: 560 }, hot), false, 'a conta segue a janela em outro monitor');
console.log('retângulo da pastilha OK');
