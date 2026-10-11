/**
 * 가리기 — 모양으로 알 수 있는 것(정규식)은 여기서, 이름·주소처럼 모양으로 모르는 것은 ner.js(Qwen)가 찾은 원문 조각을 받아 바꾼다.
 * 같은 값은 문서 전체에서 같은 자리표시([이름1])로 바뀐다. 원래 값은 Vault(메모리)에만 있고 도구 결과로 나가지 않는다.
 * 넣기 전에 normalize() 로 전각 숫자·여러 가지 줄표를 보통 글자로 바꾼다 — "０１０－１２３４" 도 걸리게.
 */
import { randomUUID } from 'node:crypto';

const luhn = (digits) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
};
const onlyDigits = (s) => s.replace(/\D/g, '');
const validDate = (mm, dd) => +mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31;

/** 전각 → 반각(NFKC), 여러 가지 줄표·빼기 → '-' */
export const normalize = (s) => String(s ?? '').normalize('NFKC').replace(/[‐-―−﹘﹣－]/g, '-');

const SEP = String.raw`\s*[-.)]?\s*`;            // 010-1234 · 010.1234 · 010)1234 · 010 1234 · 010 - 1234
const SEP1 = String.raw`(?:\s*[-.)]\s*|\s+)`;    // 구분자가 꼭 있어야 하는 자리
const CTX_ACCOUNT = '(?:계좌|은행|입금|송금|예금주?|통장|account|bank)';

/** [유형, 정규식, 검사] — 순서가 중요하다(주민번호·카드·전화가 계좌번호보다 먼저) */
export const PATTERNS = [
  ['이메일', /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g],
  // 생년월일 6자리 + 뒷자리 7자리(뒷자리 일부를 * 로 가린 것도 — 생년월일·성별이 드러난다)
  ['주민등록번호', new RegExp(String.raw`(?<![\d*])\d{2}(\d{2})(\d{2})\s*-?\s*[1-8][\d*]{6}(?![\d*])`, 'g'), (m) => validDate(m[1], m[2])],
  ['카드번호', new RegExp(String.raw`(?<!\d)(?:\d{4}${SEP}\d{4}${SEP}\d{4}${SEP}\d{4}|3[47]\d{2}${SEP}\d{6}${SEP}\d{5})(?!\d)`, 'g'), (m) => luhn(onlyDigits(m[0]))],
  // +82 10-…, 010-…, 엑셀이 앞 0 을 지운 10xxxxxxxx
  ['휴대전화', new RegExp(String.raw`(?<![\d+])(?:\+?\s*82${SEP}0?1[016789]|01[016789])${SEP}\d{3,4}${SEP}\d{4}(?!\d)|(?<![\d.,])10[2-9]\d{7}(?![\d.,])`, 'g')],
  ['전화번호', new RegExp(String.raw`(?<![\d+])(?:\+?\s*82${SEP}0?|\(0|0)(?:2|[3-6][1-5]|70)(?:\)\s*|${SEP})\d{3,4}${SEP}\d{4}(?!\d)`, 'g'), (m) => { const n = onlyDigits(m[0]).replace(/^82/, '0'); return n.length >= 9 && n.length <= 11; }],
  ['운전면허번호', new RegExp(String.raw`(?<!\d)\d{2}${SEP1}\d{2}${SEP1}\d{6}${SEP1}\d{2}(?!\d)|(?<=면허[^\n\d]{0,15})\d{12}(?!\d)`, 'g')],
  ['여권번호', /\b[MSRODG]\d{8}\b|\b[MSRODG]\d{3}[A-Z]\d{4}\b/gi],
  ['계좌번호', /(?<![\d-])\d{2,6}\s*-\s*\d{2,6}\s*-\s*\d{2,7}(?:\s*-\s*\d{1,3})?(?![\d-])/g, (m) => {
    const parts = m[0].split('-').map((p) => p.trim().length);
    const n = parts.reduce((a, b) => a + b, 0);
    const bizNo = parts.length === 3 && parts[0] === 3 && parts[1] === 2 && parts[2] === 5; // 사업자등록번호는 회사 정보라 둔다
    return n >= 10 && n <= 16 && !bizNo;
  }],
  // 하이픈 없는 계좌: "국민은행 110123456789", "계좌 110 123 456789" 처럼 앞에 계좌·은행 말이 있을 때만
  ['계좌번호', new RegExp(String.raw`(?<=${CTX_ACCOUNT}[^\n\d]{0,20})\d(?:[\d ]{8,18})\d(?![\d-])`, 'gi'), (m) => { const n = onlyDigits(m[0]).length; return n >= 10 && n <= 16; }],
];

/** 자리표시 유형 이름: 한글·영문 1~12자만 (공백·숫자가 있으면 되돌리기 정규식과 어긋난다) */
export const TYPE_RE = /^[가-힣A-Za-z]{1,12}$/;
const NUMERIC_TYPES = new Set(['주민등록번호', '카드번호', '휴대전화', '전화번호', '운전면허번호', '계좌번호']);

export class Vault {
  constructor() {
    this.id = randomUUID().slice(0, 8);
    this.created = Date.now();
    this.toPlaceholder = new Map(); // `${유형}:${정규화 값}` → [유형N]
    this.toOriginal = new Map();    // [유형N] → 원래 값(처음 본 모양)
    this.count = new Map();         // 유형 → 마지막 번호
  }

  placeholder(type, original) {
    if (!TYPE_RE.test(type)) throw new Error(`가릴 유형 이름은 한글·영문 1~12자여야 합니다: ${JSON.stringify(type)}`);
    const v = String(original).trim();
    // 숫자로만 비교해도 되는 건 번호류뿐 — 사번 A1001·B1001, 여권 M…·S… 은 다른 값이다
    const norm = NUMERIC_TYPES.has(type) ? onlyDigits(v).replace(/^82/, '0') || v : v.replace(/\s+/g, ' ').toLowerCase();
    const k = `${type}:${norm}`;
    let ph = this.toPlaceholder.get(k);
    if (!ph) {
      const n = (this.count.get(type) ?? 0) + 1;
      this.count.set(type, n);
      ph = `[${type}${n}]`;
      this.toPlaceholder.set(k, ph);
      this.toOriginal.set(ph, v);
    }
    return ph;
  }

  /** 유형별 가린 개수(서로 다른 값 기준) — 결과에 싣는 건 이것뿐 */
  summary() { return Object.fromEntries(this.count); }

  /** 자리표시를 원래 값으로. 모르는 자리표시는 그대로 둔다 → { text, restored } */
  restore(text) {
    let restored = 0;
    const out = String(text).replace(/\[([가-힣A-Za-z]{1,12})(\d{1,5})\]/g, (ph) => {
      const v = this.toOriginal.get(ph);
      if (v === undefined) return ph;
      restored++;
      return v;
    });
    return { text: out, restored };
  }
}

/** 정규식으로 가린다 → 가린 텍스트 (vault 에 기록). text 는 normalize() 를 거친 것 */
export function maskPatterns(text, vault, { keepDomains = [] } = {}) {
  const keep = new Set(keepDomains);
  let out = String(text ?? '');
  for (const [type, re, check] of PATTERNS) {
    out = out.replace(re, (...args) => {
      const m = [args[0], ...args.slice(1, -2)];
      if (check && !check(m)) return args[0];
      if (type === '이메일' && keep.has(String(m[1]).toLowerCase())) return args[0];
      return vault.placeholder(type, args[0]);
    });
  }
  return out;
}

/** 조각 글자 사이에 공백·줄바꿈이 끼어도 찾는 정규식 — PDF 는 "서울특별시 마포\n구 …" 처럼 줄이 단어 중간에서 끊긴다 */
export function looseRegex(fragment) {
  const chars = [...normalize(fragment).replace(/\s+/g, '')].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(chars.join('\\s*'), 'g');
}

/** Qwen 이 찾은 원문 조각을 문서 전체에서 바꾼다(긴 것 먼저). 원문에 실제로 있는 조각만 → 바꾼 텍스트 */
export function maskSpans(text, spans, vault) {
  let out = text;
  const seen = new Set();
  const usable = spans
    .map((s) => ({ type: s.type, text: normalize(s.text).trim() }))
    .filter((s) => s.text.replace(/\s/g, '').length >= 2 && s.text.length <= 80 && !/[\[\]]/.test(s.text) && !seen.has(s.text) && seen.add(s.text))
    .sort((a, b) => b.text.length - a.text.length);
  for (const s of usable) {
    const re = looseRegex(s.text);
    if (!re.test(out)) continue;
    re.lastIndex = 0;
    const ph = vault.placeholder(s.type, s.text.replace(/\s*\n\s*/g, ''));
    out = out.replace(re, ph);
  }
  return out;
}

/** 가린 뒤에도 정규식에 걸리는 게 남았는지 (있으면 버그) → 개수 */
export function residual(text, { keepDomains = [] } = {}) {
  const keep = new Set(keepDomains);
  let n = 0;
  for (const [type, re, check] of PATTERNS) {
    for (const m of String(text).matchAll(re)) {
      if (check && !check(m)) continue;
      if (type === '이메일' && keep.has(String(m[1]).toLowerCase())) continue;
      n++;
    }
  }
  return n;
}
