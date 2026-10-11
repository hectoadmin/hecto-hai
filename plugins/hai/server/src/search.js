/**
 * 내 문서 검색 — 폴더의 문서를 조각으로 나눠 HAI 임베딩(KURE, 한국어)으로 색인하고, 질문과 뜻이 가까운 조각을 찾는다.
 * 색인은 ~/.hai-mcp/index/<폴더 해시>.json (600)에 벡터와 조각 위치만 둔다 — 글은 저장하지 않고 찾을 때 파일에서 다시 읽는다.
 * 바뀐 파일(수정 시각·크기)만 다시 색인한다. 이미지·음성은 OCR·받아쓰기가 오래 걸려 media: true 일 때만 넣는다.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { embed } from './hai.js';
import { ensureDataDir } from './ledger.js';
import { readText, SUPPORTED, AUDIO, IMAGE } from './extract.js';

const CHUNK = 700, OVERLAP = 120, MAX_FILES = 400;
const SKIP_DIR = /^(\.|node_modules$|__pycache__$|Library$)/;

const indexPath = async (dir) => path.join(await ensureDataDir(), 'index', `${createHash('sha256').update(dir).digest('hex').slice(0, 16)}.json`);

/** 글 → [{start, end}] 겹치는 조각 */
export function spans(text, size = CHUNK, overlap = OVERLAP) {
  const out = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    const nl = text.lastIndexOf('\n', end);
    if (end < text.length && nl > start + size * 0.5) end = nl; // 줄 끝에서 자른다
    out.push({ start, end });
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out;
}

async function walk(dir, media) {
  const exts = new Set(SUPPORTED.filter((e) => media || (!AUDIO.has(e) && !IMAGE.has(e))));
  const out = [];
  async function go(d) {
    if (out.length >= MAX_FILES) return;
    for (const ent of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (SKIP_DIR.test(ent.name)) continue;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) await go(p);
      else if (ent.isFile() && exts.has(path.extname(ent.name).toLowerCase()) && !ent.name.startsWith('~$')) out.push(p);
      if (out.length >= MAX_FILES) return;
    }
  }
  await go(dir);
  return out;
}

const pack = (v) => Buffer.from(new Float32Array(v).buffer).toString('base64');
const unpack = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na * nb) || 1);
}

/** 색인을 만들거나 바뀐 것만 갱신 → { files, chunks, updated, failed: [{file, why}] } */
export async function buildIndex(dir, { media = false, rebuild = false } = {}) {
  const ip = await indexPath(dir);
  let idx = { dir, files: {} };
  if (!rebuild) try { idx = JSON.parse(await fs.readFile(ip, 'utf8')); } catch { /* 처음 */ }
  const files = await walk(dir, media);
  const keep = new Set(files);
  for (const f of Object.keys(idx.files)) if (!keep.has(f)) delete idx.files[f];
  let updated = 0;
  const failed = [];
  for (const f of files) {
    const st = await fs.stat(f).catch(() => null);
    if (!st) continue;
    const prev = idx.files[f];
    if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) continue;
    try {
      const { text } = await readText(f, { noOcr: !media });
      const parts = spans(text);
      const vecs = await embed(parts.map((s) => text.slice(s.start, s.end)));
      idx.files[f] = { mtime: st.mtimeMs, size: st.size, chunks: parts.map((s, i) => ({ ...s, v: pack(vecs[i]) })) };
      updated++;
    } catch (err) {
      failed.push({ file: f, why: String(err.message).slice(0, 120) });
      delete idx.files[f];
    }
  }
  await fs.mkdir(path.dirname(ip), { recursive: true, mode: 0o700 });
  await fs.writeFile(ip, JSON.stringify(idx), { mode: 0o600 });
  const chunks = Object.values(idx.files).reduce((n, f) => n + f.chunks.length, 0);
  return { idx, files: Object.keys(idx.files).length, chunks, updated, failed };
}

/** 질문과 가까운 조각 top_k → [{file, score, text}] (text 는 원문 — 내보내기 전에 가린다) */
export async function search(dir, query, { topK = 5, media = false, rebuild = false } = {}) {
  const built = await buildIndex(dir, { media, rebuild });
  const [q] = await embed([query]);
  const scored = [];
  for (const [file, f] of Object.entries(built.idx.files)) {
    for (const c of f.chunks) scored.push({ file, start: c.start, end: c.end, score: cosine(q, unpack(c.v)) });
  }
  scored.sort((a, b) => b.score - a.score);
  const hits = [];
  for (const h of scored) {
    if (hits.length >= topK) break;
    if (hits.some((x) => x.file === h.file && Math.abs(x.start - h.start) < CHUNK)) continue; // 같은 자리 겹침 빼기
    let text;
    try { ({ text } = await readText(h.file, { noOcr: !media })); } catch { continue; } // 색인 뒤 지워지거나 바뀐 파일 — 오류(전체 경로 포함)를 내보내지 않고 건너뛴다
    hits.push({ ...h, text: text.slice(h.start, h.end) });
  }
  return { hits, files: built.files, chunks: built.chunks, updated: built.updated, failed: built.failed };
}
