// 하위 폴더를 훑는 코드 판정 — 홈을 가리키는 스크립트에서 주석 표시(/** … */)를 와일드카드(/**)로 읽어 막던 오탐.
// 진짜 훑기(홈 + '/**' · Path.home().rglob)는 그대로 막아야 한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GUARD } from './guard-fixture.js';

const bashTest = process.platform === 'win32' ? test.skip : test; // bash 문법·POSIX 경로

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hai-guard-walk-')));
const hr = path.join(root, 'Documents', '인사');
fs.mkdirSync(hr, { recursive: true });
const data = path.join(root, 'hai-data');
fs.mkdirSync(data, { recursive: true });
const proj = path.join(root, 'proj');
fs.mkdirSync(proj, { recursive: true });

/** 홈을 임시 폴더로 두고, proj 에 스크립트를 써서 `node|python3 <파일>` 을 판정한다 */
function run(file, body) {
  fs.writeFileSync(path.join(proj, file), body);
  const out = execFileSync(process.execPath, [GUARD], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: `${file.endsWith('.py') ? 'python3' : 'node'} ${file} status` }, cwd: proj }),
    env: { ...process.env, HOME: root, USERPROFILE: root, CLAUDE_PLUGIN_OPTION_PROTECTED_DIRS: hr, HAI_DATA_DIR: data, HAI_RAW_DIR: path.join(root, '없는 원문 폴더') },
  }).toString();
  return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : 'allow';
}

bashTest('홈을 가리키는 스크립트의 주석 표시(/** · **/)는 훑기가 아니다', () => {
  const head = "import { homedir } from 'node:os';\nimport { mkdirSync, watch } from 'node:fs';\n";
  assert.equal(run('jsdoc.js', `${head}/** hai status — 데몬이 살아 있나 */\nexport function status() { return homedir(); }\n`), 'allow');
  assert.equal(run('indented.js', `${head}function f() {\n  /**\n   * 다운로드 폴더 감시\n   */\n  watch(homedir());\n}\n`), 'allow');
  assert.equal(run('closing.js', `${head}/** 설명 **/\nmkdirSync(homedir() + '/.hai-cli', { recursive: true });\n`), 'allow');
});

bashTest('홈을 하위 폴더까지 훑는 스크립트는 그대로 막는다', () => {
  const head = "import { homedir } from 'node:os';\nimport glob from 'glob';\n";
  assert.equal(run('walk-a.js', `${head}/** 모든 파일 */\nconst h = homedir();\nconsole.log(glob.sync(h + '/**'));\n`), 'deny');
  assert.equal(run('walk-b.js', `${head}console.log(glob.sync(homedir() + '/**/*.txt'));\n`), 'deny');
  assert.equal(run('walk-c.js', `${head}console.log(glob.sync(\`\${homedir()}/**\`));\n`), 'deny');
  assert.equal(run('walk-d.py', "from pathlib import Path\nfor f in Path.home().rglob('*.txt'):\n    print(f)\n"), 'deny');
});
