/**
 * 설정 — 전부 환경변수(플러그인 사용자 설정이 넣어 준다). 키는 화면·로그·도구 결과에 절대 싣지 않는다.
 *   HAI_API_KEY        없으면 macOS 키체인(서비스 hai-api)에서 읽는다
 *   HAI_BASE_URL       기본 https://hai-gateway.idc.hectoai.co.kr
 *   HAI_CHAT_SERVICE   기본 qwen-llm
 *   HAI_TIMEOUT_MS     기본 60000 (문서 한 조각 처리)
 *   HAI_KEEP_DOMAINS   가리지 않을 이메일 도메인, 쉼표 구분 (기본 없음 = 이메일 전부 가림)
 *   HAI_MAX_CHARS      파일 한 개 최대 글자 수 (기본 300000)
 */
import { execFileSync } from 'node:child_process';
import os from 'node:os';

// 플러그인 설정이 비면 "${user_config.x}" 글자가 그대로 올 수 있다 — 빈 값으로 본다
const env = (k, d) => { const v = (process.env[k] ?? '').trim(); return v && !v.includes('${') ? v : d; };
const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  baseUrl: env('HAI_BASE_URL', 'https://hai-gateway.idc.hectoai.co.kr').replace(/\/+$/, ''),
  chatService: env('HAI_CHAT_SERVICE', 'qwen-llm'),
  timeoutMs: Number(env('HAI_TIMEOUT_MS', '60000')),
  keepDomains: list(env('HAI_KEEP_DOMAINS', '')).map((d) => d.toLowerCase()),
  maxChars: Number(env('HAI_MAX_CHARS', '300000')),
};

let cached;
/** → { key, source: 'env' | 'keychain' | null } — key 값은 이 모듈 밖에서 출력하지 않는다 */
export function apiKey() {
  if (cached) return cached;
  const fromEnv = env('HAI_API_KEY', '');
  if (fromEnv) return (cached = { key: fromEnv, source: 'env' });
  if (os.platform() === 'darwin') {
    try {
      const k = execFileSync('security', ['find-generic-password', '-s', 'hai-api', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (k) return (cached = { key: k, source: 'keychain' });
    } catch { /* 없음 */ }
  }
  return { key: '', source: null };
}
