import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// HAI 를 흉내 낸다: 1500자 넘는 조각은 "응답이 잘림"(구조화 실패), 짧으면 그 조각의 이름을 돌려준다
process.env.HAI_API_KEY = 'hai-test';
const seen = [];
mock.method(globalThis, 'fetch', async (url, init) => {
  const body = JSON.parse(init.body);
  const doc = body.messages.at(-1).content;
  seen.push(doc.length);
  const names = [...doc.matchAll(/사람\d+/g)].map((m) => ({ text: m[0], type: '이름' }));
  const content = doc.length > 1500 ? '{"items":[{"text":"사람1","ty' : JSON.stringify({ items: [...names, { text: '거래처가', type: '거래처' }] });
  return new Response(JSON.stringify({ model: 'mock', choices: [{ message: { content }, finish_reason: doc.length > 1500 ? 'length' : 'stop' }] }), { status: 200 });
});
const { findSpans } = await import('../src/ner.js');

test('검토 2차: 잘려서 나눠 다시 물을 때 조각을 하나도 버리지 않는다(셋 이상으로 나뉘어도)', async () => {
  // 문단 길이가 고르지 않아 chunk 가 셋으로 나누는 모양
  const text = [`${'가'.repeat(1100)} 사람1`, `${'나'.repeat(1300)} 사람2`, `${'다'.repeat(200)} 사람3`].join('\n');
  const spans = await findSpans(text, { concurrency: 1 });
  const got = new Set(spans.filter((s) => s.type === '이름').map((s) => s.text));
  assert.deepEqual([...got].sort(), ['사람1', '사람2', '사람3']);
});

test('검토 2차: 모르는 유형으로 와도 버리지 않고 일반 유형으로', async () => {
  const spans = await findSpans('거래처가 사람9 와 계약', {});
  assert.ok(spans.some((s) => s.text === '거래처가' && s.type === '민감정보'));
});
