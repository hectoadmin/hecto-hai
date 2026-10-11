/**
 * HAI 게이트웨이 (사내 LLM, OpenAI 호환). {base}/services/{서비스}/v1/chat/completions
 * /services/{서비스} 를 빠뜨리면 404 HTML 이 온다. 원인 구분은 hecto-relay server/ai/hai.js 와 같다.
 */
import { config, apiKey } from './config.js';

export class HaiError extends Error {
  constructor(code, message) { super(message); this.name = 'HaiError'; this.code = code; }
}

export async function chat({ messages, temperature = 0.1, maxTokens = 2000, responseFormat, timeoutMs = config.timeoutMs }) {
  const { key } = apiKey();
  if (!key) throw new HaiError('HAI_KEY_MISSING', 'HAI API 키가 없습니다. 플러그인 설정(/plugin → hai → 설정)에 키를 넣거나, macOS 는 키체인 서비스 hai-api 에 등록하세요.');
  const url = `${config.baseUrl}/services/${config.chatService}/v1/chat/completions`;
  const body = { messages, temperature, max_tokens: maxTokens };
  if (responseFormat) body.response_format = responseFormat;
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new HaiError('HAI_UNREACHABLE', `HAI 연결 실패 — ${causeOf(err, timeoutMs)}. 사내망(또는 허용된 IP)에서만 쓸 수 있습니다.`);
  }
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const code = res.status === 401 || res.status === 403 ? 'HAI_KEY_INVALID' : 'HAI_FAILED';
    throw new HaiError(code, errorText(res.status, data));
  }
  const message = data.choices?.[0]?.message ?? {};
  return { content: String(message.content ?? ''), model: data.model, usage: data.usage, finish: data.choices?.[0]?.finish_reason };
}

/** json_schema 구조화 응답. 파싱 실패는 HAI_FAILED */
export async function structured({ schema, name, ...rest }) {
  const r = await chat({ ...rest, responseFormat: { type: 'json_schema', json_schema: { name, schema, strict: true } } });
  try { return { data: JSON.parse(stripFence(r.content)), model: r.model }; }
  catch { throw new HaiError('HAI_FAILED', `구조화 응답 파싱 실패 (${r.finish ?? '?'}): ${r.content.slice(0, 120)}`); }
}

const stripFence = (s) => s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

function causeOf(err, timeoutMs) {
  if (err?.name === 'TimeoutError') return `${Math.round(timeoutMs / 1000)}초 안에 응답이 없습니다`;
  const seen = [];
  for (let e = err; e && seen.length < 4; e = e.cause) {
    const part = [e.code, e.message].filter(Boolean).join(' ');
    if (part && part !== 'fetch failed' && !seen.includes(part)) seen.push(part);
  }
  return seen.join(' ← ') || 'fetch failed';
}

function errorText(status, body) {
  if (body && typeof body === 'object') { const m = body.detail ?? body.error?.message ?? body.errorMsg; if (m) return `${status} ${typeof m === 'string' ? m : JSON.stringify(m)}`; }
  if (typeof body === 'string' && body.trim()) return `${status} ${body.trim().slice(0, 200)}`;
  return String(status);
}
