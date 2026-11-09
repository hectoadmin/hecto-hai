/**
 * 할 일 목록 — 이 PC 의 dataDir/todos.json 에만 둔다(0600). 서버·Claude 메모리에 쌓지 않는다.
 * owner: me(내가 할 일) · other(남이 할 일) · check(확인할 일). status: open · done · dismissed.
 * 같은 글은 한 건으로 친다(지문: 띄어쓰기·부호·끝맺음 무시). 같은 스레드·같은 갈래에 표현만 다른 글도 한 건. 끝낸 것은 90일 뒤 지운다.
 * 글은 메일·대화에서 온 것이라 믿지 않는다: 저장할 때 한 줄로 만들고 번호류(전화·계좌·주민번호 등)는 가리고, 꺼낼 때 「」로 묶어 지시로 읽히지 않게 한다.
 * 뽑기 정밀도(인용 빼기·조각·근거 확인·담당 규칙)는 todo-extract.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { HaiError } from './hai.js';
import { quoted, UNTRUSTED } from './agent.js';
import { Vault, maskPatterns } from './mask.js';
import { fingerprint, similar, threadKey, oneLine, overdue } from './todo-extract.js';

const KEEP_MS = 90 * 86400_000;
const LABEL = { me: '내가 할 일', other: '남이 할 일', check: '확인할 일' };
const file = () => path.join(config.dataDir, 'todos.json');
/** 번호류 개인정보는 목록에 남기지 않는다 — 자리표시 번호는 저장마다 새로 매긴다(되돌리지 않음) */
const scrub = (s, vault) => maskPatterns(s, vault, { keepDomains: config.keepDomains });

function load() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return []; }
}
function save(rows) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows), { mode: 0o600 });
  fs.renameSync(tmp, file());
}

/**
 * @param {{text: string, owner?: string, source?: string, due?: string, person?: string, evidence?: string}[]} items
 * @param {number} now
 * @param {{ before?: (rows: object[]) => void }} opts  before: 더하기 전에 열린 목록을 고칠 기회(끝난 것 같음 표시)
 * → {added, same, rows: 더한 줄}
 */
export function addTodos(items, now = Date.now(), { before } = {}) {
  const rows = load().filter((r) => r.status === 'open' || now - r.closedAt < KEEP_MS);
  before?.(rows);
  const vault = new Vault();
  const out = [];
  for (const it of items) {
    const text = oneLine(scrub(it.text, vault), 300);
    if (!text) continue;
    const owner = LABEL[it.owner] ? it.owner : 'me';
    const source = oneLine(it.source, 80);
    const thread = threadKey(source);
    const fp = fingerprint(text);
    if (rows.some((r) => fingerprint(r.text) === fp)) continue;   // 닫은 것도 — 지운 일이 다시 올라오지 않게
    if (thread && rows.some((r) => r.status === 'open' && r.thread === thread && r.owner === owner && similar(r.text, text) >= 0.5)) continue;
    const row = { id: randomBytes(3).toString('hex'), text, owner, source, due: oneLine(it.due, 40), status: 'open', at: now };
    if (thread) row.thread = thread;
    const person = oneLine(scrub(it.person, vault), 40);
    if (person) row.person = person;
    const evidence = oneLine(scrub(it.evidence, vault), 100);
    if (evidence) row.evidence = evidence;
    rows.push(row);
    out.push(row);
  }
  save(rows);
  return { added: out.length, same: items.length - out.length, rows: out };
}

export const listTodos = () => load().filter((r) => r.status === 'open').sort((a, b) => a.at - b.at);

export function closeTodo(id, status, now = Date.now()) {
  const rows = load();
  const row = rows.find((r) => r.id === id && r.status === 'open');
  if (!row) throw new HaiError('TODO_NOT_FOUND', `열린 할 일 ${id} 가 없습니다. action: "list" 로 번호를 보세요.`);
  Object.assign(row, { status, closedAt: now });
  delete row.doneHint;
  save(rows);
  return row;
}

const day = (ms) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
/** 한 줄 — 「」 안은 모두 메일·대화에서 온 글 */
export function todoLine(r, now = Date.now()) {
  return `- [${r.id}] ${quoted(r.text)}`
    + (r.owner === 'other' && r.person ? ` 할 사람 ${quoted(r.person)}` : '')
    + (r.due ? ` 기한 ${quoted(r.due)}${overdue(r, now) ? ' (지남)' : ''}` : '')
    + (r.source ? ` 출처 ${quoted(r.source)}` : '')
    + (r.doneHint ? ` ⟵ 끝난 것 같음: ${r.doneHint.kind === 'replied' ? '내가 같은 스레드에 답장함' : '상대가 끝났다고 함'}(${day(r.doneHint.at)})` : '');
}

/** 갈래별 글 */
export function todoText(rows, now = Date.now()) {
  if (!rows.length) return '열린 할 일이 없습니다.';
  const body = Object.entries(LABEL).flatMap(([k, label]) => {
    const part = rows.filter((r) => r.owner === k);
    return part.length ? [`${label} ${part.length}건`, ...part.map((r) => todoLine(r, now))] : [];
  }).join('\n');
  const late = rows.filter((r) => overdue(r, now)).length;
  const hints = rows.filter((r) => r.doneHint).length;
  const notes = [late && `기한 지남 ${late}건`, hints && `끝난 것 같음 ${hints}건 — 사용자에게 확인하고 닫는다(스스로 닫지 않는다)`].filter(Boolean).join(' · ');
  return `${body}\n${notes ? `${notes}\n` : ''}${UNTRUSTED}`;
}
