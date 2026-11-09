#!/usr/bin/env node
/**
 * 할 일 뽑기 평가(사내 AI 를 실제로 부른다) — 가상 평가 묶음(test/fixtures/todos)을 hai_todo extract 와 같은 경로에 넣고
 * 정밀도·재현율·할 일 없는 글의 오탐·담당 정확도를 잰다. --repeat 이면 같은 입력을 여러 번 돌려 흔들림도 본다.
 *   cd plugins/hai/server
 *   node scripts/todo-bench.mjs                       # cases.json(조정용 48건)
 *   node scripts/todo-bench.mjs --file holdout.json   # 검증용 20건(조정에 쓰지 않음)
 *   node scripts/todo-bench.mjs --repeat 3 --only m01,c02
 *   node scripts/todo-bench.mjs --no-think            # 추론 모드 없이(비교용 — 더 빠르지만 덜 맞는다)
 * 로그인(hai_login) 했거나 HAI_API_KEY 가 있어야 한다. npm test 에는 들어가지 않는다(네트워크·키 필요).
 * 결과는 화면에만 쓴다. 평가 자료는 모두 가상이다 — 실제 메일·대화를 이 묶음에 넣지 않는다.
 */
import fs from 'node:fs';
import { extractTodos, OWNER_KEY, SCHEMA } from '../src/todo-extract.js';
import { structured } from '../src/hai.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const repeat = Number(opt('repeat', 1));
const only = String(opt('only', '')).split(',').filter(Boolean);
const file = opt('file', 'cases.json');
const ME = ['한도윤', 'doyun@corp.example'];   // 평가 자료의 가상 '나'

const { cases } = JSON.parse(fs.readFileSync(new URL(`../test/fixtures/todos/${file}`, import.meta.url), 'utf8'));
const pick = only.length ? cases.filter((c) => only.includes(c.id)) : cases;
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, '');
const matches = (text, key) => key.every((k) => k.split('|').some((alt) => norm(text).includes(norm(alt))));
// hai_todo extract 와 같은 설정(src/index.js haiTodos). --no-think 는 비교용
const thinking = !args.includes('--no-think');
const ask = async (messages) => {
  try { return (await structured({ messages, schema: SCHEMA, name: 'todos', temperature: 0, maxTokens: 700, thinking })).data?.items ?? []; }
  catch (err) { if (err.code === 'HAI_FAILED') return []; throw err; }
};

const runs = [];
for (let r = 0; r < repeat; r++) {
  const rows = [];
  for (const c of pick) {
    const chat = c.id.startsWith('c');
    const { items: got } = await extractTodos({
      text: chat ? c.body : `보낸 사람: ${c.from}\n제목: ${c.subject}\n\n${c.body}`,
      source: chat ? c.from : c.subject, me: ME, sent: c.from.includes('doyun@corp.example'), ask,
    });
    const used = new Set();
    let tp = 0, ownerOk = 0;
    const preds = got.map((g) => {
      const hit = c.expect.findIndex((e, i) => !used.has(i) && matches(g.text, e.key));
      if (hit >= 0) { used.add(hit); tp++; if (c.expect[hit].owner.split('|').map((o) => OWNER_KEY[o]).includes(g.owner)) ownerOk++; }
      return { text: g.text, owner: g.owner, want: hit >= 0 ? c.expect[hit].owner : null, ok: hit >= 0 };
    });
    rows.push({ id: c.id, expect: c.expect.length, preds, tp, ownerOk, missed: c.expect.filter((_, i) => !used.has(i)).map((e) => e.key.join('+')) });
    process.stderr.write(`\r${r + 1}/${repeat} ${rows.length}/${pick.length}`);
  }
  const sum = (f) => rows.reduce((a, x) => a + f(x), 0);
  const P = sum((x) => x.preds.length), TP = sum((x) => x.tp), E = sum((x) => x.expect), OK = sum((x) => x.ownerOk);
  runs.push({ precision: P ? TP / P : 1, recall: E ? TP / E : 1, preds: P, tp: TP, expected: E, emptyFP: sum((x) => (x.expect ? 0 : x.preds.length)), ownerAcc: TP ? OK / TP : 0, rows });
}
process.stderr.write('\n');

const pct = (x) => `${(x * 100).toFixed(0).padStart(3)}%`;
for (const [i, s] of runs.entries()) console.log(`#${i + 1} 정밀도 ${pct(s.precision)} · 재현율 ${pct(s.recall)} · 뽑음 ${s.preds}(맞음 ${s.tp}/기대 ${s.expected}) · 할 일 없는 글 오탐 ${s.emptyFP} · 담당 정확 ${pct(s.ownerAcc)}`);
if (runs.length > 1) {
  const unstable = runs[0].rows.map((x) => x.id).filter((id) => new Set(runs.map((r) => r.rows.find((x) => x.id === id).preds.length)).size > 1);
  console.log(`흔들림: ${unstable.length}/${runs[0].rows.length} 사례에서 뽑은 개수가 달랐음 ${unstable.join(',')}`);
}
console.log('\n틀린 것(마지막 실행):');
for (const x of runs.at(-1).rows) {
  const bad = x.preds.filter((p) => !p.ok);
  const wrongOwner = x.preds.filter((p) => p.ok && !p.want.split('|').map((o) => OWNER_KEY[o]).includes(p.owner));
  if (bad.length || x.missed.length || wrongOwner.length) console.log(`- ${x.id}: ${bad.map((p) => `오탐 "${p.text}"(${p.owner})`).join(' / ')}${x.missed.length ? ` 놓침 [${x.missed.join(', ')}]` : ''}${wrongOwner.map((p) => ` 담당 "${p.text}" ${p.owner}→${p.want}`).join('')}`);
}
