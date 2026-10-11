import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskTable, headerType, parseCsvLine } from '../src/table.js';
import { Vault } from '../src/mask.js';

test('머리글로 열 유형을 안다', () => {
  const want = { 성명: '이름', 이름: '이름', 신청자: '이름', 예금주: '이름', '담당자': '이름', 사번: '식별번호', 차량번호: '식별번호', '휴대폰 번호': '전화번호',
    연락처: '전화번호', 'E-mail': '이메일', 주소: '주소', 생년월일: '생년월일', 계좌번호: '계좌번호', 주민등록번호: '주민등록번호',
    부서: null, 금액: null, 등록일: null, 비고: null, 회사명: null, 사업장: null, 회사번호: null,
    회사이름: null, 파일이름: null, 상품명: null, Hotel: null, 메일링동의: null, 대표자: '이름', 계약자명: '이름', '영문 이름': '이름', 'Phone': '전화번호', '수강생': '이름', 고객명: '이름', 교육: null, 계약: null, 대표: null };
  for (const [h, t] of Object.entries(want)) assert.equal(headerType(h), t, h);
});

test('엑셀(탭) — 시트마다 머리글을 다시 찾고 같은 값은 같은 자리표시', () => {
  const v = new Vault();
  const src = '## 시트: 주차\n2026 주차 등록\n사번\t성명\t부서\t차량번호\nH1\t김민준\t총무\t12가3456\nH2\t이서연\t인사\t\n\n## 시트: 요약\n부서\t인원\n총무\t1\n\n## 시트: 담당\n담당자\t부서\n김민준\t총무';
  const { text, columns } = maskTable(src, v, 'tsv');
  assert.equal(text, '## 시트: 주차\n2026 주차 등록\n사번\t성명\t부서\t차량번호\n[식별번호1]\t[이름1]\t총무\t[식별번호2]\n[식별번호3]\t[이름2]\t인사\t\n\n## 시트: 요약\n부서\t인원\n총무\t1\n\n## 시트: 담당\n담당자\t부서\n[이름1]\t총무');
  assert.deepEqual(columns.map((c) => c.type), ['식별번호', '이름', '식별번호', '이름']);
});

test('CSV — 따옴표·쉼표가 든 칸을 지킨다', () => {
  assert.deepEqual(parseCsvLine('"홍, 길동",010-1,"a ""b"""'), ['홍, 길동', '010-1', 'a "b"']);
  const v = new Vault();
  const { text } = maskTable('이름,주소,메모\n"홍, 길동","서울시 마포구 1, 2층","회의, 참석"', v, 'csv');
  assert.equal(text, '이름,주소,메모\n[이름1],[주소1],"회의, 참석"');
});

test('검토 2차: 제목 한 칸 줄은 머리글이 아니다, CSV 따옴표 안 줄바꿈', () => {
  const v = new Vault();
  const { text } = maskTable('## 시트: 명단\n임직원 연락처 명단\n성명\t부서\t연락처\t차량번호\n김민준\t총무\t010-2345-6789\t12가3456', v, 'tsv');
  assert.equal(text, '## 시트: 명단\n임직원 연락처 명단\n성명\t부서\t연락처\t차량번호\n[이름1]\t총무\t[전화번호1]\t[식별번호1]');
  const v2 = new Vault();
  const csv = maskTable('이름,주소,메모\n홍길동,"서울시 마포구\n2층",참석\n김철수,부산,불참', v2, 'csv').text;
  assert.equal(csv, '이름,주소,메모\n[이름1],[주소1],참석\n[이름2],[주소2],불참');
});
