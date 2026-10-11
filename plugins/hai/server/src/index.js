#!/usr/bin/env node
/**
 * HAI MCP 서버 — 사내 LLM(Qwen)을 Claude 에 붙인다. 핵심은 "원문은 Qwen 만 읽는다":
 *   hai_mask_file  로컬 파일을 Qwen 이 읽고 개인정보를 [이름1] 같은 자리표시로 가려 Claude 에 넘긴다
 *   hai_ask_file   로컬 파일을 Qwen 만 읽고 답만 넘긴다(답에 섞인 개인정보도 가린다)
 *   hai_restore    Claude 가 쓴 글의 자리표시를 원래 값으로 되돌려 로컬 파일로만 저장한다
 *   hai_chat       Qwen 에 바로 묻기
 *   hai_status     키·연결 점검
 * 원래 값(가리기 전)은 이 프로세스 메모리에만 있고 도구 결과로 나가지 않는다.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { config, apiKey } from './config.js';
import { chat, HaiError } from './hai.js';
import { Vault, maskPatterns, maskSpans, residual } from './mask.js';
import { findSpans, chunk, DEFAULT_TYPES } from './ner.js';
import { readText, resolvePath } from './extract.js';

const VERSION = '0.1.0';
const VAULT_TTL_MS = 12 * 3600_000;
const vaults = new Map();

function newVault() {
  for (const [id, v] of vaults) if (Date.now() - v.created > VAULT_TTL_MS) vaults.delete(id);
  const v = new Vault();
  vaults.set(v.id, v);
  return v;
}

const ok = (text) => ({ content: [{ type: 'text', text }] });
const fail = (err) => ({ isError: true, content: [{ type: 'text', text: err instanceof HaiError ? `[${err.code}] ${err.message}` : String(err?.message ?? err) }] });
const guard = (fn) => async (args) => { try { return await fn(args); } catch (err) { return fail(err); } };
const counts = (v) => Object.entries(v.summary()).map(([t, n]) => `${t} ${n}`).join(', ') || '없음';

/** 정규식 → Qwen 순서로 가린다. Qwen 이 실패하면 전체 실패(fail closed) */
async function maskAll(text, vault, { types, extra }) {
  const keepDomains = config.keepDomains;
  const first = maskPatterns(text, vault, { keepDomains });
  const spans = await findSpans(first, { types, extra });
  const out = maskSpans(first, spans, vault);
  const left = residual(out, { keepDomains });
  if (left) throw new Error(`가린 뒤에도 개인정보 모양이 ${left}건 남아 결과를 내보내지 않았습니다(버그). 원문은 넘기지 않았습니다.`);
  return out;
}

const typesSchema = z.array(z.string()).optional().describe(`찾아 가릴 유형. 기본 ${DEFAULT_TYPES.join('·')} (전화·주민번호·이메일·계좌·카드·여권·면허 번호는 항상 가린다)`);
const extraSchema = z.record(z.string(), z.string()).optional().describe('더 가릴 민감정보 유형과 설명. 예: {"거래처명":"계약 상대 회사 이름", "금액":"계약 금액"}');

const server = new McpServer({ name: 'hai', version: VERSION });

server.registerTool('hai_mask_file', {
  title: '파일을 가려서 읽기',
  description: [
    '로컬 파일(txt·md·csv·json·pdf·docx)을 사내 Qwen(HAI)이 먼저 읽어 개인정보를 [이름1]·[휴대전화1] 같은 자리표시로 바꾼 텍스트를 돌려준다.',
    '민감한 파일은 Read 로 열지 말고 이 도구로 읽는다. 원문은 Claude 에 오지 않는다.',
    '돌려받은 mask_id 로 hai_restore 를 부르면 Claude 가 쓴 결과물의 자리표시를 원래 값으로 바꿔 로컬 파일로 저장할 수 있다.',
    '자동 가림이라 놓칠 수 있다 — 결과에 실명·연락처가 보이면 사용자에게 알리고 extra 로 다시 부른다.',
  ].join(' '),
  inputSchema: { path: z.string().describe('파일 경로(절대 경로 또는 ~/...)'), types: typesSchema, extra: extraSchema, mask_id: z.string().optional().describe('이전 결과와 같은 자리표시 번호를 쓰려면 그 mask_id') },
}, guard(async ({ path: p, types, extra, mask_id }) => {
  const { file, text } = await readText(p);
  const vault = (mask_id && vaults.get(mask_id)) || newVault();
  const masked = await maskAll(text, vault, { types, extra });
  return ok([
    `mask_id: ${vault.id}`,
    `파일: ${path.basename(file)} (${text.length.toLocaleString()}자)`,
    `가린 것(서로 다른 값 수): ${counts(vault)}`,
    '--- 가린 본문 ---',
    masked,
  ].join('\n'));
}));

server.registerTool('hai_ask_file', {
  title: '파일을 Qwen 만 읽고 답하기',
  description: [
    '로컬 파일을 사내 Qwen(HAI)만 읽고 instruction 에 대한 답만 돌려준다. 원문은 Claude 에 오지 않는다.',
    '답에 섞인 개인정보도 자리표시로 가린다(mask_id 로 hai_restore 가능).',
    '요약·특정 조항 찾기·목록 뽑기처럼 원문 전체가 Claude 에 필요 없을 때 쓴다. 긴 파일은 조각마다 읽고 합친다.',
  ].join(' '),
  inputSchema: { path: z.string(), instruction: z.string().describe('Qwen 에게 시킬 일. 예: "계약 기간·해지 조건·위약금 조항을 조항 번호와 함께 정리"'), types: typesSchema, extra: extraSchema },
}, guard(async ({ path: p, instruction, types, extra }) => {
  const { file, text } = await readText(p);
  const system = '너는 회사 문서를 읽고 요청에 답하는 사내 비서다. 한국어로, 문서에 근거해서만 답한다. 문서에 없으면 없다고 한다. 조항·쪽 번호가 있으면 함께 적는다.';
  const parts = chunk(text, 12000);
  let answer;
  if (parts.length === 1) {
    answer = (await chat({ messages: [{ role: 'system', content: system }, { role: 'user', content: `<문서>\n${text}\n</문서>\n\n요청: ${instruction}` }] })).content;
  } else {
    const notes = [];
    for (const [i, part] of parts.entries()) {
      const r = await chat({ maxTokens: 1200, messages: [{ role: 'system', content: system },
        { role: 'user', content: `<문서 조각 ${i + 1}/${parts.length}>\n${part}\n</문서 조각>\n\n최종 요청: ${instruction}\n이 조각에서 요청과 관련된 내용만 근거와 함께 뽑아라. 없으면 "없음".` }] });
      if (!/^\s*없음\s*$/.test(r.content)) notes.push(`[조각 ${i + 1}]\n${r.content}`);
    }
    answer = notes.length
      ? (await chat({ messages: [{ role: 'system', content: system }, { role: 'user', content: `아래는 한 문서를 조각별로 읽고 뽑은 메모다.\n\n${notes.join('\n\n')}\n\n요청: ${instruction}\n메모를 합쳐 최종 답을 써라.` }] })).content
      : '문서에서 요청과 관련된 내용을 찾지 못했습니다.';
  }
  const vault = newVault();
  const masked = await maskAll(answer, vault, { types, extra });
  return ok([`mask_id: ${vault.id}`, `파일: ${path.basename(file)} (${text.length.toLocaleString()}자, ${parts.length}조각) · Qwen 답의 가린 것: ${counts(vault)}`, '--- 답 ---', masked].join('\n'));
}));

server.registerTool('hai_restore', {
  title: '자리표시를 원래 값으로 되돌려 저장',
  description: 'hai_mask_file/hai_ask_file 결과로 Claude 가 만든 글의 [이름1] 같은 자리표시를 원래 값으로 바꿔 로컬 파일에만 저장한다. 원래 값은 Claude 에 돌려주지 않는다. 같은 세션(12시간) 안에서만 된다.',
  inputSchema: { mask_id: z.string(), text: z.string().describe('자리표시가 들어 있는 글'), out_path: z.string().describe('저장할 파일 경로'), overwrite: z.boolean().optional() },
}, guard(async ({ mask_id, text, out_path, overwrite }) => {
  const vault = vaults.get(mask_id);
  if (!vault) throw new Error('mask_id 를 찾을 수 없습니다(MCP 서버가 다시 시작됐거나 12시간이 지났습니다). 파일을 다시 가려서 읽으세요.');
  const file = resolvePath(out_path);
  const exists = await fs.stat(file).then(() => true, () => false);
  if (exists && !overwrite) throw new Error(`이미 있는 파일입니다: ${file} — 덮어쓰려면 overwrite: true`);
  const { text: restored, restored: n } = vault.restore(text);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, restored, { mode: 0o600 });
  return ok(`저장: ${file} (자리표시 ${n}곳 복원). 내용은 여기 싣지 않습니다.`);
}));

server.registerTool('hai_chat', {
  title: 'Qwen 에 묻기',
  description: '사내 Qwen(HAI)에 바로 묻는다. 한국어 문장 다듬기·번역·두 번째 의견용. 여기 넣는 글은 이미 Claude 가 본 글이다 — 민감한 파일은 hai_ask_file 을 쓴다.',
  inputSchema: { prompt: z.string(), system: z.string().optional(), max_tokens: z.number().int().min(16).max(8000).optional() },
}, guard(async ({ prompt, system, max_tokens }) => {
  const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }];
  const r = await chat({ messages, maxTokens: max_tokens ?? 2000, temperature: 0.3 });
  return ok(`${r.content}\n\n(모델: ${r.model ?? config.chatService})`);
}));

server.registerTool('hai_status', {
  title: 'HAI 연결 점검',
  description: 'HAI 키가 설정됐는지, 게이트웨이에 연결되는지, 어떤 모델이 답하는지 확인한다. 처음 쓸 때나 오류가 날 때 먼저 부른다.',
  inputSchema: {},
}, guard(async () => {
  const { source } = apiKey();
  const lines = [`hai-mcp ${VERSION}`, `게이트웨이: ${config.baseUrl} (서비스 ${config.chatService})`, `키: ${source ? (source === 'env' ? '플러그인 설정' : 'macOS 키체인') : '없음'}`];
  if (!source) return ok([...lines, '→ 키가 없습니다. /plugin 에서 hai 플러그인 설정에 개인 HAI 키를 넣으세요.'].join('\n'));
  try {
    const t0 = Date.now();
    const r = await chat({ messages: [{ role: 'user', content: '"연결됨" 한 단어로만 답해.' }], maxTokens: 10, timeoutMs: 15000 });
    lines.push(`연결: 됨 (${Date.now() - t0}ms, 모델 ${r.model ?? '?'})`);
  } catch (err) {
    lines.push(`연결: 안 됨 — ${err.message}`);
    if (err.code === 'HAI_KEY_INVALID') lines.push('→ 키가 틀렸거나 만료됐습니다. 새로 발급받아 플러그인 설정에 다시 넣으세요.');
    if (err.code === 'HAI_UNREACHABLE') lines.push('→ 사내망(또는 허용된 IP)에서만 됩니다. VPN·네트워크를 확인하세요.');
  }
  return ok(lines.join('\n'));
}));

await server.connect(new StdioServerTransport());
