/**
 * 모양으로 모르는 민감정보(사람 이름·주소 등)를 Qwen 이 원문 그대로 뽑는다. 정규식으로 이미 가린 텍스트를 받는다.
 * 한 조각이라도 실패하면 전체를 실패시킨다(fail closed) — 덜 가린 원문이 Claude 로 가지 않게.
 */
import { structured } from './hai.js';
import { looseRegex } from './mask.js';

export const DEFAULT_TYPES = ['이름', '주소', '생년월일', '식별번호'];

const DESCRIBE = {
  이름: '사람 이름(성+이름, 이름만 쓴 호칭 포함). 회사·기관·부서·제품 이름은 제외',
  주소: '집이나 개인 주소(시·구 이하 상세 주소, 동·호수). 회사 소재지라도 상세 주소면 포함',
  생년월일: '개인의 생년월일·나이를 특정하는 날짜',
  식별번호: '사번·학번·회원번호·차량번호처럼 특정 개인을 가리키는 번호',
};

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: { type: 'object', properties: { text: { type: 'string' }, type: { type: 'string' } }, required: ['text', 'type'], additionalProperties: false },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

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

/** types: 찾을 유형 이름 배열. extra: { 유형: 설명 } 사용자가 더한 민감 유형(예: 거래처명) → [{text, type}] */
export async function findSpans(text, { types = DEFAULT_TYPES, extra = {}, concurrency = 3 } = {}) {
  const wanted = [...types.map((t) => [t, DESCRIBE[t] ?? t]), ...Object.entries(extra)];
  const allowed = new Set(wanted.map(([t]) => t));
  const system = [
    '너는 개인정보 비식별화 도구다. 사용자가 준 문서에서 아래 유형에 해당하는 부분을 찾아, 문서에 적힌 글자 그대로 뽑는다.',
    ...wanted.map(([t, d]) => `- ${t}: ${d}`),
    '규칙: 문서에 없는 글자를 만들지 않는다. 고치거나 요약하지 않는다. [휴대전화1] 처럼 대괄호로 이미 가린 부분은 무시한다.',
    '같은 값이 여러 번 나오면 한 번만 쓴다. 해당하는 것이 없으면 빈 배열.',
    `type 은 반드시 다음 중 하나: ${[...allowed].join(', ')}`,
  ].join('\n');

  const parts = chunk(text);
  const results = new Array(parts.length);
  let next = 0;
  async function worker() {
    while (next < parts.length) {
      const i = next++;
      const { data } = await structured({
        name: 'sensitive_spans', schema: SCHEMA, maxTokens: 1500,
        messages: [{ role: 'system', content: system }, { role: 'user', content: `<문서>\n${parts[i]}\n</문서>` }],
      });
      // 문서에 실제로 있는 조각만, 허용 유형만
      results[i] = (data.items ?? []).filter((s) => allowed.has(s.type) && String(s.text).trim() && looseRegex(String(s.text).trim()).test(parts[i]));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, parts.length) }, worker));
  return results.flat();
}
