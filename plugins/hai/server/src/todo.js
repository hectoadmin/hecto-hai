/**
 * 할 일 목록 — 이 PC 의 dataDir/todos.json 에만 둔다(0600). 서버·Claude 메모리에 쌓지 않는다.
 * owner: me(내가 할 일) · other(남이 할 일) · check(확인할 일). status: open · done · dismissed.
 * 같은 글은 한 건으로 친다. 끝낸 것은 90일 뒤 지운다.
 * 글은 메일·대화에서 온 것이라 믿지 않는다: 저장할 때 한 줄로 만들고, 꺼낼 때 「」로 묶어 지시로 읽히지 않게 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { HaiError } from './hai.js';
import { quoted, UNTRUSTED } from './agent.js';

const KEEP_MS = 90 * 86400_000;
const LABEL = { me: '내가 할 일', other: '남이 할 일', check: '확인할 일' };
const file = () => path.join(config.dataDir, 'todos.json');
const squash = (s) => String(s ?? '').replace(/[\s.,!?·~]+/g, '').toLowerCase();
/** 한 줄로 — 줄바꿈·제어 문자로 목록 형식을 흉내 내지 못하게 */
const line = (s, max) => String(s ?? '').replace(/[\s\p{Cc}\p{Cf}]+/gu, ' ').trim().slice(0, max);

function load() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return []; }
}
function save(rows) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows), { mode: 0o600 });
  fs.renameSync(tmp, file());
}

/** @param {{text: string, owner?: string, source?: string, due?: string}[]} items → {added, same} */
export function addTodos(items, now = Date.now()) {
  const rows = load().filter((r) => r.status === 'open' || now - r.closedAt < KEEP_MS);
  let added = 0;
  for (const it of items) {
    const text = line(it.text, 300);
    if (!text) continue;
    if (rows.some((r) => squash(r.text) === squash(text))) continue;   // 닫은 것도 — 지운 일이 다시 올라오지 않게
    rows.push({ id: randomBytes(3).toString('hex'), text, owner: LABEL[it.owner] ? it.owner : 'me', source: line(it.source, 80), due: line(it.due, 40), status: 'open', at: now });
    added++;
  }
  save(rows);
  return { added, same: items.length - added };
}

export const listTodos = () => load().filter((r) => r.status === 'open').sort((a, b) => a.at - b.at);

export function closeTodo(id, status, now = Date.now()) {
  const rows = load();
  const row = rows.find((r) => r.id === id && r.status === 'open');
  if (!row) throw new HaiError('TODO_NOT_FOUND', `열린 할 일 ${id} 가 없습니다. action: "list" 로 번호를 보세요.`);
  Object.assign(row, { status, closedAt: now });
  save(rows);
  return row;
}

/** 갈래별 글 */
export function todoText(rows) {
  if (!rows.length) return '열린 할 일이 없습니다.';
  const body = Object.entries(LABEL).flatMap(([k, label]) => {
    const part = rows.filter((r) => r.owner === k);
    return part.length ? [`${label} ${part.length}건`, ...part.map((r) => `- [${r.id}] ${quoted(r.text)}${r.due ? ` 기한 ${quoted(r.due)}` : ''}${r.source ? ` 출처 ${quoted(r.source)}` : ''}`)] : [];
  }).join('\n');
  return `${body}\n${UNTRUSTED}`;
}
