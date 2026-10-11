#!/usr/bin/env node
/**
 * 개발용: 묶은 서버(dist/hai-mcp.mjs)를 띄워 도구를 차례로 부른다. 한 서버에서 부르므로 mask_id 가 이어진다.
 *   node scripts/call.mjs                                   → 도구 목록
 *   node scripts/call.mjs hai_status
 *   node scripts/call.mjs hai_mask_file '{"path":"~/a.pdf"}' hai_restore '{"mask_id":"{{mask_id}}","text":"[이름1]","out_path":"/tmp/x"}'
 * {{mask_id}} 는 바로 앞 결과의 mask_id 로 바뀐다.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('../../dist/hai-mcp.mjs', import.meta.url));
const argv = process.argv.slice(2);
const calls = [];
for (let i = 0; i < argv.length; i += 2) calls.push([argv[i], argv[i + 1] ?? '{}']);

const child = spawn(process.execPath, [server], { stdio: ['pipe', 'pipe', 'inherit'] });
const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
let id = 1, maskId = '';

function next() {
  const c = calls.shift();
  if (!c) { child.kill(); return; }
  const args = JSON.parse(c[1].replaceAll('{{mask_id}}', maskId));
  send({ id: ++id, method: 'tools/call', params: { name: c[0], arguments: args } });
}

let buf = '';
child.stdout.on('data', (d) => {
  buf += d;
  for (let i; (i = buf.indexOf('\n')) >= 0;) {
    const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (msg.id === 1) {
      send({ method: 'notifications/initialized' });
      if (calls.length) next(); else send({ id: ++id, method: 'tools/list' });
    } else if (msg.result?.tools) {
      console.log(msg.result.tools.map((t) => `${t.name}(${Object.keys(t.inputSchema.properties ?? {}).join(', ')})`).join('\n'));
      child.kill();
    } else {
      const text = msg.result ? (msg.result.isError ? '[오류] ' : '') + msg.result.content.map((c) => c.text).join('\n') : JSON.stringify(msg.error);
      maskId = text.match(/^mask_id: (\S+)/m)?.[1] ?? maskId;
      console.log(text + '\n');
      next();
    }
  }
});
send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'call', version: '0' } } });
setTimeout(() => { console.error('시간 초과'); child.kill(); process.exit(1); }, 600_000).unref();
