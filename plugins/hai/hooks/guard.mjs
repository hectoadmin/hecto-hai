#!/usr/bin/env node
/**
 * 원문 가드 (PreToolUse). Claude 가 Read·Grep·Glob·Bash 등으로 다음을 직접 열지 못하게 막고 HAI 도구를 쓰라고 돌려보낸다.
 *   1) 보호 폴더 — 플러그인 설정 protected_dirs
 *   2) 이 플러그인이 만든 원문 파일 — 받아쓰기·OCR 결과, 실명으로 되돌린 결과물 (~/.hai-mcp/raw-files.log 장부)
 *   3) ~/.hai-mcp/tmp (변환 중인 음성)
 * 경로는 NFC 로 맞추고, macOS·Windows 에서는 대소문자를 가리지 않는다(파일 시스템이 그렇다).
 * Bash 는 명령 글자를 보고 판단하는 최선 노력이다 — 경로 토큰이 보호 대상 안이거나, 보호 대상을 품은 상위 폴더를 재귀로 훑으면 막는다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const DATA = process.env.HAI_DATA_DIR || path.join(HOME, '.hai-mcp');
const FOLD = os.platform() === 'darwin' || os.platform() === 'win32';
const norm = (p) => { const s = path.resolve(p).normalize('NFC'); return FOLD ? s.toLowerCase() : s; };
const expand = (p, cwd = process.cwd()) => {
  const s = String(p).replace(/^\$HOME(?=\/|$)/, HOME).replace(/^\$\{HOME\}(?=\/|$)/, HOME);
  return path.resolve(cwd, s.startsWith('~') ? path.join(HOME, s.slice(1)) : s);
};
const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
const key = (p) => norm(real(p));

const opt = process.env.CLAUDE_PLUGIN_OPTION_PROTECTED_DIRS ?? '';
const dirs = (opt.includes('${') ? [] : opt.split(',').map((s) => s.trim()).filter(Boolean)).map((d) => ({ shown: d, key: key(expand(d)), dir: true }));
dirs.push({ shown: '~/.hai-mcp/tmp', key: key(path.join(DATA, 'tmp')), dir: true });
let rawFiles = [];
try { rawFiles = [...new Set(fs.readFileSync(path.join(DATA, 'raw-files.log'), 'utf8').split('\n').filter(Boolean))]; } catch { /* 없음 */ }
const targets = [...dirs, ...rawFiles.map((f) => ({ shown: f.replace(HOME, '~'), key: norm(f), dir: false }))];

const inside = (p, dir) => { const rel = path.relative(dir, p); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
/** p(정규화)가 보호 대상 안이면 그 대상 */
const hit = (p) => targets.find((t) => (t.dir ? inside(p, t.key) : p === t.key));
/** p 가 보호 대상을 품은 상위 폴더면 그 대상 */
const ancestorOf = (p) => targets.find((t) => t.key !== p && inside(t.key, p));

function deny(t, why) {
  const what = t.dir ? `${t.shown} 은 보호 폴더입니다` : `${t.shown} 은 HAI 가 만든 원문 파일입니다(실명·받아쓰기 원문)`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: `${what} — ${why}. 원본을 직접 열지 말고 hai_ask_file(HAI 만 읽고 답) 또는 hai_mask_file(가려서 읽기)을 쓰세요. 원문 파일 확인은 사용자가 직접 합니다.` } }));
  process.exit(0);
}

// 여러 폴더를 훑는 명령만 — grep·cp 계열의 -r/-R, ls -R, find·rg·tar·zip, 하위로 내려가는 와일드카드(*/ · **).
// ls -lrt · sort -r 처럼 r 이 "역순"인 옵션은 아니다(비개발자 기본 작업 폴더 ~ 에서 늘 막히던 문제)
const RECURSIVE = new RegExp([
  String.raw`(^|[\s;&|(])(grep|egrep|fgrep|zgrep|cp|scp|rsync|chmod|chown|rm)\b[^;&|]*\s(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)(?=\s|$)`,
  String.raw`(^|[\s;&|(])ls\b[^;&|]*\s-[a-zA-Z]*R`,
  String.raw`(^|[\s;&|(])(find|rg|ag|ack|tar|zip|7z)(?=\s|$)`,
  String.raw`\*\*|\*\/`,
].join('|'));
/** 셸 와일드카드(*, ?) → 정규식 (한 폴더 안 이름만) */
const globRe = (g) => new RegExp(`^${[...g].map((c) => (c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('')}$`, FOLD ? 'i' : '');

let input = '';
process.stdin.on('data', (d) => (input += d)).on('end', () => {
  if (!targets.length) process.exit(0);
  let ev;
  try { ev = JSON.parse(input); } catch { process.exit(0); }
  const t = ev.tool_input ?? {};
  const cwd = ev.cwd || process.cwd();
  const abs = (p) => key(expand(p, cwd));

  switch (ev.tool_name) {
    case 'Read': case 'Edit': case 'MultiEdit': case 'NotebookEdit': case 'Write': {
      const p = t.file_path ?? t.notebook_path;
      if (!p) break;
      const h = hit(abs(p));
      // 원문 파일에 쓰기는 괜찮지만(덮어쓰기) 보호 폴더 안 파일 열기·고치기는 막는다
      if (h && !(ev.tool_name === 'Write' && h.dir)) deny(h, `${ev.tool_name} 차단`);
      break;
    }
    case 'Grep': case 'Glob': {
      const p = abs(t.path ?? cwd);
      const h = hit(p);
      if (h) deny(h, `${ev.tool_name} 차단`);
      const a = ancestorOf(p);
      // 상위 폴더를 훑는 검색 — Grep 은 늘 재귀, Glob 은 ** 이거나 보호 대상 이름이 패턴에 있을 때
      if (a && (ev.tool_name === 'Grep' || /\*\*/.test(t.pattern ?? '') || String(t.pattern ?? '').normalize('NFC').toLowerCase().includes(path.basename(a.key)))) deny(a, '검색 범위에 들어 있음');
      break;
    }
    case 'Bash': {
      const cmd = String(t.command ?? '').normalize('NFC');
      const inCwd = hit(key(cwd));
      if (inCwd) deny(inCwd, '작업 폴더가 그 안');
      // 단어(따옴표 벗김, = : 뒤도 분리). 옵션(-x)은 뺀다
      const words = [...cmd.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3])
        .flatMap((s) => s.split(/[=<>|;&()`]/)).map((s) => s.trim()).filter((s) => s && !s.startsWith('-'));
      // cd 로 옮겨 간 폴더도 상대 경로의 기준으로 본다 (cd ~/Documents && cat 인사/a.txt)
      const bases = [cwd, ...[...cmd.matchAll(/(?:^|[;&|(]\s*)(?:cd|pushd)\s+("[^"]+"|'[^']+'|\S+)/g)].map((m) => expand(m[1].replace(/^["']|["']$/g, ''), cwd))];
      const recursive = RECURSIVE.test(cmd);
      // 파이프·;·&& 로 나뉜 명령마다 첫 단어 — 전부 이름만 보는 명령이면 와일드카드 검사를 하지 않는다
      const NAMES_ONLY = new Set(['ls', 'stat', 'du', 'file', 'echo', 'pwd', 'mkdir', 'touch', 'open', 'which', 'cd']);
      const namesOnly = cmd.split(/\|\||&&|[|;&]/).map((seg) => seg.trim().split(/\s+/)[0]).filter(Boolean).every((c) => NAMES_ONLY.has(path.basename(c)));
      for (const w of words) {
        // 한 폴더 와일드카드(cat ~/Downloads/*.txt, head *받아쓰기*) — 그 폴더의 원문 파일 이름과 맞춰 본다(이름만 보는 ls 등은 빼고)
        if (/[*?]/.test(w) && !/[*?]/.test(path.dirname(w)) && !namesOnly) {
          const re = globRe(path.basename(w).normalize('NFC'));
          for (const b of bases) {
            const d = key(expand(path.dirname(w), b));
            const tg = targets.find((tt) => !tt.dir && path.dirname(tt.key) === d && re.test(path.basename(tt.key)));
            if (tg) deny(tg, '와일드카드가 그 파일을 가리킴');
          }
        }
        const clean = w.replace(/[*?].*$/, '').replace(/\/+$/, '') || (w.startsWith('/') ? '/' : '');
        if (!clean && /[*?]/.test(w)) continue; // "*.pdf" 같은 이름 패턴(find -name 값 등) — 경로 없는 재귀는 아래 작업 폴더 검사가 맡는다
        for (const b of bases) {
          const p = key(expand(clean, b));
          const h = hit(p);
          if (h) deny(h, '명령이 그 안을 가리킴');
          const a = recursive && ancestorOf(p);
          if (a) deny(a, '그 폴더를 품은 상위 폴더를 재귀로 훑는 명령');
        }
        // 기준 폴더를 모르는 상대 경로라도 경로 조각에 보호 폴더 이름이 그대로 있으면(…/인사/…)
        if (w.includes('/')) {
          const segs = w.normalize('NFC').split('/').map((x) => (FOLD ? x.toLowerCase() : x));
          const tg = targets.find((tt) => tt.dir && path.basename(tt.key).length >= 2 && segs.includes(path.basename(tt.key)));
          if (tg) deny(tg, '명령에 그 폴더 이름이 경로로 들어 있음');
        }
      }
      // 경로 없이 재귀로 훑는 명령(grep -r 홍길동 / rg 홍길동 / find -name …)은 기준 폴더 아래 전체를 본다.
      // 경로를 준 명령(find ~/Desktop)은 위에서 그 경로로 판단했으니 여기서 다시 막지 않는다
      // 와일드카드로 시작하는 단어(*/*.txt)는 작업 폴더 기준이라 경로를 준 것으로 보지 않는다
      const hasPathArg = words.some((w) => { const c = w.replace(/[*?].*$/, ''); return /[/~]/.test(c) || c === '.' || c === '..' || c.startsWith('$HOME'); });
      if (recursive && !hasPathArg) for (const b of bases) { const a = ancestorOf(key(b)); if (a) deny(a, '작업 폴더 아래를 재귀로 훑는 명령'); }
      break;
    }
  }
  process.exit(0);
});
