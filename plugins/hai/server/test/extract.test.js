import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { readText, decode } from '../src/extract.js';
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

test('원문 장부: 동시에 여러 개를 올려도 하나도 잃지 않는다', async () => {
  process.env.HAI_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'hai-ledger-'));
  const { addRaw, rawFiles } = await import(`../src/ledger.js?${Date.now()}`);
  const { config } = await import('../src/config.js');
  config.dataDir = process.env.HAI_DATA_DIR;
  await Promise.all(Array.from({ length: 20 }, (_, i) => addRaw(path.join(tmp, `raw-${i}.txt`))));
  assert.equal((await rawFiles()).length, 20);
});
