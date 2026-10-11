/**
 * 로컬 파일 → 텍스트. 원문은 이 프로세스 안에서만 다룬다.
 *   텍스트류(txt·md·csv·tsv·json·log·html·xml — UTF-8 아니면 EUC-KR), docx, xlsx, hwpx
 *   pdf     글자층이 있으면 그대로, 스캔본(글자가 거의 없음)이면 HAI OCR
 *   이미지  HAI OCR (png·jpg·tif·bmp·webp)
 *   음성    HAI 받아쓰기 (wav·mp3·ogg·flac 은 그대로, m4a·aac·aiff·caf·mp4·mov 는 macOS afconvert/ffmpeg 로 wav 변환)
 * OCR·받아쓰기 결과는 같은 파일(경로·수정 시각·크기)이면 메모리에 두고 다시 쓴다 — 가리기 → 묻기를 이어서 해도 한 번만 돈다.
 * 옛 한글(.hwp)·옛 엑셀(.xls)·옛 워드(.doc)는 못 읽는다 — 새 형식이나 PDF 로 저장해서 쓴다.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { readXlsx, readHwpx } from './office.js';
import { ocr, transcribe, HaiError } from './hai.js';
import { ensureDataDir } from './ledger.js';

const run = promisify(execFile);
const TEXT = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.jsonl', '.log', '.html', '.htm', '.xml', '.yaml', '.yml']);
export const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp']);
const AUDIO_OK = new Set(['.wav', '.mp3', '.ogg', '.flac']);
const AUDIO_CONVERT = new Set(['.m4a', '.aac', '.aiff', '.aif', '.caf', '.mp4', '.mov', '.wma', '.webm', '.amr', '.3gp']);
export const AUDIO = new Set([...AUDIO_OK, ...AUDIO_CONVERT]);
export const SUPPORTED = [...TEXT, '.pdf', '.docx', '.xlsx', '.xlsm', '.hwpx', ...IMAGE, ...AUDIO];

// 비밀 파일은 HAI 로도 보내지 않는다
const DENY = [/(^|[\\/])\.env(\.|$)/i, /\.(pem|key|p12|pfx|jks|keystore|kdbx)$/i, /(^|[\\/])id_(rsa|ed25519|ecdsa)/i, /credentials/i, /(^|[\\/])\.ssh[\\/]/, /(^|[\\/])\.aws[\\/]/, /(^|[\\/])\.gnupg[\\/]/, /Keychains[\\/]/];

/** UTF-16(BOM — 엑셀 "유니코드 텍스트"·메모장 유니코드) → UTF-8(BOM 포함) → 아니면 EUC-KR(CP949, 엑셀 "CSV 로 저장") */
export function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch { return new TextDecoder('euc-kr').decode(buf); }
}

export function resolvePath(p) {
  const s = String(p ?? '').trim();
  if (!s) throw new Error('파일 경로가 비었습니다');
  return path.resolve(s.startsWith('~') ? path.join(os.homedir(), s.slice(1)) : s);
}

export const kindOf = (file) => {
  const ext = path.extname(file).toLowerCase();
  return AUDIO.has(ext) ? 'audio' : IMAGE.has(ext) ? 'image' : ext === '.pdf' ? 'pdf' : 'doc';
};

const cache = new Map(); // `${경로}|${mtime}|${size}|${옵션}` → { text, via, meta }

/**
 * → { file, text, via: 'text'|'ocr'|'stt', meta, table?: 'csv'|'tsv' (표라서 열 단위로 가릴 수 있음) }
 * opts: { ocr: true 면 PDF 도 강제로 OCR, noOcr: true 면 PDF 스캔 쪽 OCR 을 건너뜀(색인용), engine/terms: 받아쓰기 옵션, timestamps: 받아쓰기에 [mm:ss] 붙이기 }
 */
export async function readText(p, opts = {}) {
  const file = resolvePath(p);
  if (DENY.some((re) => re.test(file))) throw new Error(`비밀값 파일로 보이는 경로는 읽지 않습니다: ${path.basename(file)}`);
  const st = await fs.stat(file).catch(() => null);
  if (!st?.isFile()) throw new Error(`파일이 없습니다: ${file}`);
  const key = `${file}|${st.mtimeMs}|${st.size}|${opts.ocr ? 1 : opts.noOcr ? 2 : 0}|${opts.engine ?? ''}|${opts.terms ?? ''}|${opts.timestamps ? 1 : 0}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = await extract(file, st, opts);
    hit.text = hit.text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!hit.text) throw new Error(hit.via === 'stt' ? '음성에서 말소리를 찾지 못했습니다' : '글자를 찾지 못했습니다');
    if (hit.text.length > config.maxChars) throw new Error(`내용이 너무 깁니다(${hit.text.length.toLocaleString()}자, 상한 ${config.maxChars.toLocaleString()}자). 나눠서 넣으세요.`);
    cache.set(key, hit);
    if (cache.size > 50) cache.delete(cache.keys().next().value);
  }
  return { file, ...hit };
}

async function extract(file, st, opts) {
  const ext = path.extname(file).toLowerCase();
  if (TEXT.has(ext)) {
    let text = decode(await fs.readFile(file));
    if (ext === '.html' || ext === '.htm') text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
    return { text, via: 'text', table: ext === '.csv' ? 'csv' : ext === '.tsv' ? 'tsv' : undefined };
  }
  if (ext === '.docx') {
    const mammoth = (await import('mammoth')).default;
    return { text: (await mammoth.extractRawText({ path: file })).value, via: 'text' };
  }
  if (ext === '.xlsx' || ext === '.xlsm') return { text: await readXlsx(await fs.readFile(file)), via: 'text', table: 'tsv' };
  if (ext === '.hwpx') return { text: await readHwpx(await fs.readFile(file)), via: 'text' };
  if (ext === '.pdf') {
    if (opts.ocr) return ocrPages(file);
    const { texts: pages, imageOnly } = await pdfPages(file);
    // OCR 할 쪽: 글자가 거의 없고 그림(스캔)이 있는 쪽 — 표지 한 줄·쪽번호만 있는 쪽 때문에 문서 전체를 OCR 하지 않게
    const scan = imageOnly.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    if (!scan.length) return { text: joinPages(pages), via: 'text', meta: { pages: pages.length } };
    if (opts.noOcr) { // 검색 색인 등: 오래 걸리는 OCR 은 건너뛰고 알린다
      for (const i of scan) pages[i] = '(스캔 쪽 — 읽지 않음)';
      return { text: joinPages(pages), via: 'text', meta: { pages: pages.length, skippedScan: scan.length } };
    }
    if (scan.length === pages.length) return ocrPages(file); // 전부 스캔
    // 섞인 PDF(표지·서명면만 글자, 본문은 스캔) — 스캔 쪽만 OCR 결과로 채운다
    try {
      const scanned = await ocr(file);
      if (scanned.length === pages.length) {
        for (const i of scan) pages[i] = scanned[i];
        return { text: joinPages(pages), via: 'ocr', meta: { pages: pages.length, ocrPages: scan.length } };
      }
    } catch { /* 아래에서 알린다 */ }
    for (const i of scan) pages[i] = '(이 쪽은 스캔 이미지라 글자를 읽지 못했습니다)';
    return { text: joinPages(pages), via: 'text', meta: { pages: pages.length } };
  }
  if (IMAGE.has(ext)) return ocrPages(file);
  if (AUDIO.has(ext)) {
    if (st.size > 200 * 1024 * 1024) throw new Error('음성 파일이 200MB 를 넘습니다. 나눠서 넣으세요(최대 60분).');
    const wav = AUDIO_OK.has(ext) ? null : await toWav(file);
    try {
      const r = await transcribe(wav ?? file, { engine: opts.engine, terms: opts.terms, timestamps: opts.timestamps });
      const text = opts.timestamps && r.segments?.length
        ? r.segments.map((s) => `[${mmss(s.start)}] ${String(s.text).trim()}`).join('\n')
        : r.text;
      return { text, via: 'stt', meta: { seconds: r.seconds, engine: opts.engine ?? 'whisper' } };
    } finally { if (wav) await fs.rm(wav, { force: true }); }
  }
  if (['.hwp', '.xls', '.doc', '.ppt'].includes(ext)) {
    throw new Error(`옛 형식(${ext})은 읽지 못합니다. 한글은 hwpx 나 PDF 로, 엑셀은 xlsx 로, 워드는 docx 로 "다른 이름으로 저장"해서 쓰세요.`);
  }
  throw new Error(`지원하지 않는 형식입니다(${ext || '확장자 없음'}). 됩니다: 문서 txt·md·csv·json·pdf·docx·xlsx·hwpx / 이미지 png·jpg / 음성 wav·mp3·m4a 등`);
}

/** → { texts: 쪽별 글자, imageOnly: 쪽별 "글자는 거의 없고 그림이 있음"(스캔 쪽) } */
async function pdfPages(file) {
  const { extractText, getDocumentProxy, getResolvedPDFJS } = await import('unpdf');
  // 묶은 파일(dist/hai-mcp.mjs) 옆 pdfjs/ 의 CMap·표준 글꼴 — 없으면 한글(CID) 글자가 빠진다. Node 의 pdf.js 는 file:// 이 아니라 경로를 받는다
  const assets = fileURLToPath(new URL('./pdfjs/', import.meta.url));
  const pdf = await getDocumentProxy(new Uint8Array(await fs.readFile(file)), {
    cMapUrl: `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts/`, verbosity: 0 });
  try {
    const texts = (await extractText(pdf, { mergePages: false })).text;
    const { OPS } = await getResolvedPDFJS();
    const IMG = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat].filter((x) => x !== undefined));
    const imageOnly = [];
    for (let i = 0; i < texts.length; i++) {
      if (texts[i].replace(/\s/g, '').length >= 20) { imageOnly.push(false); continue; }
      const ops = await (await pdf.getPage(i + 1)).getOperatorList();
      imageOnly.push(ops.fnArray.some((f) => IMG.has(f)));
    }
    return { texts, imageOnly };
  } finally { await pdf.destroy?.(); }
}

const joinPages = (pages) => pages.map((t, i) => `[${i + 1}쪽]\n${t}`).join('\n\n');

async function ocrPages(file) {
  const pages = await ocr(file);
  return { text: pages.length > 1 ? pages.map((t, i) => `[${i + 1}쪽]\n${t}`).join('\n\n') : (pages[0] ?? ''), via: 'ocr', meta: { pages: pages.length } };
}

/** HAI 가 받지 않는 음성(m4a 등) → 16kHz 모노 wav. macOS 는 기본 내장 afconvert, 그 밖은 ffmpeg */
async function toWav(file) {
  const dir = path.join(await ensureDataDir(), 'tmp');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const out = path.join(dir, `${randomUUID()}.wav`); // 여러 파일을 동시에 받아쓸 때 겹치지 않게
  const tries = [];
  if (os.platform() === 'darwin') tries.push(['afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', file, out]]);
  tries.push(['ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '16000', out]]);
  for (const [cmd, args] of tries) {
    try { await run(cmd, args, { timeout: 300_000 }); return out; } catch { /* 다음 */ }
  }
  await fs.rm(out, { force: true });
  throw new HaiError('HAI_BAD_INPUT', `${path.extname(file)} 음성을 변환하지 못했습니다. wav·mp3 로 저장해서 넣거나 ffmpeg 를 설치하세요.`);
}

const mmss = (sec) => { const s = Math.floor(Number(sec) || 0); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
