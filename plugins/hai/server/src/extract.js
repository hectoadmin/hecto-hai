/**
 * 로컬 파일 → 텍스트. 원문은 이 프로세스 안에서만 다룬다.
 * 지원: 텍스트류(txt·md·csv·tsv·json·log·html·xml), pdf, docx. hwp·xlsx 는 아직 — PDF·CSV 로 저장해서 쓴다.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const TEXT = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.jsonl', '.log', '.html', '.htm', '.xml', '.yaml', '.yml']);

// 비밀 파일은 HAI 로도 보내지 않는다
const DENY = [/(^|[\\/])\.env(\.|$)/i, /\.(pem|key|p12|pfx|jks|keystore)$/i, /(^|[\\/])id_(rsa|ed25519|ecdsa)/i, /credentials/i, /(^|[\\/])\.ssh[\\/]/, /(^|[\\/])\.aws[\\/]/];

export function resolvePath(p) {
  const s = String(p ?? '').trim();
  if (!s) throw new Error('파일 경로가 비었습니다');
  return path.resolve(s.startsWith('~') ? path.join(os.homedir(), s.slice(1)) : s);
}

export async function readText(p) {
  const file = resolvePath(p);
  if (DENY.some((re) => re.test(file))) throw new Error(`비밀값 파일로 보이는 경로는 읽지 않습니다: ${path.basename(file)}`);
  const st = await fs.stat(file).catch(() => null);
  if (!st?.isFile()) throw new Error(`파일이 없습니다: ${file}`);
  const ext = path.extname(file).toLowerCase();
  let text;
  if (TEXT.has(ext)) {
    text = await fs.readFile(file, 'utf8');
    if (ext === '.html' || ext === '.htm') text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  } else if (ext === '.pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    // 묶은 파일(dist/hai-mcp.mjs) 옆 pdfjs/ 의 CMap·표준 글꼴 — 없으면 한글(CID) 글자가 빠진다. Node 의 pdf.js 는 file:// 이 아니라 경로를 받는다
    const assets = fileURLToPath(new URL('./pdfjs/', import.meta.url));
    const pdf = await getDocumentProxy(new Uint8Array(await fs.readFile(file)), {
      cMapUrl: `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts/`, verbosity: 0 });
    const { text: pages } = await extractText(pdf, { mergePages: false });
    text = pages.map((t, i) => `[${i + 1}쪽]\n${t}`).join('\n\n');
  } else if (ext === '.docx') {
    const mammoth = (await import('mammoth')).default;
    text = (await mammoth.extractRawText({ path: file })).value;
  } else {
    throw new Error(`지원하지 않는 형식입니다(${ext || '확장자 없음'}). txt·md·csv·json·pdf·docx 만 됩니다 — hwp·xlsx 는 PDF·CSV 로 저장해서 쓰세요.`);
  }
  text = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new Error('글자를 찾지 못했습니다(스캔 이미지 PDF 일 수 있습니다)');
  if (text.length > config.maxChars) throw new Error(`파일이 너무 깁니다(${text.length.toLocaleString()}자, 상한 ${config.maxChars.toLocaleString()}자). 나눠서 넣으세요.`);
  return { file, text };
}
