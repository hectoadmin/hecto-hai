/**
 * HAI 게이트웨이 클라이언트 — {base}/services/{서비스}/… (서비스 경로를 빠뜨리면 404 HTML 이 온다)
 *   chat        qwen-llm·gemma-llm (OpenAI Chat Completions, 이미지 입력·추론 모드)
 *   embed       kure-embedding (1024차원)
 *   transcribe  whisper-large-v3·qwen3-asr (OpenAI Audio Transcriptions, wav·mp3·ogg·flac, 60분)
 *   ocr         paddleocr-api 비동기 레이아웃 파싱(제출 → ?wait=60 결과) → 페이지별 Markdown
 *
 * 오류 메시지에 요청·응답 본문을 싣지 않는다 — 게이트웨이(FastAPI)의 422 는 요청값(원문)을 detail 에 되돌려 주고,
 * Qwen 의 잘린 응답에는 문서에서 뽑은 실명이 들어 있다. 이 메시지는 그대로 Claude 에 간다.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, apiKey } from './config.js';

export class HaiError extends Error {
  constructor(code, message, status) { super(message); this.name = 'HaiError'; this.code = code; this.status = status; }
}

function key() {
  const { key: k } = apiKey();
  if (!k) throw new HaiError('HAI_KEY_MISSING', 'HAI API 키가 없습니다. /plugin → hai → 설정에 개인 키(hai-로 시작)를 넣으세요. 키는 HAI 포털에서 헥토 이메일로 가입한 뒤 "API 키 관리"에서 발급합니다.');
  return k;
}

const url = (service, p) => `${config.baseUrl}/services/${service}${p}`;

/** fetch + 원인 구분. body 는 JSON 객체 또는 FormData → 파싱된 JSON */
async function call(service, p, { method = 'POST', body, timeoutMs = config.timeoutMs, retries = 2 } = {}) {
  const headers = { Authorization: `Bearer ${key()}` };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url(service, p), { method, headers, body: payload, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new HaiError('HAI_UNREACHABLE', `HAI(${service}) 연결 실패 — ${causeOf(err, timeoutMs)}. 사내망(또는 허용된 IP)에서만 쓸 수 있습니다.`);
    }
    // 동시 처리 한도(429)·일시 장애(502·503)는 Retry-After 만큼 쉬고 다시
    if ((res.status === 429 || res.status === 502 || res.status === 503) && attempt < retries) {
      await res.body?.cancel();
      await sleep(Math.min(Number(res.headers.get('retry-after')) || 2 ** attempt * 2, 30) * 1000);
      continue;
    }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = null; }
    if (!res.ok) {
      const code = res.status === 401 || res.status === 403 ? 'HAI_KEY_INVALID' : res.status === 404 ? 'HAI_NOT_FOUND' : 'HAI_FAILED';
      throw new HaiError(code, `HAI(${service}) ${res.status} ${safeReason(res.status, data)}`, res.status);
    }
    if (data === null) throw new HaiError('HAI_FAILED', `HAI(${service}) 응답이 JSON 이 아닙니다 (${res.status})`);
    return { data, headers: res.headers };
  }
}

/** 원문이 섞일 수 없는 짧은 안내만 — 키·주소 문제는 알려 주고, 입력을 되돌려 주는 상세(detail 배열·객체)는 버린다 */
function safeReason(status, body) {
  if (status === 401 || status === 403) return '키가 틀렸거나 만료됐습니다';
  if (status === 404) return '서비스 경로를 찾을 수 없습니다(서비스 이름·모델 확인)';
  if (status === 413) return '파일이 너무 큽니다(일반 50MB, 음성 200MB)';
  if (status === 429) return '요청이 많습니다. 잠시 뒤 다시';
  const m = body?.detail ?? body?.error?.message ?? body?.errorMsg;
  if (typeof m === 'string' && m.length <= 120 && !/\d{6}|@|010/.test(m)) return m;
  return '요청을 처리하지 못했습니다';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 대화 ─────────────────────────────────────────────────────────────

export const MODELS = { qwen: 'qwen', gemma: 'gemma' };

/**
 * model: 'qwen'(기본·분석) | 'gemma'(일반 대화·이미지). thinking: 추론 모드(정확도↑, 느림). images: 로컬 이미지 경로들(VLM)
 * → { content, model, finish }
 */
export async function chat({ messages, model = 'qwen', thinking = false, images = [], temperature = 0.1, maxTokens = 2000, responseFormat, timeoutMs }) {
  const service = config.services[model] ?? config.services.qwen;
  let msgs = messages;
  if (images.length) {
    const parts = await Promise.all(images.map(async (p) => ({ type: 'image_url', image_url: { url: await dataUrl(p) } })));
    const last = msgs[msgs.length - 1];
    msgs = [...msgs.slice(0, -1), { role: last.role, content: [{ type: 'text', text: String(last.content) }, ...parts] }];
  }
  const body = { messages: msgs, temperature, max_tokens: maxTokens, chat_template_kwargs: { enable_thinking: Boolean(thinking) } };
  if (thinking) { delete body.max_tokens; body.max_completion_tokens = Math.max(maxTokens, 4000) + 4000; }
  if (responseFormat) body.response_format = responseFormat;
  const { data } = await call(service, '/v1/chat/completions', { body, timeoutMs });
  const choice = data.choices?.[0] ?? {};
  // 추론 내용(message.reasoning, 혹은 본문 속 <think>)은 답이 아니다 — 문서 내용이 섞여 나갈 수 있어 버린다
  // 여는 태그 없이 "…</think>답" 으로 오는 경우도 있다
  const content = String(choice.message?.content ?? '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^[\s\S]*<\/think>/, '').trim();
  return { content, model: data.model, finish: choice.finish_reason };
}

/** json_schema 구조화 응답. 실패해도 응답 내용은 메시지에 싣지 않는다 */
export async function structured({ schema, name, ...rest }) {
  const r = await chat({ ...rest, responseFormat: { type: 'json_schema', json_schema: { name, schema, strict: true } } });
  try { return { data: JSON.parse(r.content.replace(/^```(?:json)?\s*|\s*```$/g, '')), model: r.model }; }
  catch { throw new HaiError('HAI_FAILED', `구조화 응답을 읽지 못했습니다(${r.finish === 'length' ? '응답이 길어 잘림' : `종료 ${r.finish ?? '?'}`}, ${r.content.length}자)`); }
}

const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' };
async function dataUrl(p) {
  const mime = IMAGE_MIME[path.extname(p).toLowerCase()];
  if (!mime) throw new HaiError('HAI_BAD_INPUT', `이미지 형식이 아닙니다: ${path.basename(p)} (png·jpg·webp·gif·bmp)`);
  const buf = await fs.readFile(p);
  if (buf.length > 20 * 1024 * 1024) throw new HaiError('HAI_BAD_INPUT', `이미지가 너무 큽니다(20MB 초과): ${path.basename(p)}`);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// ── 임베딩 ───────────────────────────────────────────────────────────

/** texts → 벡터 배열(같은 순서). 32개씩 */
export async function embed(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 32) {
    const { data } = await call(config.services.embed, '/v1/embeddings', { body: { input: texts.slice(i, i + 32) } });
    out.push(...data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
  }
  return out;
}

// ── 음성 → 글 ────────────────────────────────────────────────────────

/**
 * engine: 'whisper'(회의·일반 녹음, 기본) | 'qwen'(전화·상담·잡음). terms: 고유명사·용어(인식률↑, 2000자). timestamps: 문장별 시각
 * → { text, seconds, segments? }
 */
export async function transcribe(file, { engine = 'whisper', terms, timestamps = false } = {}) {
  const service = engine === 'qwen' ? config.services.asr : config.services.whisper;
  const form = new FormData();
  form.set('file', new Blob([await fs.readFile(file)]), path.basename(file));
  form.set('language', 'ko');
  form.set('response_format', timestamps ? 'verbose_json' : 'json');
  if (terms) form.set('prompt', String(terms).slice(0, 2000));
  const { data } = await call(service, '/v1/audio/transcriptions', { body: form, timeoutMs: 300_000, retries: 3 });
  return { text: String(data.text ?? '').trim(), seconds: data.usage?.audio_seconds ?? data.duration, segments: data.segments };
}

// ── 문서 OCR ─────────────────────────────────────────────────────────

/** PDF·이미지 → 페이지별 Markdown 배열. 비동기 제출 후 ?wait=60 으로 기다린다(최대 waitMs) */
export async function ocr(file, { waitMs = 15 * 60_000 } = {}) {
  const form = new FormData();
  form.set('file', new Blob([await fs.readFile(file)]), path.basename(file));
  const { data } = await call(config.services.ocr, '/layout-parsing/async', { body: form, timeoutMs: 120_000, retries: 3 });
  const jobId = data.result?.jobId;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(jobId))) throw new HaiError('HAI_FAILED', 'OCR 작업 번호를 받지 못했습니다');
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    const t0 = Date.now();
    try {
      const { data: r } = await call(config.services.ocr, `/layout-parsing/async/${jobId}/result?wait=60`, { method: 'GET', timeoutMs: 90_000, retries: 1 });
      if (r.errorCode && r.errorCode !== 0) throw new HaiError('HAI_FAILED', `OCR 실패(오류 코드 ${r.errorCode})`);
      return (r.result?.layoutParsingResults ?? []).map((pg) => String(pg.markdown?.text ?? ''));
    } catch (err) {
      if (err?.status !== 409) throw err; // 409 = 아직 처리 중
      // wait 를 무시하고 바로 409 가 오면 쉬지 않고 두드리게 된다 — 최소 3초 간격
      if (Date.now() - t0 < 3000) await sleep(3000);
    }
  }
  throw new HaiError('HAI_TIMEOUT', `OCR 이 ${Math.round(waitMs / 60000)}분 안에 끝나지 않았습니다`);
}

// ── 점검 ─────────────────────────────────────────────────────────────

/** 서비스별 연결 점검 — 모델 목록(GET /v1/models)만 부른다(사용량 거의 없음) */
export async function probe() {
  const rows = [];
  for (const [name, service] of Object.entries(config.services)) {
    if (name === 'ocr') { rows.push({ name, service, ok: null, note: '점검 생략(문서를 넣어야 확인됨)' }); continue; }
    const t0 = Date.now();
    try {
      const { data } = await call(service, '/v1/models', { method: 'GET', timeoutMs: 10_000, retries: 0 });
      rows.push({ name, service, ok: true, model: data.data?.[0]?.id, ms: Date.now() - t0 });
    } catch (err) {
      rows.push({ name, service, ok: false, code: err.code, note: err.message });
    }
  }
  return rows;
}

function causeOf(err, timeoutMs) {
  if (err?.name === 'TimeoutError') return `${Math.round(timeoutMs / 1000)}초 안에 응답이 없습니다`;
  const seen = [];
  for (let e = err; e && seen.length < 4; e = e.cause) {
    const part = [e.code, e.message].filter(Boolean).join(' ');
    if (part && part !== 'fetch failed' && !seen.includes(part)) seen.push(part);
  }
  return seen.join(' ← ') || 'fetch failed';
}
