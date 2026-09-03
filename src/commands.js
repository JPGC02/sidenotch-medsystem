// Comandos do TI: atalhos de PowerShell que o próprio usuário cadastra nas configurações.
// Nada roda que não esteja na lista salva — o notch só pode disparar por id, nunca mandar texto livre.
const { spawn } = require('child_process');

const TIMEOUT = 25000;
const MAX_OUT = 8000;

// sugestões que vêm de fábrica (o usuário edita/remove à vontade)
const DEFAULTS = [
  { id: 'ip', name: 'Meu IP e rede', cmd: 'Get-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq "Up" } | Format-List InterfaceAlias, IPv4Address, IPv4DefaultGateway, DNSServer', ix: 'Global', color: '#0a84ff' },
  { id: 'ping', name: 'Testar internet', cmd: 'Test-Connection 8.8.8.8 -Count 4 | Format-Table Address, ResponseTime, Status -AutoSize', ix: 'Wifi', color: '#30d158' },
  { id: 'spool', name: 'Reiniciar spool de impressão', cmd: 'Restart-Service -Name Spooler -Force; "Spooler: " + (Get-Service Spooler).Status', ix: 'Printer', color: '#ff9f0a', confirm: true, admin: true },
  { id: 'dns', name: 'Limpar cache DNS', cmd: 'Clear-DnsClientCache; "Cache DNS limpo."', ix: 'Refresh', color: '#5e5ce6' },
  { id: 'disco', name: 'Espaço em disco', cmd: 'Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{n="Livre (GB)";e={[math]::Round($_.Free/1GB,1)}}, @{n="Total (GB)";e={[math]::Round(($_.Used+$_.Free)/1GB,1)}} | Format-Table -AutoSize', ix: 'Cpu', color: '#64d2ff' },
  { id: 'top', name: 'Quem está comendo memória', cmd: 'Get-Process | Sort-Object WS -Descending | Select-Object -First 8 Name, @{n="RAM (MB)";e={[math]::Round($_.WS/1MB)}}, CPU | Format-Table -AutoSize', ix: 'Chart21', color: '#bf5af2' }
];

function normalize(list) {
  return (Array.isArray(list) ? list : []).filter((c) => c && c.name && c.cmd).slice(0, 30).map((c, i) => ({
    id: String(c.id || 'c' + i), name: String(c.name).slice(0, 60), cmd: String(c.cmd).slice(0, 2000),
    ix: c.ix || 'Code', color: c.color || '#8e8e93', confirm: !!c.confirm, admin: !!c.admin
  }));
}

// roda um comando da lista; devolve { ok, out, err, code, ms }
function run(list, id, { timeout = TIMEOUT } = {}) {
  const cmds = normalize(list);
  const c = cmds.find((x) => x.id === id);
  if (!c) return Promise.resolve({ ok: false, err: 'comando não está na lista salva' });
  const started = Date.now();
  return new Promise((resolve) => {
    let ps;
    try {
      ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', c.cmd], { windowsHide: true });
    } catch (e) { return resolve({ ok: false, err: String(e.message || e) }); }
    let out = '', err = '', done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(t); try { ps.kill(); } catch { /* já morreu */ } resolve({ ...r, name: c.name, ms: Date.now() - started }); };
    const t = setTimeout(() => finish({ ok: false, out: out.slice(0, MAX_OUT), err: `passou de ${Math.round(timeout / 1000)}s e foi interrompido` }), timeout);
    ps.stdout.on('data', (d) => { out += d; if (out.length > MAX_OUT * 2) out = out.slice(0, MAX_OUT * 2); });
    ps.stderr.on('data', (d) => { err += d; });
    ps.on('error', (e) => finish({ ok: false, err: String(e.message || e) }));
    ps.on('close', (code) => finish({ ok: code === 0, code, out: out.trim().slice(0, MAX_OUT), err: err.trim().slice(0, 1200) }));
  });
}

module.exports = { run, normalize, DEFAULTS, TIMEOUT };
