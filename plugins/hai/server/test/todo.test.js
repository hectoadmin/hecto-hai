import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.HAI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hai-todo-'));
const { addTodos, closeTodo, listTodos, todoText } = await import('../src/todo.js');
const file = path.join(process.env.HAI_DATA_DIR, 'todos.json');

test('할 일 더하기·같은 글 한 건·닫으면 빠짐', () => {
  assert.deepEqual(addTodos([{ text: '견적서 회신', owner: 'me', source: '메일', due: '11월 7일' }, { text: '견적서  회신!', owner: 'me' }, { text: '  ' }]), { added: 1, same: 2 });
  addTodos([{ text: '자료 받기', owner: 'other' }, { text: '접수 확인', owner: 'check' }, { text: '이상한 갈래', owner: 'x' }]);
  const rows = listTodos();
  assert.equal(rows.length, 4);
  assert.equal(rows.at(-1).owner, 'me');
  assert.match(todoText(rows), /내가 할 일 2건[\s\S]*견적서 회신 \(기한 11월 7일\) · 메일[\s\S]*남이 할 일 1건[\s\S]*확인할 일 1건/);
  closeTodo(rows[0].id, 'dismissed');
  assert.equal(listTodos().length, 3);
  assert.deepEqual(addTodos([{ text: '견적서 회신' }]), { added: 0, same: 1 });   // 닫은 일이 다시 올라오지 않는다
  assert.throws(() => closeTodo('없음', 'done'), /열린 할 일/);
});

test('파일은 본인만, 끝낸 지 90일 지나면 지운다', () => {
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const before = JSON.parse(fs.readFileSync(file, 'utf8')).length;
  addTodos([{ text: '새 일' }], Date.now() + 91 * 86400_000);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, before);   // 하나 지워지고 하나 더해짐
  assert.equal(todoText([]), '열린 할 일이 없습니다.');
});
