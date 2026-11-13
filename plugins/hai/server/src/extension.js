/**
 * 크롬 확장 "헥토 AI 브라우저 에이전트" 설치 준비 — 설치 파일(압축)을 agent 서버에서 받아 이 PC 에 풀어 두고 남은 순서를 알려 준다.
 *   크롬은 웹 스토어 밖 확장을 프로그램이 대신 올리지 못하게 한다 — 개발자 모드를 켜고 폴더를 고르는 마지막 단계는 사람이 한다.
 *   받는 길은 hai 로그인 토큰으로만(/hai-api/extension/download). 풀 곳은 홈 폴더의 hecto-agent-extension —
 *   문서 폴더는 Windows 에서 OneDrive 로 옮겨져 있을 수 있어(파일이 온라인 전용으로 바뀌면 확장이 멈춘다) 쓰지 않는다.
 *   새 버전도 같은 폴더에 덮어쓴다(확장 ID 는 manifest key 로 고정이라 로그인·저장한 작업이 그대로 남는다).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { config } from './config.js';
import { HaiError } from './hai.js';
import { loadToken } from './login.js';

const ROOT = 'hecto-agent-extension/';   // 압축 안의 확장 폴더(그 밖의 README.txt·guide.html 은 풀지 않는다)
const MAX_ZIP = 30 * 1024 * 1024;
const MAX_FILES = 2000;

/** 최신 확장 압축을 받는다 → { buf, version } */
export async function downloadExtension({ fetcher = fetch, token = loadToken() } = {}) {
  if (!token) throw new HaiError('HAI_LOGIN_REQUIRED', '크롬 확장 설치 파일을 받으려면 hai 로그인이 필요합니다(개인 키만으로는 받을 수 없습니다). hai_login 을 실행하세요.');
  let res;
  try {
    res = await fetcher(`${config.agentUrl}/hai-api/extension/download`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    throw new HaiError('AGENT_UNREACHABLE', `agent 서버(${config.agentUrl})에 연결하지 못했습니다(${e.name === 'TimeoutError' ? '시간 초과' : e.message}).`);
  }
  if (res.status === 401) throw new HaiError('HAI_LOGIN_REQUIRED', 'hai 로그인이 끊겼습니다. hai_login 으로 다시 로그인하세요.', 401);
  if (res.status === 404) throw new HaiError('EXT_NOT_READY', '서버에 받을 확장 설치 파일이 없습니다. 담당자에게 알려 주세요.', 404);
  if (!res.ok) throw new HaiError(`HTTP_${res.status}`, `확장 설치 파일을 받지 못했습니다(agent 서버 오류 ${res.status}).`, res.status);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_ZIP) throw new HaiError('EXT_TOO_BIG', '확장 설치 파일이 너무 큽니다. 담당자에게 알려 주세요.');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_ZIP) throw new HaiError('EXT_TOO_BIG', '확장 설치 파일이 너무 큽니다. 담당자에게 알려 주세요.');
  return { buf, version: res.headers.get('x-extension-version') ?? null };
}

/** 압축 안 경로 → 폴더 아래 상대 조각들. 폴더 밖으로 나가려는 이름(.., 절대 경로, 드라이브, 역슬래시)은 null */
export function safeParts(rel) {
  if (!rel || /[\\:\0]/.test(rel) || rel.startsWith('/')) return null;
  const parts = rel.split('/').filter(Boolean);
  return parts.length && !parts.some((p) => p === '.' || p === '..') ? parts : null;
}

const readManifest = async (dir) => { try { return JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')); } catch { return null; } };

/** 폴더 안의 모든 파일(상대 경로, / 구분) */
async function walk(dir, base = '') {
  const out = [];
  for (const ent of await fs.readdir(path.join(dir, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...await walk(dir, rel)); else out.push(rel);
  }
  return out;
}

/**
 * 압축을 dir 에 푼다 → { dir, version, previous(전에 깔려 있던 버전 | null), files }.
 * dir 에 이미 다른 것이 들어 있으면(이 확장이 아니면) 건드리지 않는다. 같은 확장이면 덮어쓰고, 새 버전에서 없어진 파일은 지운다.
 */
export async function unpackExtension(buf, dir = config.extDir) {
  let zip;
  try { zip = await JSZip.loadAsync(buf); } catch { throw new HaiError('EXT_BAD_ZIP', '받은 확장 설치 파일을 열 수 없습니다. 다시 시도하고, 계속 안 되면 담당자에게 알려 주세요.'); }
  const entries = Object.values(zip.files).filter((f) => !f.dir && f.name.startsWith(ROOT));
  const files = [];
  for (const f of entries) {
    const parts = safeParts(f.name.slice(ROOT.length));
    if (!parts) throw new HaiError('EXT_BAD_ZIP', '받은 확장 설치 파일에 이상한 경로가 있어 풀지 않았습니다. 담당자에게 알려 주세요.');
    files.push({ f, parts, rel: parts.join('/') });
  }
  if (files.length > MAX_FILES) throw new HaiError('EXT_BAD_ZIP', '받은 확장 설치 파일의 파일 수가 너무 많아 풀지 않았습니다. 담당자에게 알려 주세요.');
  const mf = files.find((x) => x.rel === 'manifest.json');
  let manifest = null;
  try { manifest = mf && JSON.parse(await mf.f.async('string')); } catch { /* 아래에서 거절 */ }
  if (!manifest?.version || !manifest?.key) throw new HaiError('EXT_BAD_ZIP', '받은 파일이 확장 설치 파일이 아닙니다. 담당자에게 알려 주세요.');

  let existing = [];
  try { existing = await walk(dir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const old = existing.length ? await readManifest(dir) : null;
  if (existing.length && old?.key !== manifest.key) {
    throw new HaiError('EXT_DIR_TAKEN', `${dir} 폴더에 이미 다른 내용이 들어 있어 풀지 않았습니다. 그 폴더를 옮기거나 이름을 바꾼 뒤 다시 시도하세요.`);
  }

  const root = path.resolve(dir);
  for (const { f, parts } of files) {
    const target = path.resolve(root, ...parts);
    if (!target.startsWith(root + path.sep)) throw new HaiError('EXT_BAD_ZIP', '받은 확장 설치 파일에 이상한 경로가 있어 풀지 않았습니다. 담당자에게 알려 주세요.');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, await f.async('nodebuffer'));
  }
  const keep = new Set(files.map((x) => x.rel));
  for (const rel of existing) if (!keep.has(rel)) await fs.rm(path.join(root, ...rel.split('/')), { force: true });
  return { dir: root, version: String(manifest.version), previous: old?.version ? String(old.version) : null, files: files.length };
}

/** 이 PC 에 풀어 둔 확장 버전(없으면 null) — 직접 다른 곳에 설치한 것은 알 수 없다 */
export const unpackedVersion = async (dir = config.extDir) => (await readManifest(dir))?.version ?? null;

/** 사람에게 보여 줄 남은 순서(순수 함수). opened: 크롬 확장 화면을 열었나 */
export function installSteps({ dir, version, previous, opened, platform = process.platform }) {
  const pick = platform === 'win32'
    ? '폴더 고르는 창 맨 아래 "폴더" 칸에 위 경로를 붙여 넣고 "폴더 선택"'
    : platform === 'darwin' ? '폴더 고르는 창에서 Cmd+Shift+G 를 누르고 위 경로를 붙여 넣은 뒤 "선택"' : '폴더 고르는 창에서 위 경로의 폴더를 고릅니다';
  const where = opened ? '방금 크롬에 연 "확장 프로그램" 화면(안 보이면 주소창에 chrome://extensions)' : '평소 쓰는 크롬 주소창에 chrome://extensions 를 넣어 연 화면';
  if (previous) {
    return [
      previous === version ? `크롬 확장 ${version} 을 다시 받아 같은 폴더에 덮어썼습니다.` : `크롬 확장을 ${previous} → ${version} 으로 바꿔 두었습니다(같은 폴더에 덮어씀).`,
      `폴더: ${dir}`,
      '',
      '남은 일 (직접 하셔야 합니다):',
      '1. 크롬에서 헥토 에이전트 패널 맨 위 "새 버전" 카드의 "다시 불러오기"를 누릅니다.',
      `   카드가 없으면 ${where}에서 "헥토 AI 브라우저 에이전트" 카드의 새로 고침(동그란 화살표)을 누릅니다.`,
      '2. 패널이 닫히면 아이콘을 다시 누릅니다. 로그인과 저장한 작업은 그대로 남습니다.',
      '',
      '아직 크롬에 올린 적이 없다면 처음 설치 순서대로 하세요: 개발자 모드 켜기 → "압축해제된 확장 프로그램 로드" → 위 폴더 선택.',
    ].join('\n');
  }
  return [
    `크롬 확장 ${version} 설치 파일을 받아 풀어 두었습니다.`,
    `폴더: ${dir}`,
    '이 폴더를 지우거나 옮기면 확장이 멈춥니다.',
    '',
    '남은 일 (크롬이 사람 손으로만 받는 단계라 직접 하셔야 합니다):',
    `1. ${where} 오른쪽 위의 "개발자 모드"를 켭니다.`,
    `2. 왼쪽 위 "압축해제된 확장 프로그램 로드"를 누릅니다. ${pick}.`,
    '3. 크롬 오른쪽 위 퍼즐 모양 아이콘에서 "헥토 AI 브라우저 에이전트"를 고정(핀)합니다.',
    '4. 그 아이콘을 눌러 패널을 열고 "로그인"을 누릅니다(Claude Code 의 hai 로그인과 같은 헥토 계정).',
    '5. 메일·메신저·캘린더·그룹웨어처럼 쓸 사이트를 열어 로그인하고, 패널의 "이 사이트 허용"을 사이트마다 한 번씩 누릅니다.',
    '',
    '끝나면 "확장 연결됐는지 확인해줘"라고 하세요(hai_status). "개발자 모드"가 보이지 않으면 회사 PC 보안 정책으로 막힌 것이니 담당자에게 알려 주세요.',
  ].join('\n');
}
