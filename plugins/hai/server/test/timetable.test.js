import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fillTimetable } from '../src/timetable.js';
import { readXlsx } from '../src/office.js';

// EVS 2026-10 양식 그대로(근무일 20줄, 10/1 ~ 10/30)
const TEMPLATE = fs.readFileSync(new URL('./fixtures/evs-timetable.xlsx', import.meta.url));
const lines = async (buf) => (await readXlsx(buf)).split('\n').slice(2); // 시트 이름·머리글 줄 빼고

test('근무일 줄에 업무·법인 시간을 넣고, 하루 여러 업무면 줄을 늘린다', async () => {
  const r = await fillTimetable(TEMPLATE, [
    { date: '2026-10-01', code: 'ITM_100', name: 'ERP운영관리', detail: 'ERP 문의 접수·처리', hours: { 헥토: 2, 이노: 1.33, 헬스: 4.67 } },
    { date: '2026-10-02', code: 'GA_100', name: '총무업무', detail: '법인차량 반납', hours: { 헥토: 5 } },
    { date: '2026-10-02', code: 'ITM_200', name: 'IT시스템운영관리', detail: '앱 개발 & <테스트>', hours: { 헥토: 3 } },
  ]);
  assert.deepEqual(r.companies, ['헥토', '이노', '파이', '헬스', '데이터', '미디어', '큐앤엠', '드림베이', '월렛원', 'HTA']);
  assert.deepEqual(r.filled, ['2026-10-01', '2026-10-02']);
  assert.equal(r.empty.length, 18);
  assert.deepEqual(r.days.slice(0, 2), [{ date: '2026-10-01', sum: 8 }, { date: '2026-10-02', sum: 8 }]);
  assert.equal(r.totals['헥토'], 10);
  const out = await lines(r.buffer);
  assert.equal(out.length, 21);
  assert.equal(out[0], '1\t2026-10-01\tITM_100\tERP운영관리\tERP 문의 접수·처리\t2\t1.3\t0\t4.7\t0\t0\t0\t0\t0\t0');
  assert.equal(out[1], '2\t2026-10-02\tGA_100\t총무업무\t법인차량 반납\t5\t0\t0\t0\t0\t0\t0\t0\t0\t0');
  assert.equal(out[2], '3\t2026-10-02\tITM_200\tIT시스템운영관리\t앱 개발 & <테스트>\t3\t0\t0\t0\t0\t0\t0\t0\t0\t0');
  assert.equal(out[20].split('\t')[0], '21');
});

test('양식에 없는 날짜·법인 이름은 거절한다', async () => {
  await assert.rejects(fillTimetable(TEMPLATE, [{ date: '2026-10-03', code: 'X', name: 'Y', hours: {} }]), /양식에 없는 날짜/);
  await assert.rejects(fillTimetable(TEMPLATE, [{ date: '2026-10-01', code: 'X', name: 'Y', hours: { 헥토이노베이션: 8 } }]), /법인 "헥토이노베이션"/);
  await assert.rejects(fillTimetable(TEMPLATE, [{ date: '2026-10-01', code: '', name: 'Y', hours: {} }]), /업무코드와 업무명/);
  await assert.rejects(fillTimetable(Buffer.from('not a zip'), []), /./);
});

test('양식이 아니면 칸 내용을 오류에 옮기지 않는다', async () => {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(TEMPLATE);
  const sst = await zip.file('xl/sharedStrings.xml').async('string');
  zip.file('xl/sharedStrings.xml', sst.replace('<t>#</t>', '<t>김비밀 010-1234-5678</t>'));
  const other = await zip.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(fillTimetable(other, [{ date: '2026-10-01', code: 'X', name: 'Y', hours: {} }]), (e) => /양식이 아닙니다/.test(e.message) && !/김비밀|010/.test(e.message));
});
