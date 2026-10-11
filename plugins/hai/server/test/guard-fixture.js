// 가드 시험용 폴더 — 임시 폴더 아래 Documents/인사(보호 폴더), 원문 파일, 원문 장부. 운영체제 꼴 경로(Windows 는 C:\…)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GUARD = fileURLToPath(new URL('../../hooks/guard.mjs', import.meta.url));

export function fixture(prefix) {
  // Windows 임시 폴더는 짧은 이름(RUNNER~1)일 수 있다 — 긴 이름으로
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const docs = path.join(root, 'Documents');
  const hr = path.join(docs, '인사');
  fs.mkdirSync(hr, { recursive: true });
  fs.writeFileSync(path.join(hr, 'a.txt'), 'x');
  const desk = path.join(root, 'Desktop');
  fs.mkdirSync(desk, { recursive: true });
  const data = path.join(root, '.hai-mcp');
  fs.mkdirSync(data, { recursive: true });
  const raw = path.join(docs, '회의 받아쓰기.txt');
  fs.writeFileSync(raw, 'x');
  fs.writeFileSync(path.join(data, 'raw-files.log'), `${raw}\n`);
  function decide(tool_name, tool_input, cwd = root, protectedDirs = hr) {
    const out = execFileSync(process.execPath, [GUARD], {
      input: JSON.stringify({ tool_name, tool_input, cwd }),
      env: { ...process.env, CLAUDE_PLUGIN_OPTION_PROTECTED_DIRS: protectedDirs, HAI_DATA_DIR: data, HAI_RAW_DIR: path.join(root, '없는 원문 폴더') },
    }).toString();
    return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : 'allow';
  }
  return { root, docs, hr, desk, data, raw, decide };
}
