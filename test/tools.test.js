// Ferramentas 1.13: parser de tarefa em linguagem natural, bandeja de arquivos e comandos do TI.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseTask, describe } = require('../src/nlp');
const { FileTray, kindOf } = require('../src/files');
const commands = require('../src/commands');

// ---------- linguagem natural ----------
const now = new Date(2026, 8, 3, 10, 0);   // quinta, 03/09/2026 10:00
const p1 = parseTask('amanhã 14h ligar pro Hospital Santa Casa', now);
assert.strictEqual(p1.title, 'Ligar pro Hospital Santa Casa');
assert.strictEqual(p1.due_date, '2026-09-04');
assert.strictEqual(p1.time, '14:00');

const p2 = parseTask('hoje revisar edital !alta 45min', now);
assert.deepStrictEqual([p2.title, p2.due_date, p2.priority, p2.minutes], ['Revisar edital', '2026-09-03', 'high', 45]);

const p3 = parseTask('urgente corrigir bug do login 2h', now);
assert.strictEqual(p3.priority, 'urgent');
assert.strictEqual(p3.minutes, 120, 'sem marca de horário, 2h é duração');
assert.strictEqual(p3.time, null);

const p4 = parseTask('próxima terça reunião com o Daniel às 9:30', now);
assert.strictEqual(p4.due_date, '2026-09-08', 'próxima terça');
assert.strictEqual(p4.time, '09:30');
assert.strictEqual(p4.title, 'Reunião com o Daniel', 'o “às” não sobra no título');

const p5 = parseTask('em 2 semanas auditoria', now);
assert.strictEqual(p5.due_date, '2026-09-17');

const p6 = parseTask('15/10 entregar relatório', now);
assert.strictEqual(p6.due_date, '2026-10-15');
assert.strictEqual(parseTask('01/02 fechar mês', now).due_date, '2027-02-01', 'data já passada vai para o ano seguinte');

const p7 = parseTask('comprar café', now);
assert.deepStrictEqual([p7.title, p7.due_date, p7.priority, p7.minutes], ['Comprar café', null, null, null]);

const p8 = parseTask('às 15h call rápida', now);
assert.strictEqual(p8.due_date, '2026-09-03', 'hora de hoje que ainda não passou');
assert.strictEqual(parseTask('às 8h call', now).due_date, '2026-09-04', 'hora que já passou cai para amanhã');

const p9 = parseTask('sexta 8h30 visita técnica 1h30', now);
assert.deepStrictEqual([p9.due_date, p9.time, p9.minutes], ['2026-09-04', '08:30', 90]);

assert.strictEqual(describe(p2).includes('alta'), true);
assert.strictEqual(parseTask('', now).title, '');
console.log('✓ linguagem natural');

// ---------- bandeja ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snm-tray-'));
const f1 = path.join(dir, 'Edital 2026 – cópia.pdf'); fs.writeFileSync(f1, 'x'.repeat(2048));
const f2 = path.join(dir, 'foto.PNG'); fs.writeFileSync(f2, 'y');
const tray = new FileTray(dir);
assert.strictEqual(kindOf(f1), 'pdf'); assert.strictEqual(kindOf(f2), 'image');
tray.add([f1, f2, path.join(dir, 'nao-existe.txt'), dir]);
assert.strictEqual(tray.list().length, 2, 'só entra arquivo que existe (pasta e sumido ficam de fora)');
tray.add([f1]);
assert.strictEqual(tray.list().length, 2, 'não duplica');
const id = tray.list().find((x) => x.name.startsWith('Edital')).id;
assert.strictEqual(tray.pin(id), true, 'fixa');
tray.clear();
assert.strictEqual(tray.list().length, 1, 'limpar mantém os fixados');
fs.unlinkSync(f1);
assert.strictEqual(tray.list()[0].missing, true, 'marca arquivo que saiu do lugar');
assert.strictEqual(tray.prune().length, 0, 'prune tira o que sumiu');

const tray2 = new FileTray(dir);   // relê do disco
assert.strictEqual(Array.isArray(tray2.list()), true, 'estado sobrevive ao restart');
let erro = null;
tray2.add([f2]);
tray2.upload(tray2.list()[0].id, null).catch((e) => { erro = e.message; }).then(() => {
  assert.ok(/vincule/i.test(erro || ''), 'sem Hub, avisa em vez de quebrar: ' + erro);
  console.log('✓ bandeja de arquivos');

  // ---------- comandos ----------
  const norm = commands.normalize([{ name: 'ok', cmd: 'echo 1' }, { name: '', cmd: 'x' }, { cmd: 'y' }, null]);
  assert.strictEqual(norm.length, 1, 'ignora comando sem nome ou sem cmd');
  assert.strictEqual(norm[0].confirm, false);
  assert.ok(commands.DEFAULTS.length >= 5, 'tem sugestões de fábrica');
  assert.ok(commands.DEFAULTS.every((c) => c.name && c.cmd && c.id), 'sugestões completas');
  assert.ok(commands.DEFAULTS.find((c) => c.id === 'spool').confirm, 'reiniciar spool pede confirmação');

  commands.run([{ id: 'x', name: 'teste', cmd: 'echo oi' }], 'nao-existe').then((r) => {
    assert.strictEqual(r.ok, false);
    assert.ok(/lista salva/.test(r.err), 'só roda o que está salvo: ' + r.err);
    console.log('✓ comandos do TI');
    console.log('ferramentas OK');
  });
});
