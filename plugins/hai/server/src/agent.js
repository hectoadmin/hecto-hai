/**
 * 크롬 헥토 에이전트에 저장한 작업을 Claude Code 에서 실행(연동 2단계). hai 로그인 토큰으로 agent 서버(/hai-api)를 부른다.
 *   실행은 그 사람의 크롬(확장 프로그램)에서 돈다 — 여기서는 서버에 맡기고 진행·결과를 받을 뿐 화면에 닿지 않는다.
 *   화면 읽기·판단은 사내 AI 가 하고, 이쪽으로는 단계 이름·확인 질문·결과 문장(서버가 가린 뒤)만 온다.
 *   확인: 저장·임시 저장·입력류는 대화로 답할 수 있고, 상신·승인·삭제·제출·이동·파일은 크롬 패널에서만(서버가 거른다, 결정 E2).
 */
import { config } from './config.js';
import { HaiError } from './hai.js';
import { loadToken } from './login.js';

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function api(path, body) {
  const token = loadToken();
  if (!token) throw new HaiError('HAI_LOGIN_REQUIRED', '저장한 작업을 실행하려면 hai 로그인이 필요합니다. hai_login 을 실행하세요(크롬 확장과 같은 헥토 계정).');
  let res;
  try {
    res = await fetch(`${config.agentUrl}/hai-api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new HaiError('AGENT_UNREACHABLE', `agent 서버(${config.agentUrl})에 연결하지 못했습니다(${e.name === 'TimeoutError' ? '시간 초과' : e.message}).`);
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new HaiError('HAI_LOGIN_REQUIRED', 'hai 로그인이 끊겼습니다. hai_login 으로 다시 로그인하세요.', 401);
  if (!res.ok) throw new HaiError(String(json.error ?? `HTTP_${res.status}`).toUpperCase(), json.message ?? `agent 서버 오류 ${res.status}`, res.status);
  return json;
}

export const listRecipes = () => api('/recipes');
export const startRun = (recipeId, params) => api('/runs', { recipeId, params });
export const runStatus = (id) => api(`/runs/${Number(id)}`);
export const answerRun = (id, q, answer) => api(`/runs/${Number(id)}/answer`, { q, answer });

const squash = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();
/** 이름(띄어쓰기·대소문자 무시)이나 번호로 고른다. 정확히 같은 이름 → 이름을 포함하는 것이 하나일 때. 아니면 후보를 알려 준다 */
export function pickRecipe(recipes, want) {
  const w = String(want ?? '').trim().replace(/^#/, '');
  if (/^\d+$/.test(w)) {
    const r = recipes.find((x) => x.id === Number(w));
    if (r) return r;
  }
  const exact = recipes.filter((x) => squash(x.name) === squash(w));
  if (exact.length === 1) return exact[0];
  const part = recipes.filter((x) => squash(x.name).includes(squash(w)));
  if (exact.length === 0 && part.length === 1) return part[0];
  const cands = (exact.length ? exact : part).slice(0, 8).map((x) => `#${x.id} ${x.name}`).join(', ');
  throw new HaiError('RECIPE_NOT_FOUND', cands
    ? `'${w}' 에 맞는 저장한 작업이 여럿입니다: ${cands}. 번호(#)로 골라 주세요.`
    : `'${w}' 라는 저장한 작업이 없습니다. agent_recipes 로 목록을 보세요(작업은 크롬 패널에서 녹화·저장합니다).`);
}

const LIVE = new Set(['waiting', 'starting', 'running']);
/** 끝나거나 확인·질문이 생기거나 waitMs 가 지날 때까지 기다린다 */
export async function waitRun(id, { waitMs = 120_000, every = 2000, onProgress, sleep = pause, now = Date.now, status = runStatus } = {}) {
  const end = now() + waitMs;
  let last = '';
  for (;;) {
    const st = await status(id);
    if (!LIVE.has(st.status)) return st;
    const line = st.status === 'running' ? `${st.steps}단계${st.last ? ` · ${st.last}` : ''}` : '크롬에서 시작을 기다리는 중';
    if (line !== last) { onProgress?.(line); last = line; }
    if (now() + every > end) return st;
    await sleep(every);
  }
}

/** 상태 → Claude 에게 돌려줄 글(다음에 할 일까지) */
export function describeRun(st) {
  const id = st.id;
  const head = `[실행 #${id}] ${st.recipe}`;
  switch (st.status) {
    case 'waiting':
    case 'starting':
      return `${head} — 크롬에서 시작을 기다리는 중입니다. 패널이 닫혀 있으면 크롬 알림을 누르면 시작합니다(2분 안). agent_status {run: ${id}} 로 이어서 기다리세요.`;
    case 'running':
      return `${head} — 진행 중(${st.steps}단계${st.last ? `, 마지막: ${st.last}` : ''}). agent_status {run: ${id}} 로 이어서 기다리세요.`;
    case 'question': {
      const q = st.question;
      if (q.kind === 'dialog') q.text = `페이지 확인 창 "${q.text}"`;
      if (!q.chatOk) {
        return `${head} — 크롬 패널에서만 확인할 수 있습니다: ${q.text}\n`
          + `되돌릴 수 없는 동작·이동·파일 고르기라 대화로 대신 답할 수 없습니다. 사용자에게 크롬 패널에서 직접 확인(또는 거부)해 달라고 안내하고 agent_status {run: ${id}} 로 기다리세요. 멈추려면 agent_answer {run: ${id}, q: ${q.id}, answer: "stop"}.`;
      }
      if (q.kind === 'ask') {
        return `${head} — 질문이 왔습니다: ${q.text}\n사용자에게 그대로 물어보고, 사용자가 답한 글을 agent_answer {run: ${id}, q: ${q.id}, answer: "<답>"} 으로 보내세요. 스스로 지어서 답하지 않습니다(크롬 패널에서 답해도 됩니다).`;
      }
      return `${head} — 확인이 필요합니다: ${q.text}\n`
        + `사용자에게 이 내용을 그대로 보여 주고 실행할지 물어보세요. 사용자가 실행하라고 했을 때만 agent_answer {run: ${id}, q: ${q.id}, answer: "run"}, 아니면 "reject"(이 동작만 안 하고 멈춤) 또는 "stop". 스스로 판단해 "run" 을 보내지 않습니다(크롬 패널에서 눌러도 됩니다).`;
    }
    case 'done': return `${head} — 완료(${st.steps}단계).\n결과: ${st.answer || '(결과 문장 없음)'}`;
    case 'failed': return `${head} — 실패: ${st.message || '끝내지 못했습니다.'} 크롬 패널의 결과 카드에서 자세히 볼 수 있습니다.`;
    case 'stopped': return `${head} — 멈춤: ${st.message || '사용자가 멈췄습니다.'}`;
    case 'declined': return `${head} — 시작하지 않음: ${st.message}`;
    case 'expired': return `${head} — 시작되지 않음: ${st.message}`;
    default: return `${head} — ${st.status}`;
  }
}
