import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vault, maskPatterns, maskSpans, residual, normalize } from '../src/mask.js';
import { chunk } from '../src/ner.js';

test('모양으로 아는 개인정보를 가린다', () => {
  const v = new Vault();
  const src = [
    '연락처 010-1234-5678, 01012345678 (같은 번호)',
    '주민번호 900101-1234567, 사업자번호 123-45-67890',
    '계좌 국민 123456-01-123456, 카드 4111 1111 1111 1111',
    '메일 hong@gmail.com, 담당 kim@hecto.co.kr',
    '회사 02-1234-5678, 날짜 2026-10-11, 금액 1,200,000원',
  ].join('\n');
  const out = maskPatterns(src, v, { keepDomains: ['hecto.co.kr'] });
  assert.match(out, /연락처 \[휴대전화1\], \[휴대전화1\]/, '같은 번호는 같은 자리표시');
  assert.match(out, /주민번호 \[주민등록번호1\]/);
  assert.match(out, /사업자번호 123-45-67890/, '사업자등록번호는 둔다');
  assert.match(out, /계좌 국민 \[계좌번호1\]/);
  assert.match(out, /카드 \[카드번호1\]/);
  assert.match(out, /메일 \[이메일1\], 담당 kim@hecto\.co\.kr/);
  assert.match(out, /회사 \[전화번호1\]/);
  assert.match(out, /날짜 2026-10-11, 금액 1,200,000원/, '날짜·금액은 둔다');
  assert.equal(residual(out, { keepDomains: ['hecto.co.kr'] }), 0);
});

test('카드번호처럼 보여도 Luhn 이 틀리면, 주민번호처럼 보여도 날짜가 틀리면 둔다', () => {
  const v = new Vault();
  const out = maskPatterns('주문번호 1234 5678 9012 3456 / 코드 901399-1234567', v);
  assert.equal(out, '주문번호 1234 5678 9012 3456 / 코드 901399-1234567');
});

test('Qwen 이 찾은 이름·주소는 문서 전체에서 같은 자리표시로', () => {
  const v = new Vault();
  const text = '임차인 홍길동은 서울시 강남구 테헤란로 1, 101호에 거주한다. 홍길동의 보증금은 ...';
  const out = maskSpans(text, [
    { type: '이름', text: '홍길동' },
    { type: '주소', text: '서울시 강남구 테헤란로 1, 101호' },
    { type: '이름', text: '없는사람' },
    { type: '이름', text: '[휴대전화1]' },
  ], v);
  assert.equal(out, '임차인 [이름1]은 [주소1]에 거주한다. [이름1]의 보증금은 ...');
  assert.deepEqual(v.summary(), { 이름: 1, 주소: 1 });
});

test('되돌리기는 아는 자리표시만 바꾼다', () => {
  const v = new Vault();
  maskPatterns('010-1111-2222', v);
  maskSpans('김철수', [{ type: '이름', text: '김철수' }], v);
  const { text, restored } = v.restore('[이름1] 님([휴대전화1])께 연락. [이름9]는 모름. [참고] 그대로');
  assert.equal(text, '김철수 님(010-1111-2222)께 연락. [이름9]는 모름. [참고] 그대로');
  assert.equal(restored, 2);
});

test('긴 글은 문단 경계로 자르고 내용을 잃지 않는다', () => {
  const text = Array.from({ length: 200 }, (_, i) => `${i}번째 문단입니다. `.repeat(5)).join('\n');
  const parts = chunk(text, 1000);
  assert.ok(parts.length > 5);
  assert.ok(parts.every((p) => p.length <= 1000));
  assert.equal(parts.join(''), text);
});

test('PDF 줄바꿈으로 끊긴 주소·전화번호도 가린다', () => {
  const v = new Vault();
  const text = '주소 서울특별시 마포\n구 월드컵북로 123, 502호 / 회사 02-\n2187-0000 / 휴대 010-\n2345-6789';
  const first = maskPatterns(text, v);
  const out = maskSpans(first, [{ type: '주소', text: '서울특별시 마포구 월드컵북로 123, 502호' }], v);
  assert.equal(out, '주소 [주소1] / 회사 [전화번호1] / 휴대 [휴대전화1]');
});

test('정규식 특수문자가 든 조각도 글자 그대로 찾는다', () => {
  const v = new Vault();
  assert.equal(maskSpans('담당 (주)홍길동[외] 와 홍.길동', [{ type: '이름', text: '홍.길동' }], v), '담당 (주)홍길동[외] 와 [이름1]');
});

test('검토에서 놓친 형식들 — 전각·줄표·국가번호·괄호·공백·별표·문맥 계좌·Amex', () => {
  const cases = [
    ['０１０－１２３４－５６７８', '[휴대전화1]'],
    ['010–1234–5678', '[휴대전화1]'],
    ['+82-10-1234-5678', '[휴대전화1]'],
    ['+82 10 1234 5678', '[휴대전화1]'],
    ['010)1234-5678', '[휴대전화1]'],
    ['연락처 1023456789', '연락처 [휴대전화1]'], // 010-2345-6789 에서 엑셀이 앞 0 을 지움 (010-1xxx 는 쓰지 않는 번호대)
    ['(02)1234-5678', '[전화번호1]'],
    ['0212345678', '[전화번호1]'],
    ['031-123-4567', '[전화번호1]'],
    ['９００１０１－１２３４５６７', '[주민등록번호1]'],
    ['900101 - 1234567', '[주민등록번호1]'],
    ['900101-1******', '[주민등록번호1]'],
    ['국민은행 110123456789', '국민은행 [계좌번호1]'],
    ['계좌: 110 123 456789', '계좌: [계좌번호1]'],
    ['11-12-123456-12', '[운전면허번호1]'],
    ['면허번호 111212345612', '면허번호 [운전면허번호1]'],
    ['m12345678', '[여권번호1]'],
    ['3782 822463 10005', '[카드번호1]'],
  ];
  for (const [src, want] of cases) assert.equal(maskPatterns(normalize(src), new Vault()), want, src);
});

test('숫자·금액·날짜는 그대로 (지나치게 가리지 않는다)', () => {
  const src = '금액 1000000000원, 1,234,567원, 2026-10-11, 2026.10.11, 사업자 214-86-12345, 수량 120, 버전 1.10.2';
  assert.equal(maskPatterns(normalize(src), new Vault()), src);
});

test('번호류만 숫자로 비교 — 사번·여권은 글자까지 다르면 다른 값', () => {
  const v = new Vault();
  assert.notEqual(v.placeholder('식별번호', 'A1001'), v.placeholder('식별번호', 'B1001'));
  assert.notEqual(v.placeholder('여권번호', 'M12345678'), v.placeholder('여권번호', 'S12345678'));
  assert.equal(v.placeholder('휴대전화', '010-1234-5678'), v.placeholder('휴대전화', '+82 10 1234 5678'));
});

test('자리표시 유형 이름은 한글·영문만, 되돌리기와 맞는다', () => {
  const v = new Vault();
  assert.throws(() => v.placeholder('거래처 명', 'x'), /한글·영문/);
  assert.throws(() => v.placeholder('2차협력사', 'x'), /한글·영문/);
  const ph = v.placeholder('거래처명', '(주)가나다');
  assert.equal(v.restore(`계약 상대 ${ph}`).text, '계약 상대 (주)가나다');
});
