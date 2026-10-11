/**
 * 가리기 — 모양으로 알 수 있는 것(정규식)은 여기서, 이름·주소처럼 모양으로 모르는 것은 ner.js(Qwen)가 찾은 원문 조각을 받아 바꾼다.
 * 같은 값은 문서 전체에서 같은 자리표시([이름1])로 바뀐다. 원래 값은 Vault(메모리)에만 있고 도구 결과로 나가지 않는다.
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

/** [유형, 정규식, 검사] — 순서가 중요하다(주민번호·카드·전화가 계좌번호보다 먼저) */
export const PATTERNS = [
  ['주민등록번호', /(?<!\d)\d{2}(\d{2})(\d{2})[-\s]?[1-8]\d{6}(?!\d)/g, (m) => validDate(m[1], m[2])],
  ['카드번호', /(?<!\d)\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}(?!\d)/g, (m) => luhn(onlyDigits(m[0]))],
  ['휴대전화', /(?<!\d)01[016789][-.\s]{0,3}\d{3,4}[-.\s]{0,3}\d{4}(?!\d)/g],
  ['전화번호', /(?<!\d)(?:\(0\d{1,2}\)\s?|0(?:2|[3-6][1-5]|70)[-.)\s]{1,3})\d{3,4}[-.\s]{1,3}\d{4}(?!\d)/g],
  ['운전면허번호', /(?<!\d)\d{2}-\d{2}-\d{6}-\d{2}(?!\d)/g],
  ['여권번호', /\b[MSRODG]\d{8}\b|\b[MSRODG]\d{3}[A-Z]\d{4}\b/g],
  ['계좌번호', /(?<![\d-])\d{2,6}-\d{2,6}-\d{2,7}(?:-\d{1,3})?(?![\d-])/g, (m) => {
    const parts = m[0].split('-').map((p) => p.length);
    const n = parts.reduce((a, b) => a + b, 0);
    const bizNo = parts.length === 3 && parts[0] === 3 && parts[1] === 2 && parts[2] === 5; // 사업자등록번호는 회사 정보라 둔다
    return n >= 10 && n <= 16 && !bizNo;
  }],
  ['이메일', /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g],
];

export class Vault {
  constructor() {
    this.id = randomUUID().slice(0, 8);
    this.created = Date.now();
    this.toPlaceholder = new Map(); // `${유형}:${정규화 값}` → [유형N]
    this.toOriginal = new Map();    // [유형N] → 원래 값(처음 본 모양)
    this.count = new Map();         // 유형 → 마지막 번호
  }

  placeholder(type, original) {
    const norm = /번호|전화|휴대/.test(type) ? onlyDigits(original) || original : original.trim().toLowerCase();
    const k = `${type}:${norm}`;
    let ph = this.toPlaceholder.get(k);
    if (!ph) {
      const n = (this.count.get(type) ?? 0) + 1;
      this.count.set(type, n);
      ph = `[${type}${n}]`;
      this.toPlaceholder.set(k, ph);
      this.toOriginal.set(ph, original.trim());
    }
    return ph;
  }

  /** 유형별 가린 개수(서로 다른 값 기준) — 결과에 싣는 건 이것뿐 */
  summary() { return Object.fromEntries(this.count); }

  /** 자리표시를 원래 값으로. 모르는 자리표시는 그대로 둔다 → { text, restored } */
  restore(text) {
    let restored = 0;
    const out = String(text).replace(/\[([^\[\]\d\s]{1,12})(\d{1,4})\]/g, (ph) => {
      const v = this.toOriginal.get(ph);
      if (v === undefined) return ph;
      restored++;
      return v;
    });
    return { text: out, restored };
  }
}

/** 정규식으로 가린다 → 가린 텍스트 (vault 에 기록) */
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
  const chars = [...fragment.replace(/\s+/g, '')].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(chars.join('\\s*'), 'g');
}

/** Qwen 이 찾은 원문 조각을 문서 전체에서 바꾼다(긴 것 먼저). 원문에 실제로 있는 조각만 → 바꾼 텍스트 */
export function maskSpans(text, spans, vault) {
  let out = text;
  const seen = new Set();
  const usable = spans
    .map((s) => ({ type: s.type, text: String(s.text ?? '').trim() }))
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
