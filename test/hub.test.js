// Cliente do Medsystem Hub contra um Supabase falso (Auth + PostgREST + Realtime/Phoenix por WebSocket).
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const { HubClient, SHORTCUTS } = require('../src/hub');

const UID = '11111111-2222-3333-4444-555555555555';
const jwt = (exp) => 'h.' + Buffer.from(JSON.stringify({ sub: UID, exp })).toString('base64url') + '.s';
const log = [];
const db = {
  notificacoes: [
    { id: 'n1', usuario_id: UID, tipo: 'tarefa', titulo: 'Tarefa atribuída', mensagem: 'Revisar RAT 123', link: '/tarefas?id=t1', lida: false, created_at: '2026-09-02T10:00:00Z' },
    { id: 'n2', usuario_id: UID, tipo: 'info', titulo: 'Lida antiga', mensagem: '', link: null, lida: true, created_at: '2026-09-01T10:00:00Z' }
  ],
  tasks: [
    { id: 't1', title: 'Revisar RAT', description: '', status: 'pending', priority: 'high', due_date: '2020-01-01', assignee_id: UID, created_at: '2026-09-01T00:00:00Z' },
    { id: 't2', title: 'Feita', status: 'completed', priority: 'low', due_date: null, assignee_id: UID, created_at: '2026-09-01T00:00:00Z' }
  ]
};
let refreshCount = 0, sockets = [], joins = [], atPatch = null, logins = 0;

const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => body += c);
  req.on('end', () => {
    log.push(req.method + ' ' + req.url);
    const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const u = new URL(req.url, 'http://x');
    assert.strictEqual(req.headers.apikey, 'anon-test');
    if (u.pathname === '/auth/v1/token') {
      const b = JSON.parse(body);
      if (u.searchParams.get('grant_type') === 'password') {
        logins++;
        if (b.password !== 'segredo') return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        return json(200, { access_token: jwt(Math.floor(Date.now() / 1000) + 3600), refresh_token: logins === 2 ? 'rt-1' : 'rt-web', expires_in: 3600, user: { id: UID, email: b.email } });
      }
      refreshCount++;
      if (b.refresh_token === 'rt-revoked') return json(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Already Used' });
      return json(200, { access_token: jwt(Math.floor(Date.now() / 1000) + 3600), refresh_token: 'rt-' + (refreshCount + 1), user: { id: UID, email: 'jp@medsystem.eng.br' } });
    }
    if (u.pathname === '/auth/v1/logout') return json(204, {});
    assert.ok(/^Bearer h\./.test(req.headers.authorization || ''), 'Bearer obrigatório');
    if (u.pathname === '/rest/v1/rpc/get_user_profile') return json(200, { id: UID, email: 'jp@medsystem.eng.br', full_name: 'JP Teste', role: { slug: 'colaborador', name: 'Colaborador', level: 30 }, sector: { id: 'sec-ti', name: 'TI e Sistemas', slug: 'ti-sistemas' } });
    if (u.pathname === '/rest/v1/modules') return json(200, [{ id: 'm1', slug: 'chamados' }, { id: 'm2', slug: 'compras' }, { id: 'm3', slug: 'tarefas' }, { id: 'm4', slug: 'dashboard' }]);
    if (u.pathname === '/rest/v1/sector_module_access') return json(200, [{ module_id: 'm1', is_enabled: true }, { module_id: 'm3', is_enabled: true }]);
    if (u.pathname === '/rest/v1/user_module_access') return json(200, [{ module_id: 'm2', has_access: true }, { module_id: 'm1', has_access: false }]);
    if (u.pathname === '/rest/v1/notificacoes') {
      if (req.method === 'GET') { assert.strictEqual(u.searchParams.get('usuario_id'), 'eq.' + UID); return json(200, db.notificacoes); }
      if (req.method === 'PATCH') { const b = JSON.parse(body); const id = (u.searchParams.get('id') || '').replace('eq.', ''); for (const n of db.notificacoes) if (!id || n.id === id) n.lida = b.lida; return json(204, {}); }
    }
    if (u.pathname === '/rest/v1/at_os_tarefa') {
      if (req.method === 'GET') { assert.strictEqual(u.searchParams.get('responsavel'), 'eq.' + UID); assert.strictEqual(u.searchParams.get('situacao'), 'not.in.(concluida,cancelada)'); return json(200, [{ id: 'a1', codigo_os: 83568, cliente: 'SLMANDIC', equipamento: 'MONITOR', urgencia: 'media', situacao: 'pendente', prazo: null, observacao: 'Solicitar devolução', criado_em: '2026-08-26T00:00:00Z' }]); }
      if (req.method === 'PATCH') { const b = JSON.parse(body); assert.strictEqual(u.searchParams.get('id'), 'eq.a1'); assert.strictEqual(u.searchParams.get('responsavel'), 'eq.' + UID); atPatch = b.situacao; return json(204, {}); }
    }
    if (u.pathname === '/rest/v1/agenda_calendarios') return json(200, [{ id: 'cal1', nome: 'Assistência Técnica', cor: '#ff9f0a', tipo: 'setor' }]);
    if (u.pathname === '/rest/v1/agenda_evento_participantes') { assert.strictEqual(u.searchParams.get('usuario_id'), 'eq.' + UID); return json(200, [{ evento_id: 'ev2' }]); }
    if (u.pathname === '/rest/v1/agenda_eventos') { const or = u.searchParams.get('or'); assert.ok(or.includes(`criador_id.eq.${UID}`) && or.includes('calendario_id.in.(cal1)') && or.includes('id.in.(ev2)'), or); return json(200, [{ id: 'ev1', titulo: 'Reunião AT', inicio: '2026-09-02T14:00:00Z', fim: '2026-09-02T15:00:00Z', dia_inteiro: false, local: 'Sala 2', calendario_id: 'cal1', criador_id: 'x' }, { id: 'ev2', titulo: 'Treinamento', inicio: '2026-09-03T00:00:00', fim: '2026-09-04T00:00:00', dia_inteiro: true, cor: '#30d158', calendario_id: null, meet_link: 'https://meet' }]); }
    if (u.pathname === '/rest/v1/whatsapp_instance_members') return json(200, [{ instance_id: 'inst-at' }]);
    if (u.pathname === '/rest/v1/whatsapp_instances') return json(200, [{ id: 'inst-at', name: 'Assistência Técnica' }, { id: 'inst-com', name: 'Comercial' }]);
    if (u.pathname === '/rest/v1/whatsapp_conversations') {
      const id = (u.searchParams.get('id') || '').replace('eq.', '');
      const all = [{ id: 'c1', instance_id: 'inst-at', assigned_to: UID, assigned_to_instance_id: null, transferred_from_instance_id: null, active_transfer_started_at: null, unread_count: 2, last_message_at: '2026-09-02T12:00:00Z', last_message_preview: 'oi, tudo bem?', label: null, attendance_status: 'open', contact: { name: 'Hospital X', phone_number: '5511', profile_picture_url: null, is_group: false } },
        { id: 'c2', instance_id: 'inst-com', assigned_to: null, assigned_to_instance_id: 'inst-at', transferred_from_instance_id: 'inst-com', active_transfer_started_at: '2026-09-02T12:30:00Z', unread_count: 0, last_message_at: '2026-09-02T12:30:00Z', last_message_preview: 'preciso de orçamento', label: null, attendance_status: 'open', contact: { name: null, phone_number: '5519', profile_picture_url: null, is_group: false } },
        { id: 'c9', instance_id: 'inst-com', assigned_to: null, assigned_to_instance_id: null, transferred_from_instance_id: null, unread_count: 5, last_message_at: '2026-09-02T12:40:00Z', last_message_preview: 'fora do escopo', attendance_status: 'open', contact: { name: 'Outro', phone_number: '5521' } }];
      if (id) return json(200, all.filter((c) => c.id === id));
      const or = u.searchParams.get('or'); assert.ok(or.includes('instance_id.in.(inst-at)') && or.includes(`assigned_to.eq.${UID}`), or); assert.strictEqual(u.searchParams.get('attendance_status'), 'eq.open');
      return json(200, all.filter((c) => c.id !== 'c9'));
    }
    if (u.pathname === '/rest/v1/tasks') {
      if (req.method === 'POST') { const b = JSON.parse(body); assert.strictEqual(b.created_by, UID); assert.strictEqual(b.assignee_id, UID); assert.strictEqual(b.sector_id, 'sec-ti'); assert.strictEqual(b.status, 'pending'); assert.strictEqual(req.headers.prefer, 'return=representation'); const t = { id: 'tnew', title: b.title, description: b.description, status: 'pending', priority: b.priority, due_date: b.due_date, created_at: new Date().toISOString(), assignee_id: UID, created_by: UID }; db.tasks.push(t); return json(201, [t]); }
      if (req.method === 'GET') { assert.strictEqual(u.searchParams.get('status'), 'neq.completed'); assert.ok(u.searchParams.get('or').includes(`created_by.eq.${UID}`)); return json(200, db.tasks.filter((t) => t.status !== 'completed')); }
      if (req.method === 'PATCH') { const b = JSON.parse(body); assert.ok(u.searchParams.get('or').includes('assignee_id.eq.' + UID)); const t = db.tasks.find((x) => x.id === u.searchParams.get('id').replace('eq.', '')); t.status = b.status; return json(204, {}); }
    }
    json(404, { message: 'not found ' + u.pathname });
  });
});
const wss = new WebSocketServer({ server, path: '/realtime/v1/websocket' });
wss.on('connection', (ws, req) => {
  sockets.push(ws);
  assert.ok(req.url.includes('apikey=anon-test'));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.event === 'phx_join') {
      assert.ok(m.payload.access_token.startsWith('h.'));
      const pc = m.payload.config.postgres_changes;
      if (/notif/.test(m.topic)) { assert.strictEqual(pc[0].table, 'notificacoes'); assert.strictEqual(pc[0].filter, `usuario_id=eq.${UID}`); ws.send(JSON.stringify({ topic: m.topic, event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: m.ref })); }
      else if (/wa-/.test(m.topic)) { assert.strictEqual(pc[0].table, 'whatsapp_messages'); assert.strictEqual(pc[1].table, 'whatsapp_conversations'); ws.send(JSON.stringify({ topic: m.topic, event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: m.ref })); }
      else { assert.ok(['tasks', 'at_os_tarefa'].includes(pc[0].table)); joins.push(m.topic); ws.send(JSON.stringify({ topic: m.topic, event: 'phx_reply', payload: { status: 'error', response: { reason: 'Unable to subscribe to changes with given parameters' } }, ref: m.ref })); }
    }
    if (m.event === 'heartbeat') ws.send(JSON.stringify({ topic: 'phoenix', event: 'phx_reply', payload: { status: 'ok' }, ref: m.ref }));
  });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port, url = `http://127.0.0.1:${port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hubtest-'));
  const secret = { encrypt: (s) => Buffer.from(Buffer.from(s).map((b) => b ^ 0x5a)), decrypt: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf8') };
  const hub = new HubClient({ dir, secret, WebSocket, url, anon: 'anon-test', site: 'https://hub.test' });

  // login errado
  await assert.rejects(hub.login('jp@medsystem.eng.br', 'x'), /Invalid login credentials/);
  assert.strictEqual(hub.linked(), false);

  // login certo → perfil, módulos (setor do banco + override do usuário), notificações, tarefas, realtime
  const events = []; hub.on('notification', (n) => events.push(n));
  const st = await hub.login('jp@medsystem.eng.br', 'segredo');
  assert.strictEqual(st.linked, true); assert.strictEqual(st.profile.name, 'JP Teste'); assert.strictEqual(st.profile.sector, 'TI e Sistemas');
  assert.deepStrictEqual([...st.profile.modules].sort(), ['compras', 'tarefas']);   // chamados desligado pelo override, compras ligado
  assert.strictEqual(st.unread, 1); assert.strictEqual(st.tasks.length, 2); assert.strictEqual(st.overdue, 1);
  const atT = st.tasks.find((t) => t.source === 'at'); assert.strictEqual(atT.id, 'at:a1'); assert.strictEqual(atT.label, 'AT · OS 83568'); assert.strictEqual(atT.title, 'OS 83568 · SLMANDIC'); assert.strictEqual(atT.priority, 'medium');
  assert.strictEqual(st.tasks[0].id, 't1', 'atrasada primeiro');
  // agenda do Hub: cor do calendário, dia inteiro, link
  assert.strictEqual(st.agenda.length, 2); assert.strictEqual(st.agenda[0].title, 'Reunião AT'); assert.strictEqual(st.agenda[0].color, '#ff9f0a'); assert.strictEqual(st.agenda[0].source, 'Assistência Técnica'); assert.strictEqual(st.agenda[1].allDay, true); assert.strictEqual(st.agenda[1].color, '#30d158'); assert.strictEqual(st.agenda[1].link, '/agenda?evento=ev2');
  // conversas do WhatsApp no escopo (c9 fora)
  assert.strictEqual(st.chats.length, 2); assert.strictEqual(st.chatUnread, 2); assert.strictEqual(st.chats[0].name, 'Hospital X'); assert.strictEqual(st.chats[0].mine, true);
  const c2 = st.chats.find((c) => c.id === 'c2'); assert.strictEqual(c2.transferred, true); assert.strictEqual(c2.transferredFrom, 'Comercial'); assert.strictEqual(c2.sector, 'Assistência Técnica'); assert.strictEqual(c2.name, '5519'); assert.strictEqual(st.chatTransfers, 1); assert.strictEqual(st.hasWhatsapp, true);
  // criar tarefa para mim
  const created = await hub.createTask({ title: 'Ligar para o cliente', priority: 'high', due_date: '2026-09-05' });
  assert.strictEqual(created.id, 'tnew'); assert.strictEqual(hub.tasks[0].id, 'tnew'); assert.strictEqual(hub.tasks[0].link, '/tarefas?id=tnew');
  await assert.rejects(hub.createTask({ title: '  ' }), /título/);
  // sessão web separada (2º login) pronta para o localStorage do site
  assert.strictEqual(logins, 3); const wsess = hub.webSession(); assert.strictEqual(wsess.key, 'sb-127-auth-token'); assert.strictEqual(JSON.parse(wsess.value).refresh_token, 'rt-web'); assert.ok(JSON.parse(wsess.value).user.id === UID);
  const ids = st.shortcuts.map((s) => s.id);
  assert.ok(ids.includes('cotacao') && ids.includes('tarefas') && ids.includes('dashboard') && ids.includes('reportar') && !ids.includes('chamado') && !ids.includes('nf'));
  assert.strictEqual(st.shortcuts.find((s) => s.id === 'cotacao').url, 'https://hub.test/compras/cotacoes/nova');
  assert.strictEqual(hub.urlFor('/tarefas?id=1'), 'https://hub.test/tarefas?id=1'); assert.strictEqual(hub.urlFor('https://x.y/z'), 'https://x.y/z'); assert.strictEqual(hub.urlFor(null), 'https://hub.test');
  // sessão cifrada em disco, sem token em texto puro
  const raw = fs.readFileSync(path.join(dir, 'hub-session.bin'));
  assert.ok(!raw.toString('utf8').includes('rt-1'));
  assert.strictEqual(JSON.parse(secret.decrypt(raw)).refresh_token, 'rt-1');

  // realtime: aguarda join, injeta INSERT e UPDATE de tarefa
  await new Promise((r) => { const t = setInterval(() => { if (hub.realtime === 'on') { clearInterval(t); r(); } }, 20); });
  const ws = sockets[sockets.length - 1];
  const changed = []; hub.on('change', () => changed.push(1));
  ws.send(JSON.stringify({ topic: `realtime:sidenotch-notif-${UID}`, event: 'postgres_changes', payload: { data: { schema: 'public', table: 'notificacoes', type: 'INSERT', record: { id: 'n3', usuario_id: UID, tipo: 'x', titulo: 'Nova!', mensagem: 'chegou', link: '/chamados', lida: false, created_at: new Date().toISOString() } } }, ref: null }));
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(events.length, 1); assert.strictEqual(events[0].titulo, 'Nova!'); assert.strictEqual(hub.state().unread, 2); assert.strictEqual(hub.notifications[0].id, 'n3');
  db.tasks.push({ id: 't3', title: 'Nova tarefa', status: 'pending', priority: 'medium', due_date: null, assignee_id: UID, created_at: '2026-09-02T00:00:00Z' });
  ws.send(JSON.stringify({ topic: `realtime:sidenotch-tasks-${UID}`, event: 'postgres_changes', payload: { data: { schema: 'public', table: 'tasks', type: 'INSERT', record: { id: 't3' } } }, ref: null }));
  await new Promise((r) => setTimeout(r, 120));
  assert.strictEqual(hub.tasks.length, 4);
  assert.strictEqual(hub.realtime, 'on', 'canal de tasks com erro não derruba as notificações'); assert.strictEqual(joins.length, 2);
  // WhatsApp: mensagem recebida em conversa minha → evento 'chat' + unread; mensagem nossa (is_from_me) ignorada; conversa fora do escopo ignorada
  const chats = []; hub.on('chat', (c) => chats.push(c));
  const waTopic = `realtime:sidenotch-wa-${UID}`;
  ws.send(JSON.stringify({ topic: waTopic, event: 'postgres_changes', payload: { data: { schema: 'public', table: 'whatsapp_messages', type: 'INSERT', record: { id: 'm1', conversation_id: 'c1', content: 'chegou o equipamento?', is_from_me: false, message_type: 'text', timestamp: new Date().toISOString() } } }, ref: null }));
  ws.send(JSON.stringify({ topic: waTopic, event: 'postgres_changes', payload: { data: { schema: 'public', table: 'whatsapp_messages', type: 'INSERT', record: { id: 'm2', conversation_id: 'c1', content: 'sim', is_from_me: true, message_type: 'text' } } }, ref: null }));
  ws.send(JSON.stringify({ topic: waTopic, event: 'postgres_changes', payload: { data: { schema: 'public', table: 'whatsapp_messages', type: 'INSERT', record: { id: 'm3', conversation_id: 'c9', content: 'x', is_from_me: false, message_type: 'text' } } }, ref: null }));
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(chats.length, 1); assert.strictEqual(chats[0].kind, 'message'); assert.strictEqual(chats[0].conv.name, 'Hospital X'); assert.strictEqual(chats[0].text, 'chegou o equipamento?');
  assert.strictEqual(hub.chats.find((c) => c.id === 'c1').unread, 3); assert.strictEqual(hub.chats[0].id, 'c1', 'reordenada pela última mensagem'); assert.ok(!hub.chats.some((c) => c.id === 'c9'));
  // transferência de outro setor para o meu → evento 'transfer'
  ws.send(JSON.stringify({ topic: waTopic, event: 'postgres_changes', payload: { data: { schema: 'public', table: 'whatsapp_conversations', type: 'UPDATE', record: { id: 'c9', instance_id: 'inst-com', assigned_to: null, assigned_to_instance_id: 'inst-at', transferred_from_instance_id: 'inst-com', active_transfer_started_at: new Date().toISOString(), unread_count: 5, last_message_at: new Date().toISOString(), last_message_preview: 'fora do escopo', attendance_status: 'open' }, old_record: { id: 'c9', assigned_to_instance_id: null, assigned_to: null } } }, ref: null }));
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(chats.length, 2); assert.strictEqual(chats[1].kind, 'transfer'); assert.match(chats[1].text, /Comercial.*Assistência Técnica/); assert.strictEqual(hub.chats.find((c) => c.id === 'c9').name, 'Outro'); assert.strictEqual(hub.state().chatTransfers, 2);
  // conversa concluída → sai da lista
  ws.send(JSON.stringify({ topic: waTopic, event: 'postgres_changes', payload: { data: { schema: 'public', table: 'whatsapp_conversations', type: 'UPDATE', record: { id: 'c9', instance_id: 'inst-com', assigned_to_instance_id: 'inst-at', attendance_status: 'done' }, old_record: {} } }, ref: null }));
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!hub.chats.some((c) => c.id === 'c9'));

  // marcar lida (uma e todas) e concluir tarefa
  await hub.markRead('n3'); assert.strictEqual(hub.state().unread, 1); assert.strictEqual(db.notificacoes.find((n) => n.id === 'n3'), undefined); // n3 veio só pelo realtime, não está no "banco"
  await hub.markRead('*'); assert.strictEqual(hub.state().unread, 0); assert.ok(db.notificacoes.every((n) => n.lida));
  await hub.setTaskStatus('t1', 'in_progress'); assert.strictEqual(hub.tasks.find((t) => t.id === 't1').status, 'in_progress');
  await hub.setTaskStatus('at:a1', 'completed'); assert.strictEqual(atPatch, 'concluida'); assert.ok(!hub.tasks.some((t) => t.id === 'at:a1'));
  await hub.setTaskStatus('t1', 'completed'); assert.strictEqual(hub.tasks.length, 2);   // tnew + t3 assert.strictEqual(db.tasks.find((t) => t.id === 't1').status, 'completed');
  await assert.rejects(hub.setTaskStatus('t3', 'weird'), /inválido/);

  // token quase vencendo → refresh automático antes da chamada
  hub.session.expires_at = Date.now() + 10000;
  await hub.loadTasks(); assert.strictEqual(refreshCount, 1); assert.strictEqual(hub.session.refresh_token, 'rt-2');

  // reinício do app: nova instância lê a sessão do disco e retoma sem senha
  hub.stop();
  const hub2 = new HubClient({ dir, secret, WebSocket, url, anon: 'anon-test', site: 'https://hub.test' });
  assert.strictEqual(hub2.linked(), true);
  await hub2.start(60);
  assert.strictEqual(hub2.profile.name, 'JP Teste'); assert.strictEqual(hub2.connected, true); assert.strictEqual(JSON.parse(hub2.webSession().value).refresh_token, 'rt-web', 'sessão web sobrevive ao reinício');
  hub2.stop();

  // refresh revogado → desvincula sozinho
  const hub3 = new HubClient({ dir, secret, WebSocket, url, anon: 'anon-test' });
  fs.writeFileSync(path.join(dir, 'hub-session.bin'), secret.encrypt(JSON.stringify({ refresh_token: 'rt-revoked' })));
  await hub3.start(60);
  assert.strictEqual(hub3.linked(), false); assert.match(hub3.error, /expirada/);
  hub3.stop();

  // logout apaga o arquivo
  hub2.logout(); assert.ok(!fs.existsSync(path.join(dir, 'hub-session.bin')));

  assert.ok(SHORTCUTS.every((s) => s.path.startsWith('/') && s.name && s.icon && s.ix));
  assert.strictEqual(new Set(SHORTCUTS.map((s) => s.id)).size, SHORTCUTS.length, 'ids únicos');
  // atalhos personalizados vindos das configurações + catálogo com flag de acesso
  const hub4 = new HubClient({ dir, secret, url, anon: 'anon-test', site: 'https://hub.test', getCfg: () => ({ custom: [{ id: 'x1', name: 'Planilha', path: 'https://docs.google.com/x' }, { id: 'x2', name: 'Chamados AT', path: 'chamados?setor=at', ix: 'Headphone' }] }) });
  hub4.profile = { id: UID, role: { level: 30, slug: 'colaborador' }, modules: ['compras'] };
  const sc4 = hub4.shortcuts(); assert.strictEqual(sc4.find((s) => s.id === 'u:x1').url, 'https://docs.google.com/x'); assert.strictEqual(sc4.find((s) => s.id === 'u:x2').url, 'https://hub.test/chamados?setor=at');
  const cat = hub4.catalog(); assert.ok(cat.find((c) => c.id === 'cotacao').allowed && !cat.find((c) => c.id === 'nf').allowed && cat.find((c) => c.id === 'dashboard').allowed);
  for (const s of sockets) s.terminate();
  wss.close(); server.close();
  console.log('hub.test: OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
