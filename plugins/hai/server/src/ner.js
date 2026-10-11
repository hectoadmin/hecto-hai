/**
 * 모양으로 모르는 민감정보(사람 이름·주소 등)를 Qwen 이 원문 그대로 뽑는다. 정규식으로 이미 가린 텍스트를 받는다.
 * 한 조각이라도 실패하면 전체를 실패시킨다(fail closed) — 덜 가린 원문이 Claude 로 가지 않게.
 */
import { structured } from './hai.js';
import { looseRegex, TYPE_RE } from './mask.js';

export const DEFAULT_TYPES = ['이름', '주소', '생년월일', '식별번호'];

const DESCRIBE = {
  이름: '사람 이름(성+이름, 이름만 쓴 호칭 포함). 회사·기관·부서·제품 이름은 제외',
  주소: '집이나 개인 주소(시·구 이하 상세 주소, 동·호수). 회사 소재지라도 상세 주소면 포함',
  생년월일: '개인의 생년월일·나이를 특정하는 날짜',
  식별번호: '사번·학번·회원번호·차량번호처럼 특정 개인을 가리키는 번호',
};

/** 유형을 enum 으로 묶는다 — Qwen 이 "성명"·"거래처" 처럼 비슷한 다른 말로 답해 조용히 버려지지 않게 */
const schemaFor = (types) => ({
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: { type: 'object', properties: { text: { type: 'string' }, type: { type: 'string', enum: types } }, required: ['text', 'type'], additionalProperties: false },
    },
  },
  required: ['items'],
  additionalProperties: false,
});
/** 목록에 없는 유형으로 오면 버리지 않고 이 유형으로 가린다 */
export const FALLBACK_TYPE = '민감정보';

/** 문단 경계를 살려 size 근처로 자른다 */
export function chunk(text, size = 3500) {
  const out = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = rest.lastIndexOf(' ', size);
    if (cut < size * 0.5) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * 기본 유형(DEFAULT_TYPES)은 항상 찾는다 — 빼는 옵션을 두면 실수 한 번에 실명이 그대로 나간다.
 * extra: { 유형: 설명 } 사용자가 더한 민감 유형(예: 거래처명·금액) → [{text, type}]
 */
export async function findSpans(text, { extra = {}, concurrency = 3 } = {}) {
  for (const t of Object.keys(extra)) if (!TYPE_RE.test(t)) throw new Error(`더 가릴 유형 이름은 한글·영문 1~12자(띄어쓰기·숫자 없이)여야 합니다: ${JSON.stringify(t)}`);
  const wanted = [...DEFAULT_TYPES.map((t) => [t, DESCRIBE[t]]), ...Object.entries(extra).filter(([t]) => !DEFAULT_TYPES.includes(t))];
  const allowed = new Set(wanted.map(([t]) => t));
  allowed.add(FALLBACK_TYPE);
  const system = [
    '너는 개인정보 비식별화 도구다. 사용자가 준 문서에서 아래 유형에 해당하는 부분을 찾아, 문서에 적힌 글자 그대로 뽑는다.',
    ...wanted.map(([t, d]) => `- ${t}: ${d}`),
    '규칙: 문서에 없는 글자를 만들지 않는다. 고치거나 요약하지 않는다. [휴대전화1] 처럼 대괄호로 이미 가린 부분은 무시한다.',
    '같은 값이 여러 번 나오면 한 번만 쓴다. 해당하는 것이 없으면 빈 배열.',
    `- ${FALLBACK_TYPE}: 위에 딱 맞지 않지만 특정 개인을 알아볼 수 있는 정보`,
    `type 은 반드시 다음 중 하나: ${[...allowed].join(', ')}`,
  ].join('\n');

  // 조각 하나가 실패(응답이 잘림·JSON 깨짐)하면 반으로 나눠 다시 — 이름이 빽빽한 명단은 답이 길어 잘리기 쉽다. 600자까지 줄여도 실패면 전체 실패
  async function spansOf(part) {
    try {
      const { data } = await structured({
        name: 'sensitive_spans', schema: schemaFor([...allowed]), maxTokens: 6000, timeoutMs: 290_000,
        messages: [{ role: 'system', content: system }, { role: 'user', content: `<문서>\n${part}\n</문서>` }],
      });
      // 문서에 실제로 있는 조각만, 허용 유형만
      return (data.items ?? [])
        .filter((s) => String(s.text ?? '').trim() && looseRegex(String(s.text).trim()).test(part))
        .map((s) => (allowed.has(s.type) ? s : { ...s, type: FALLBACK_TYPE }));
    } catch (err) {
      if (err.code !== 'HAI_FAILED' || part.length < 1200) throw err;
      // chunk 는 셋 이상으로 나눌 수 있다 — 하나라도 빠뜨리면 그 부분의 이름이 가려지지 않은 채 나간다
      const out = [];
      for (const piece of chunk(part, Math.ceil(part.length / 2) + 50)) out.push(...await spansOf(piece));
      return out;
    }
  }

  const parts = chunk(text, 3000);
  const results = new Array(parts.length);
  let next = 0;
  async function worker() {
    while (next < parts.length) {
      const i = next++;
      results[i] = await spansOf(parts[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, parts.length) }, worker));
  return results.flat();
}
