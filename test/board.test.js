// Quadro do time de Sistemas: RPCs (board/feed/alerts/take/move/block), evento de histórico → feed + notificação,
// e o texto das cobranças. Supabase falso em memória (nenhuma rede real).
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { HubClient } = require('../src/hub');

const UID = '11111111-1111-4111-8111-111111111111';
const jwt = (exp) => 'h.' + Buffer.from(JSON.stringify({ sub: UID, exp })).toString('base64url') + '.s';
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

const db = {
  cards: [
    { id: 'i1', numero_sequencial: 42, titulo: 'Bug no login', status: 'recebida', trilha: 'bug', responsavel_id: null, bloqueado: false, focus_seconds: 0, created_at: '2026-09-01T10:00:00Z' },
    { id: 'i2', numero_sequencial: 43, titulo: 'Painel novo', status: 'em_desenvolvimento', trilha: 'ideia', responsavel_id: UID, responsavel_nome: 'JP Teste', bloqueado: false, focus_seconds: 1200, created_at: '2026-08-20T10:00:00Z' }
  ],
  calls: []
};
const rpcs = {
  sistemas_board: () => ({
    cards: db.cards,
    columns: [{ status: 'recebida', n: 1 }, { status: 'em_desenvolvimento', n: 1 }],
    people: [{ id: UID, name: 'JP Teste', wip: 1, focusToday: 1800 }],
    now: [{ userId: UID, name: 'JP Teste', title: '#43 Painel novo', taskId: 'i2', seconds: 900 }],
    stats: { total: 2, semDono: 1, novas24h: 1, emDev: 1, bloqueadas: 0, paradas: 1, slaEstourado: 0, entregues7d: 3 }
  }),
  sistemas_feed: () => ([{ id: 'h1', created_at: '2026-09-03T09:00:00Z', acao: 'mudou_status', usuario_id: 'outro', usuario_nome: 'Ana Silva', numero_sequencial: 43, titulo: 'Painel novo', para: { status: 'em_desenvolvimento' } }]),
  sistemas_alerts: (args) => ({ semDono: [{ id: 'i1', n: 42, titulo: 'Bug no login', horas: 30 }], paradas: [{ id: 'i2', n: 43, titulo: 'Painel novo', quem: 'JP Teste', dias: 3 }], bloqueadas: [], sla: [], wip: [], filaNova: 1, _args: args }),
  sistemas_take: (args) => { const c = db.cards.find((x) => x.id === args.p_ideia); c.responsavel_id = UID; if (args.p_start_dev) c.status = 'em_desenvolvimento'; return { ok: true }; },
  sistemas_move: (args) => { const c = db.cards.find((x) => x.id === args.p_ideia); c.status = args.p_status; return { ok: true }; },
  sistemas_assign: (args) => { const c = db.cards.find((x) => x.id === args.p_ideia); c.responsavel_id = args.p_user; db.calls.push(['assign', args]); return { ok: true }; },
  sistemas_card: (args) => ({ card: { ...db.cards.find((x) => x.id === args.p_ideia), descricao: 'desc' }, history: [{ id: 'h', acao: 'assumiu' }], messages: [], people: [{ id: UID, name: 'JP' }] }),
  sistemas_block: (args) => { const c = db.cards.find((x) => x.id === args.p_ideia); c.bloqueado = !!args.p_bloqueado; c.bloqueio_motivo = args.p_motivo; return { ok: true }; },
  focus_log: (args) => { db.calls.push(['focus_log', args]); return 'fs-1'; },
  focus_summary: () => ({ days: [], streak: 2, today: 600, total: 600 }),
  get_user_profile: () => ({ id: UID, email: 'jp@medsystem.eng.br', full_name: 'JP Teste', role: { slug: 'adm-ti', name: 'ADM TI', level: 90 }, sector: { id: 'sec-ti', name: 'TI e Sistemas', slug: 'ti-sistemas' } })
};

const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => body += c);
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/auth/v1/token') return json(res, 200, { access_token: jwt(Math.floor(Date.now() / 1000) + 3600), refresh_token: 'rt', expires_in: 3600, user: { id: UID, email: 'jp@medsystem.eng.br' } });
    const m = /^\/rest\/v1\/rpc\/(.+)$/.exec(u.pathname);
    if (m && rpcs[m[1]]) { db.calls.push([m[1], JSON.parse(body || '{}')]); return json(res, 200, rpcs[m[1]](JSON.parse(body || '{}'))); }
    if (u.pathname === '/rest/v1/modules') return json(res, 200, [{ id: 'm1', slug: 'sistemas' }, { id: 'm2', slug: 'tarefas' }]);
    if (u.pathname === '/rest/v1/sector_module_access') return json(res, 200, [{ module_id: 'm1', is_enabled: true }, { module_id: 'm2', is_enabled: true }]);
    if (u.pathname === '/rest/v1/user_module_access') return json(res, 200, []);
    if (u.pathname === '/rest/v1/notificacoes') return json(res, 200, []);
    if (u.pathname === '/rest/v1/tasks' || u.pathname === '/rest/v1/at_os_tarefa') return json(res, 200, []);
    if (/agenda|whatsapp/.test(u.pathname)) return json(res, 200, []);
    json(res, 404, { message: 'not found ' + u.pathname });
  });
});

server.listen(0, async () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snm-board-'));
  const hub = new HubClient({ dir, secret: null, WebSocket: null, url, anon: 'anon-test', site: 'http://site' });
  try {
    await hub.login('jp@medsystem.eng.br', 'segredo');
    assert.strictEqual(hub.hasBoard(), true, 'módulo sistemas libera o quadro');

    // ---- resumo ----
    const b = await hub.loadBoard();
    assert.strictEqual(b.cards.length, 2, 'cartões');
    assert.strictEqual(b.stats.semDono, 1, 'stats sem dono');
    assert.strictEqual(b.people[0].wip, 1, 'wip por pessoa');
    assert.strictEqual(b.now[0].taskId, 'i2', 'quem está focando agora');

    // ---- feed e travas ----
    const feed = await hub.loadBoardFeed(20);
    assert.strictEqual(feed[0].usuario_nome, 'Ana Silva', 'feed do time');
    const a = await hub.loadBoardAlerts({ semDonoHoras: 12, paradoDias: 1, wip: 3 });
    assert.strictEqual(a.paradas[0].dias, 3, 'paradas');
    const argsAlert = db.calls.filter(([n]) => n === 'sistemas_alerts').pop()[1];
    assert.deepStrictEqual([argsAlert.p_sem_dono_horas, argsAlert.p_parado_dias, argsAlert.p_wip], [12, 1, 3], 'passa os limites configurados');

    // ---- ações ----
    await hub.boardTake('i1', true);
    assert.strictEqual(db.cards[0].responsavel_id, UID, 'assumiu');
    assert.strictEqual(db.cards[0].status, 'em_desenvolvimento', 'foi para em dev');
    await hub.boardMove('i1', 'entregue', 'pronto');
    assert.strictEqual(db.cards[0].status, 'entregue', 'moveu');
    await hub.boardAssign('i2', 'outro-uid', false);
    assert.strictEqual(db.cards[1].responsavel_id, 'outro-uid', 'atribuiu a outra pessoa');
    const card = await hub.boardCard('i2');
    assert.strictEqual(card.card.descricao, 'desc', 'detalhes do cartão'); assert.strictEqual(card.people.length, 1);
    await hub.boardBlock('i2', true, 'aguardando cliente');
    assert.strictEqual(db.cards[1].bloqueado, true, 'bloqueou');
    assert.strictEqual(db.cards[1].bloqueio_motivo, 'aguardando cliente', 'motivo gravado');

    // ---- evento de outra pessoa vira notificação; o meu, não ----
    const eventos = [];
    hub.on('board', (ev) => eventos.push(ev));
    hub._onBoardEvent({ id: 'h2', ideia_id: 'i2', usuario_id: 'outro', usuario_nome: 'Ana Silva', acao: 'mudou_status', para: { status: 'entregue' }, created_at: new Date().toISOString() });
    hub._onBoardEvent({ id: 'h3', ideia_id: 'i2', usuario_id: UID, usuario_nome: 'JP Teste', acao: 'comentou', created_at: new Date().toISOString() });
    assert.strictEqual(eventos.length, 1, 'só avisa o que não é meu');
    assert.strictEqual(eventos[0].quem, 'Ana Silva');
    assert.strictEqual(hub.boardFeed.length >= 2, true, 'os dois entram no feed');
    assert.strictEqual(hub.boardFeed[0].mine, true, 'marca o próprio evento');

    // ---- foco em cartão do quadro grava com kind ideia ----
    await hub.logFocus({ taskId: 'i2', kind: 'ideia', seconds: 900, planned: 1500, completed: false, startedAt: Date.now() - 900000, title: '#43' });
    const fl = db.calls.filter(([n]) => n === 'focus_log').pop()[1];
    assert.strictEqual(fl.p_task_kind, 'ideia', 'kind ideia');
    assert.strictEqual(fl.p_task_id, 'i2');

    // ---- state() expõe o quadro para os renderers ----
    const st = hub.state();
    assert.strictEqual(st.hasBoard, true);
    assert.strictEqual(st.board.stats.emDev, 1);
    assert.ok(st.boardFeed.length, 'feed no state');
    assert.strictEqual(st.profile.id, UID, 'id do usuário no state (o quadro marca "meus")');

    // ---- sem o módulo, nada de quadro ----
    hub.profile.modules = ['tarefas'];
    assert.strictEqual(hub.hasBoard(), false);
    assert.strictEqual(await hub.loadBoard(), null, 'não consulta o quadro sem módulo');

    console.log('quadro OK');
    hub.stop(); server.close();   // sai sozinho quando os handles fecham (process.exit aqui gera assert do libuv no Windows)
  } catch (e) { console.error(e); hub.stop(); server.close(); process.exitCode = 1; }
});
