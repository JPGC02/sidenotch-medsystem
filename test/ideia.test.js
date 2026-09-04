// Ideia Central: leitura das filas de render, aviso só na virada de estado, ideia capturada,
// publicações travadas e as ações (edge function com a sessão, rota do site com o x-automation-secret).
// Supabase e app falsos em memória — nenhuma rede real, nenhum segredo verdadeiro.
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { IdeiaClient } = require('../src/ideia');

const UID = '22222222-2222-4222-8222-222222222222';
const jwt = (exp) => 'h.' + Buffer.from(JSON.stringify({ sub: UID, email: 'dono@exemplo.com', exp })).toString('base64url') + '.s';
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const agora = new Date().toISOString();

const db = {
  movie_recap_jobs: [{ id: 'r1', status: 'rendering', work_title: 'Recap do filme X', drive_file_name: 'x.mp4', error: null, created_at: agora, updated_at: agora }],
  music_video_projects: [{ id: 'm1', status: 'draft', title: 'Clipe novo', error: null, created_at: agora, updated_at: agora }],
  scene_clip_jobs: [{ id: 'c1', status: 'processing', stage: 'cortando', source_name: 'aula.mkv', error: null, created_at: agora, updated_at: agora }],
  generation_jobs: [], tiktok_automation_jobs: [], estudio_generations: [],
  youtube_clip_candidates: [{ id: 'y1', render_status: 'rendering', title: 'Corte 1', render_error: null, created_at: agora, updated_at: agora }],
  saved_content: [{ id: 's1', title: 'Ideia do Telegram', summary: null, raw_text: 'testar isso', source: 'telegram', platform: null, content_type: 'project_idea', source_url: null, status: 'novo', created_at: agora }],
  planned_posts: [{ id: 'p1', kind: 'reel', caption: 'Post de amanhã', scheduled_at: new Date(Date.now() + 3600000).toISOString(), status: 'scheduled', permalink: null, error: null }],
  instagram_publications: [], tiktok_posts: [], youtube_uploads: []
};
const chamadas = [];

const supa = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => body += c);
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    chamadas.push({ url: req.url, apikey: req.headers.apikey, auth: req.headers.authorization, secret: req.headers['x-automation-secret'], body });
    if (u.pathname === '/auth/v1/token') {
      if (!req.headers.apikey) return json(res, 401, { message: 'sem apikey' });
      return json(res, 200, { access_token: jwt(Math.floor(Date.now() / 1000) + 3600), refresh_token: 'rt', user: { id: UID, email: 'dono@exemplo.com' } });
    }
    if (u.pathname === '/functions/v1/planner-publish') return json(res, 200, { ok: true, publicados: 1 });
    const m = /^\/rest\/v1\/([a-z_]+)$/.exec(u.pathname);
    if (m && db[m[1]]) {
      const tabela = m[1];
      if (req.method === 'POST') { const row = { id: 'novo1', ...JSON.parse(body) }; db[tabela].unshift(row); return json(res, 201, [row]); }
      if (req.method === 'PATCH') { const id = (u.searchParams.get('id') || '').replace('eq.', ''); const r = db[tabela].find((x) => x.id === id); if (r) Object.assign(r, JSON.parse(body)); return json(res, 200, []); }
      let linhas = db[tabela];
      const st = u.searchParams.get('status');
      if (st && st.startsWith('eq.')) linhas = linhas.filter((r) => r.status === st.slice(3));
      if (st && st.startsWith('in.')) { const vals = st.slice(4, -1).split(','); linhas = linhas.filter((r) => vals.includes(r.status)); }
      return json(res, 200, linhas);
    }
    json(res, 404, { message: 'não achei ' + u.pathname });
  });
});

// o app na Vercel (rotas /api que exigem o x-automation-secret)
const site = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => body += c);
  req.on('end', () => {
    chamadas.push({ url: 'site' + req.url, secret: req.headers['x-automation-secret'], body });
    if (req.headers['x-automation-secret'] !== 'segredo-de-teste') return json(res, 401, { error: 'não autorizado' });
    json(res, 200, { ok: true });
  });
});

supa.listen(0, () => site.listen(0, async () => {
  const url = `http://127.0.0.1:${supa.address().port}`;
  const siteUrl = `http://127.0.0.1:${site.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snm-ideia-'));
  const avisos = [];
  let cfg = { enabled: true, url, anon: 'anon-de-teste', site: siteUrl, pollSec: 60 };
  const ic = new IdeiaClient({ dir, secret: null, getCfg: () => cfg, notify: (n) => avisos.push(n) });
  try {
    // ---- sem chave, não sai do lugar ----
    cfg.anon = '';
    assert.strictEqual(ic.configurado(), false, 'sem a chave pública não está configurado');
    await assert.rejects(() => ic.login('dono@exemplo.com', 'x'), /chave pública/, 'avisa que falta a chave');
    cfg.anon = 'anon-de-teste';

    // ---- entra e lê tudo ----
    const st = await ic.login('dono@exemplo.com', 'segredo');
    assert.strictEqual(st.linked, true, 'entrou');
    assert.strictEqual(st.email, 'dono@exemplo.com');
    const rodando = st.jobs.filter((j) => j.rodando);
    assert.strictEqual(rodando.length, 3, 'recap + cortes + corte do YouTube rodando (o clipe está em draft)');
    assert.ok(rodando.find((j) => j.titulo === 'Recap do filme X' && j.etapa === 'rendering'), 'mostra a etapa do recap');
    assert.ok(rodando.find((j) => j.etapa === 'cortando'), 'cortes de cena usam o stage');
    assert.strictEqual(st.counts.rodando, 3, 'contador da pastilha');
    assert.strictEqual(st.ideias.length, 1, 'ideia capturada esperando');
    assert.strictEqual(st.posts.length, 1, 'publicação agendada');
    assert.strictEqual(st.posts[0].plataforma, 'Instagram');
    assert.strictEqual(avisos.length, 0, 'a primeira leitura não dispara avisos (senão abre o app e chove notificação)');
    assert.ok(chamadas.some((c) => c.apikey === 'anon-de-teste'), 'manda a apikey');

    // ---- terminou e quebrou: um aviso para cada, uma vez só ----
    db.movie_recap_jobs[0].status = 'done';
    db.scene_clip_jobs[0].status = 'failed'; db.scene_clip_jobs[0].error = 'ffmpeg morreu';
    await ic.refresh();
    assert.strictEqual(avisos.length, 2, 'dois avisos: pronto e falhou');
    assert.ok(avisos.find((a) => a.tipo === 'ok' && /Recap de filme pronto/.test(a.title)), 'aviso de pronto');
    const falha = avisos.find((a) => a.tipo === 'erro');
    assert.ok(/Cortes de cena falhou/.test(falha.title) && /ffmpeg morreu/.test(falha.text), 'aviso de falha diz o motivo');
    await ic.refresh();
    assert.strictEqual(avisos.length, 2, 'não repete o aviso a cada consulta');
    assert.strictEqual(ic.state().counts.rodando, 1, 'só o corte do YouTube segue rodando');

    // ---- ideia nova capturada em outro lugar vira aviso ----
    db.saved_content.unshift({ id: 's2', title: 'Veio do iPhone', raw_text: null, source: 'atalho', content_type: 'reference', status: 'novo', created_at: new Date().toISOString() });
    await ic.refresh();
    assert.ok(avisos.find((a) => a.tipo === 'ideia' && /Veio do iPhone/.test(a.text)), 'avisa ideia capturada');

    // ---- respeitar o que está desligado nas configurações ----
    cfg.notifyIdeias = false;
    db.saved_content.unshift({ id: 's3', title: 'Silenciosa', status: 'novo', created_at: new Date().toISOString() });
    const antes = avisos.length;
    await ic.refresh();
    assert.strictEqual(avisos.length, antes, 'aviso de ideia desligado nas configurações');
    cfg.notifyIdeias = true;

    // ---- guardar ideia pelo notch ----
    const nova = await ic.novaIdeia({ texto: 'gravar vídeo sobre o notch' });
    assert.strictEqual(nova.raw_text, 'gravar vídeo sobre o notch');
    assert.strictEqual(nova.source, 'sidenotch', 'marca de onde veio');
    assert.strictEqual(nova.status, 'novo');
    await assert.rejects(() => ic.novaIdeia({ texto: '   ' }), /escreva a ideia/, 'não grava vazio');

    // ---- tirar da caixa de entrada ----
    await ic.marcarIdeia('s1');
    assert.strictEqual(db.saved_content.find((r) => r.id === 's1').status, 'processado', 'marcou como processada');
    assert.ok(!ic.state().ideias.find((i) => i.id === 's1'), 'sai da lista na hora');

    // ---- ações ----
    const r1 = await ic.acao('publicar');
    assert.strictEqual(r1.ok, true, 'edge function respondeu');
    const chamadaFn = chamadas.filter((c) => /planner-publish/.test(c.url)).pop();
    assert.ok(/^Bearer /.test(chamadaFn.auth), 'usa a sessão do dono na edge function');
    await assert.rejects(() => ic.acao('tiktok'), /x-automation-secret/, 'rota do site exige o segredo');
    ic.setSecret('segredo-de-teste');
    assert.strictEqual(ic.state().temSecret, true, 'segredo guardado');
    const r2 = await ic.acao('tiktok');
    assert.strictEqual(r2.ok, true, 'automação do TikTok disparada');
    assert.strictEqual(chamadas.filter((c) => c.url === 'site/api/tiktok/automation').pop().secret, 'segredo-de-teste', 'manda o header do segredo');
    await assert.rejects(() => ic.acao('nao-existe'), /desconhecida/);

    // ---- o segredo não fica em texto puro no disco quando há cofre ----
    const cofre = { encrypt: (s) => Buffer.from('#' + s, 'utf8'), decrypt: (b) => b.toString('utf8').slice(1) };
    const ic2 = new IdeiaClient({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'snm-ideia2-')), secret: cofre, getCfg: () => cfg });
    ic2.setSecret('outro-segredo');
    const bruto = fs.readFileSync(path.join(ic2.dir, 'ideia-session.bin'), 'utf8');
    assert.ok(bruto.startsWith('#'), 'passou pelo cofre do sistema');
    ic2.dispose();

    // ---- sair limpa tudo ----
    ic.logout();
    assert.strictEqual(ic.state().linked, false, 'saiu');
    assert.strictEqual(ic.state().jobs.length, 0, 'não sobra dado do projeto na tela');

    // ---- módulo desligado não consulta ----
    cfg.enabled = false;
    const quantas = chamadas.length;
    await ic.refresh();
    assert.strictEqual(chamadas.length, quantas, 'desligado nas configurações, nem pergunta');

    console.log('Ideia Central OK');
    ic.dispose(); supa.close(); site.close();
  } catch (e) { console.error(e); ic.dispose(); supa.close(); site.close(); process.exitCode = 1; }
}));
