import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.HAI_API_KEY = 'hai-test';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('그림')]);
const sent = [];
mock.method(globalThis, 'fetch', async (url, init) => {
  const u = String(url);
  if (u.endsWith('/layout-parsing/async')) {
    const f = init.body.get('file');
    sent.push({ name: f.name, bytes: Buffer.from(await f.arrayBuffer()) });
    return new Response(JSON.stringify({ result: { jobId: 'job-12345678' } }), { status: 200 });
  }
  if (u.includes('/layout-parsing/async/job-12345678/result')) {
    return new Response(JSON.stringify({ errorCode: 0, result: { layoutParsingResults: [{ markdown: { text: '| 품목 | 금액 |\n| 복사지 | 50,000 |  \n\n\n\n끝' } }] } }), { status: 200 });
  }
  return new Response('{}', { status: 404 });
});

const { decodeOutput } = await import('../src/clipboard.js');
const { readClipboard } = await import('../src/extract.js');

test('클립보드 출력: 그림 없음·빈 출력은 null, PNG 가 아니면 거절', () => {
  assert.equal(decodeOutput('NO_IMAGE'), null);
  assert.equal(decodeOutput('  \r\n'), null);
  assert.deepEqual(decodeOutput(`${PNG.toString('base64')}\r\n`), PNG);
  assert.throws(() => decodeOutput(Buffer.from('GIF89a').toString('base64')), /PNG/);
});

test('클립보드 캡처: 파일 없이 그림 바이트를 그대로 OCR 에 보내고, 같은 그림은 다시 OCR 하지 않는다', async () => {
  const img = { data: PNG, name: '클립보드 캡처 20261102-170000.png' };
  const r = await readClipboard(img);
  assert.equal(r.file, img.name);
  assert.equal(r.via, 'ocr');
  assert.equal(r.text, '| 품목 | 금액 |\n| 복사지 | 50,000 |\n\n끝');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].name, img.name);
  assert.deepEqual(sent[0].bytes, PNG);
  await readClipboard({ data: Buffer.from(PNG), name: '다른 이름.png' });
  assert.equal(sent.length, 1);
});
