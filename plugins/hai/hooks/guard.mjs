#!/usr/bin/env node
/**
 * 보호 폴더 가드 (PreToolUse). 플러그인 설정 protected_dirs 의 파일을 Claude 가 Read·Grep·Bash 등으로 직접 열지 못하게 막고
 * hai_mask_file / hai_ask_file 을 쓰라고 돌려보낸다. 설정이 비면 아무것도 하지 않는다.
 * Bash 는 명령 글자에 보호 폴더 경로·이름이 보이거나 작업 폴더가 보호 폴더 안일 때만 막는다 — 우회가 가능한 최선 노력이다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const raw = process.env.CLAUDE_PLUGIN_OPTION_PROTECTED_DIRS ?? '';
const expand = (p) => path.resolve(p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
const dirs = raw.includes('${') ? [] : raw.split(',').map((s) => s.trim()).filter(Boolean).map((d) => real(expand(d)));

if (!dirs.length) process.exit(0);

const inside = (p, dir) => { const rel = path.relative(dir, p); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
const hit = (p) => dirs.find((d) => inside(real(p), d));

function deny(dir, why) {
  const shown = dir.replace(os.homedir(), '~');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `${shown} 은 보호 폴더입니다(${why}). 원본을 직접 열지 말고 hai_mask_file(가려서 읽기) 또는 hai_ask_file(Qwen 만 읽고 답하기)을 쓰세요.`,
    },
  }));
  process.exit(0);
}

let input = '';
process.stdin.on('data', (d) => (input += d)).on('end', () => {
  let ev;
  try { ev = JSON.parse(input); } catch { deny(dirs[0], '훅 입력을 읽지 못해 안전하게 막음'); }
  const t = ev.tool_input ?? {};
  const cwd = ev.cwd || process.cwd();
  const abs = (p) => (p ? expand(path.isAbsolute(p) || p.startsWith('~') ? p : path.join(cwd, p)) : null);

  switch (ev.tool_name) {
    case 'Read': case 'Edit': case 'MultiEdit': case 'NotebookEdit': case 'NotebookRead': {
      const p = abs(t.file_path ?? t.notebook_path);
      const d = p && hit(p);
      if (d) deny(d, `${ev.tool_name} 차단`);
      break;
    }
    case 'Grep': {
      const p = abs(t.path) ?? cwd;
      const d = hit(p) ?? dirs.find((dir) => inside(dir, real(p))); // 보호 폴더를 품은 상위 폴더 검색도 막는다
      if (d) deny(d, '검색 범위에 보호 폴더가 포함됨');
      break;
    }
    case 'Bash': {
      const cmd = String(t.command ?? '');
      const inCwd = hit(cwd);
      if (inCwd) deny(inCwd, '작업 폴더가 보호 폴더 안');
      for (const d of dirs) {
        const forms = [d, d.replace(os.homedir(), '~'), d.replace(os.homedir(), '$HOME')];
        const base = path.basename(d);
        if (forms.some((f) => cmd.includes(f)) || (base.length >= 2 && cmd.includes(base))) deny(d, '명령에 보호 폴더가 들어 있음');
      }
      break;
    }
  }
  process.exit(0);
});
