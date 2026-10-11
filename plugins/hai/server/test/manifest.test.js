import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));

test('버전이 한 곳에서만 어긋나지 않는다 — plugin.json · marketplace · package.json · 서버 VERSION', () => {
  const v = read('../../.claude-plugin/plugin.json').version;
  assert.equal(read('../../../../.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'hai').version, v);
  assert.equal(read('../package.json').version, v);
  const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(src, new RegExp(`export const VERSION = '${v.replace(/\./g, '\\.')}'`));
});

test('MCP 설정이 쓰는 사용자 설정은 plugin.json 에 선언돼 있다', () => {
  const declared = Object.keys(read('../../.claude-plugin/plugin.json').userConfig);
  const used = [...JSON.stringify(read('../../.mcp.json')).matchAll(/user_config\.(\w+)/g)].map((m) => m[1]);
  for (const u of used) assert.ok(declared.includes(u), u);
});
