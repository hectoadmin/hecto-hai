import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readText, decode, toWav } from '../src/extract.js';
import { excelDate } from '../src/office.js';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hai-test-'));
const put = async (name, data) => { const p = path.join(tmp, name); await fs.writeFile(p, data); return p; };

test('엑셀: 시트·문자·숫자·날짜·빈칸 위치를 살린다, 숨긴 시트는 뺀다', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('배차');
  ws.addRow(['번호', '신청자', '연락처', '사용일', '금액']);
  ws.addRow([1, '홍길동', '010-1234-5678', new Date(Date.UTC(2026, 9, 11)), 120000]);
  ws.getCell('D2').numFmt = 'yyyy-mm-dd';
  ws.getCell('B3').value = '빈칸 뒤';
  ws.getCell('E3').value = { richText: [{ text: '굵게' }, { text: '&<특수>' }] };
  const hidden = wb.addWorksheet('숨김'); hidden.state = 'hidden'; hidden.addRow(['보이면 안 됨']);
  const p = await put('a.xlsx', Buffer.from(await wb.xlsx.writeBuffer()));
  const { text } = await readText(p);
  assert.match(text, /## 시트: 배차/);
  assert.match(text, /1\t홍길동\t010-1234-5678\t2026-10-11\t120000/);
  assert.match(text, /\t빈칸 뒤\t\t\t굵게&<특수>/);
  assert.doesNotMatch(text, /보이면 안 됨/);
});

test('엑셀 날짜 일련번호', () => {
  assert.equal(excelDate(46306), '2026-10-11');
  assert.equal(excelDate(46306.5), '2026-10-11 12:00');
});

test('한글(hwpx): 문단 순서대로, 표 안 글자도', async () => {
  const zip = new JSZip();
  zip.file('mimetype', 'application/hwp+zip');
  zip.file('Contents/section1.xml', '<hs:sec><hp:p><hp:run><hp:t>둘째 구역</hp:t></hp:run></hp:p></hs:sec>');
  zip.file('Contents/section0.xml', '<hs:sec><hp:p id="1"><hp:run><hp:t>제1조 임대인</hp:t><hp:t> 김철수 &amp; 이영희</hp:t></hp:run></hp:p>'
    + '<hp:p><hp:run><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>표 칸</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p></hs:sec>');
  const p = await put('b.hwpx', await zip.generateAsync({ type: 'nodebuffer' }));
  const { text } = await readText(p);
  assert.equal(text, '제1조 임대인 김철수 & 이영희\n표 칸\n둘째 구역');
});

test('CSV: UTF-8(BOM)과 EUC-KR 둘 다', async () => {
  assert.equal(decode(Buffer.from('﻿이름,연락처', 'utf8')), '이름,연락처');
  const euckr = Buffer.from([0xc0, 0xcc, 0xb8, 0xa7, 0x2c, 0xbf, 0xac, 0xb6, 0xf4, 0xc3, 0xb3]); // "이름,연락처"
  assert.equal(decode(euckr), '이름,연락처');
  const { text } = await readText(await put('c.csv', euckr));
  assert.equal(text, '이름,연락처');
});

test('옛 형식·비밀 파일은 거절한다', async () => {
  await assert.rejects(readText(await put('d.hwp', 'x')), /옛 형식/);
  await assert.rejects(readText(await put('.env', 'K=V')), /비밀값/);
  await assert.rejects(readText(await put('id_rsa', 'x')), /비밀값/);
});

test('원문 장부: 동시에 여러 개를(다른 프로세스에서도) 올려도 하나도 잃지 않는다', async () => {
  process.env.HAI_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'hai-ledger-'));
  const { addRaw, rawFiles } = await import(`../src/ledger.js?${Date.now()}`);
  const { config } = await import('../src/config.js');
  config.dataDir = process.env.HAI_DATA_DIR;
  await Promise.all(Array.from({ length: 20 }, (_, i) => addRaw(path.join(tmp, `raw-${i}.txt`))));
  // 다른 프로세스 둘이 100개씩 동시에
  const { spawn } = await import('node:child_process');
  const script = `import('${new URL('../src/ledger.js', import.meta.url).href}').then(async ({ addRaw }) => { await Promise.all(Array.from({ length: 100 }, (_, i) => addRaw('${tmp}/p' + process.argv[1] + '-' + i))); })`;
  await Promise.all(['a', 'b'].map((tag) => new Promise((res, rej) => spawn(process.execPath, ['-e', script, tag], { env: process.env, stdio: 'inherit' }).on('exit', (c) => (c ? rej(new Error(`exit ${c}`)) : res())))));
  assert.equal((await rawFiles()).length, 220);
});

test('검토 2차: UTF-16 텍스트(엑셀 "유니코드 텍스트")', async () => {
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('이름\t연락처\n홍길동\t010-2345-6789', 'utf16le')]);
  assert.equal(decode(le), '이름\t연락처\n홍길동\t010-2345-6789');
  const { text, table } = await readText(await put('u16.txt', le));
  assert.equal(text, '이름\t연락처\n홍길동\t010-2345-6789');
  assert.equal(table, undefined);
});

// macOS·Windows 는 기본 내장 도구로, 그 밖은 ffmpeg 가 있을 때만
const canConvert = process.platform === 'darwin' || process.platform === 'win32' || (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
test('음성 변환: m4a → 16kHz 모노 wav (macOS afconvert · Windows 기본 미디어 엔진 · ffmpeg)', { skip: !canConvert && 'ffmpeg 없음' }, async () => {
  const out = await toWav(fileURLToPath(new URL('./fixtures/hello.m4a', import.meta.url)));
  try {
    const b = await fs.readFile(out);
    assert.equal(b.toString('latin1', 0, 4), 'RIFF');
    let i = 12, fmt = null;
    while (i + 8 <= b.length && !fmt) { const id = b.toString('latin1', i, i + 4); const n = b.readUInt32LE(i + 4); if (id === 'fmt ') fmt = i + 8; i += 8 + n + (n % 2); }
    assert.ok(fmt, 'fmt 조각 없음');
    assert.equal(b.readUInt16LE(fmt + 2), 1, '모노');
    assert.equal(b.readUInt32LE(fmt + 4), 16000, '16kHz');
    assert.ok(b.length > 20000, `너무 짧음 ${b.length}`);
  } finally { await fs.rm(out, { force: true }); }
});
