/**
 * 원문 파일 장부 — 이 플러그인이 디스크에 쓴 "가리지 않은" 파일(받아쓰기·OCR 결과, 실명으로 되돌린 결과물)의 경로.
 * hooks/guard.mjs 가 같은 파일을 읽어 Claude 가 이 파일들을 Read·Grep·Bash 로 열지 못하게 막는다.
 * 위치는 ~/.hai-mcp/raw-files.log 로 고정(훅은 MCP 환경변수를 못 받는다). 한 줄에 경로 하나, 덧붙이기만 한다 —
 * 짧은 append 는 프로세스끼리도 섞이지 않아 Claude 세션 여럿이 동시에 써도 잃지 않는다(읽고-고쳐-쓰기는 잃었다).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

export const LEDGER = () => path.join(config.dataDir, 'raw-files.log');

export async function ensureDataDir() {
  await fs.mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  return config.dataDir;
}

export async function rawFiles() {
  try { return [...new Set((await fs.readFile(LEDGER(), 'utf8')).split('\n').filter(Boolean))]; } catch { return []; }
}

/** 심볼릭 링크를 푼 경로(/tmp → /private/tmp) — 훅이 realpath 로 비교한다. 파일이 아직 없으면 폴더만 푼다 */
async function realish(file) {
  const abs = path.resolve(file);
  try { return await fs.realpath(abs); } catch { /* 아직 없음 */ }
  try { return path.join(await fs.realpath(path.dirname(abs)), path.basename(abs)); } catch { return abs; }
}

export async function addRaw(file) {
  await ensureDataDir();
  const p = (await realish(file)).replace(/\n/g, ' ');
  await fs.appendFile(LEDGER(), `${p}\n`, { mode: 0o600 });
}

/** 같은 이름이 있으면 " (2)" 를 붙인 새 경로 */
export async function freePath(p) {
  const { dir, name, ext } = path.parse(p);
  for (let i = 1; ; i++) {
    const cand = i === 1 ? p : path.join(dir, `${name} (${i})${ext}`);
    try { await fs.access(cand); } catch { return cand; }
  }
}

/** 원문을 쓰고 장부에 올린다(600). overwrite 가 아니면 겹치지 않는 이름으로 → 실제 경로 */
export async function writeRaw(p, text, { overwrite = false } = {}) {
  const target = overwrite ? p : await freePath(p);
  await fs.mkdir(path.dirname(target), { recursive: true }); // 폴더부터 만들어야 realpath 로 장부에 올릴 수 있다
  await addRaw(target); // 쓰기 전에 장부부터 — 쓰는 사이에 Claude 가 읽지 못하게
  await fs.writeFile(target, text, { mode: 0o600 });
  return target;
}

/** 가린 결과(긴 것)를 둘 곳 — Claude 가 읽어도 되는 파일 */
export async function writeMasked(name, text) {
  const dir = path.join(await ensureDataDir(), 'masked');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const p = path.join(dir, name.replace(/[\\/:*?"<>|]/g, '_'));
  await fs.writeFile(p, text, { mode: 0o600 });
  return p;
}
