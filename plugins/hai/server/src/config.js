/**
 * 설정 — 전부 환경변수(플러그인 사용자 설정이 넣어 준다). 키는 화면·로그·도구 결과에 절대 싣지 않는다.
 *   HAI_API_KEY        없으면 macOS 키체인(서비스 hai-api)에서 읽는다
 *   HAI_BASE_URL       기본 https://hai-gateway.idc.hectoai.co.kr
 *   HAI_TIMEOUT_MS     기본 120000 (게이트웨이 비스트리밍 상한은 300초)
 *   HAI_KEEP_DOMAINS   가리지 않을 이메일 도메인, 쉼표 구분 (기본 없음 = 이메일 전부 가림)
 *   HAI_MAX_CHARS      파일 한 개 최대 글자 수 (기본 300000)
 *   HAI_PROTECTED_DIRS 보호 폴더(점검 화면에 보여 주는 용도 — 막는 건 훅)
 *   HAI_RAW_DIR        원문 결과(받아쓰기·OCR) 기본 저장 폴더 (기본 ~/Documents/HAI 원문) — 한곳에 모아 훅·샌드박스 규칙 하나로 막는다
 * 서비스 이름은 HAI 연동 가이드 v2.10(2026-10) 기준.
 */
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

// 플러그인 설정이 비면 "${user_config.x}" 글자가 그대로 올 수 있다 — 빈 값으로 본다
const env = (k, d) => { const v = (process.env[k] ?? '').trim(); return v && !v.includes('${') ? v : d; };
const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  baseUrl: env('HAI_BASE_URL', 'https://hai-gateway.idc.hectoai.co.kr').replace(/\/+$/, ''),
  timeoutMs: Number(env('HAI_TIMEOUT_MS', '120000')),
  keepDomains: list(env('HAI_KEEP_DOMAINS', '')).map((d) => d.toLowerCase()),
  maxChars: Number(env('HAI_MAX_CHARS', '300000')),
  protectedDirs: list(env('HAI_PROTECTED_DIRS', '')),
  rawDir: (() => { const d = env('HAI_RAW_DIR', '~/Documents/HAI 원문'); return path.resolve(d.startsWith('~') ? path.join(os.homedir(), d.slice(1)) : d); })(),
  // 이 플러그인이 만든 원문 파일 목록·검색 색인을 두는 곳. 훅(guard.mjs)도 같은 경로를 읽는다
  dataDir: env('HAI_DATA_DIR', path.join(os.homedir(), '.hai-mcp')),
  services: {
    qwen: env('HAI_CHAT_SERVICE', 'qwen-llm'),       // 추론·코드·분석. 이미지 이해
    gemma: env('HAI_GEMMA_SERVICE', 'gemma-llm'),    // 일반 대화·요약·이미지 이해
    embed: env('HAI_EMBED_SERVICE', 'kure-embedding'),
    whisper: env('HAI_WHISPER_SERVICE', 'whisper-large-v3'), // 회의·일반 녹음
    asr: env('HAI_ASR_SERVICE', 'qwen3-asr'),        // 전화·상담·잡음
    ocr: env('HAI_OCR_SERVICE', 'paddleocr-api'),
  },
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
