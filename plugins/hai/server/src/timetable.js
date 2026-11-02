/**
 * EVS 타임테이블 양식 채우기. EVS 타임테이블 등록 → 신규 → 년월 → '양식다운로드' 로 받은 엑셀에는
 * 그달 근무일마다 한 줄(# · 일자 · 업무코드 · 업무명 · 업무상세 · 법인 10칸)이 이미 들어 있다.
 * 그 줄에 업무와 법인별 시간을 넣어 'Excel 업로드' 에 바로 올릴 수 있는 파일로 저장한다.
 * 서식·열 너비는 양식 그대로 두고, 글자는 공유 문자열(sharedStrings)에 더한다 — 업로드 쪽이 인라인 문자열을 못 읽을 수 있어서.
 * 하루에 업무가 여럿이면 그날 줄을 늘린다(# 는 다시 매긴다).
 */
import JSZip from 'jszip';
import { unxml, excelDate } from './office.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const colIndex = (ref) => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const FIXED = ['#', '일자', '업무코드', '업무명', '업무상세'];
const r1 = (x) => Math.round(Number(x) * 10) / 10;

/**
 * @param {Buffer} buf  EVS 양식 xlsx
 * @param {{date:string, code:string, name:string, detail?:string, hours:Record<string,number>}[]} rows
 * @returns {{buffer:Buffer, companies:string[], filled:string[], empty:string[], totals:Record<string,number>, days:{date:string,sum:number}[]}}
 */
export async function fillTimetable(buf, rows) {
  const zip = await JSZip.loadAsync(buf);
  const sheetPath = 'xl/worksheets/sheet1.xml';
  let sheet = await zip.file(sheetPath)?.async('string');
  let sst = (await zip.file('xl/sharedStrings.xml')?.async('string')) ?? '';
  if (!sheet || !sst) throw new Error('EVS 타임테이블 양식이 아닙니다(시트·공유 문자열이 없음). EVS 에서 받은 양식 파일을 그대로 쓰세요.');
  const shared = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml(m[1].replace(/<[^>]+>/g, '')));

  const rowRe = /<row\b[^>]*>[\s\S]*?<\/row>/g;
  const allRows = sheet.match(rowRe) ?? [];
  const cellsOf = (row) => [...row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => ({
    col: colIndex(attr(c[1], 'r') ?? 'A1'), s: attr(c[1], 's'), t: attr(c[1], 't'), v: (c[2] ?? '').match(/<v>([\s\S]*?)<\/v>/)?.[1],
  }));
  const header = cellsOf(allRows[0] ?? '').map((c) => (c.t === 's' ? shared[Number(c.v)] : unxml(c.v ?? '')).trim());
  if (FIXED.some((h, i) => header[i] !== h)) throw new Error(`양식 머리글이 다릅니다: ${header.slice(0, 5).join(' · ')} (기대: ${FIXED.join(' · ')})`);
  const companies = header.slice(5).filter(Boolean);

  // 양식의 근무일 줄 — 날짜(엑셀 일련번호)와 칸별 서식
  const tmpl = allRows.slice(1).map((row) => {
    const cells = cellsOf(row);
    const b = cells.find((c) => c.col === 1);
    return { serial: b?.v, date: b?.v ? excelDate(b.v) : '', styles: Object.fromEntries(cells.map((c) => [c.col, c.s])) };
  }).filter((r) => r.date);
  if (!tmpl.length) throw new Error('양식에 근무일 줄이 없습니다. EVS 에서 년월을 고른 뒤 양식다운로드로 받은 파일인지 확인하세요.');

  // 입력 검사
  const byDate = new Map();
  for (const [i, r] of rows.entries()) {
    const where = `${i + 1}번째 줄(${r.date ?? '날짜 없음'})`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? '')) throw new Error(`${where}: 날짜는 YYYY-MM-DD 로`);
    if (!tmpl.some((t) => t.date === r.date)) throw new Error(`${where}: 양식에 없는 날짜입니다(휴일이거나 다른 달). 양식의 근무일: ${tmpl[0].date} ~ ${tmpl.at(-1).date}, ${tmpl.length}일`);
    if (!String(r.code ?? '').trim() || !String(r.name ?? '').trim()) throw new Error(`${where}: 업무코드와 업무명이 필요합니다`);
    for (const [k, h] of Object.entries(r.hours ?? {})) {
      if (!companies.includes(k)) throw new Error(`${where}: 법인 "${k}" 는 양식에 없습니다. 쓸 수 있는 이름: ${companies.join(' · ')}`);
      if (!(Number(h) >= 0)) throw new Error(`${where}: ${k} 시간이 숫자가 아닙니다`);
    }
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }

  const strIndex = (s) => { const v = String(s ?? ''); let i = shared.indexOf(v); if (i < 0) { shared.push(v); i = shared.length - 1; } return i; };
  const out = [];
  const totals = Object.fromEntries(companies.map((c) => [c, 0]));
  const days = [];
  for (const t of tmpl) {
    const list = byDate.get(t.date) ?? [null];
    let sum = 0;
    for (const r of list) {
      const n = out.length + 2;
      const st = (col) => (t.styles[col] ? ` s="${t.styles[col]}"` : '');
      const cells = [
        `<c r="A${n}"${st(0)}><v>${out.length + 1}</v></c>`,
        `<c r="B${n}"${st(1)}><v>${t.serial}</v></c>`,
        ...[r?.code, r?.name, r?.detail].map((v, k) => `<c r="${colName(2 + k)}${n}"${st(2 + k)} t="s"><v>${strIndex(String(v ?? '').trim())}</v></c>`),
        ...companies.map((c, k) => {
          const h = r1(r?.hours?.[c] ?? 0);
          sum += h; totals[c] = r1(totals[c] + h);
          return `<c r="${colName(5 + k)}${n}"${st(5 + k)}><v>${h}</v></c>`;
        }),
      ];
      out.push(`<row r="${n}" spans="1:${5 + companies.length}">${cells.join('')}</row>`);
    }
    days.push({ date: t.date, sum: r1(sum) });
  }

  const last = out.length + 1;
  sheet = sheet.replace(/<sheetData>[\s\S]*<\/sheetData>/, `<sheetData>${allRows[0]}${out.join('')}</sheetData>`)
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${colName(4 + companies.length)}${last}"/>`);
  const count = (sheet.match(/ t="s"/g) ?? []).length;
  sst = sst.replace(/<sst\b[^>]*>[\s\S]*<\/sst>/, (m) => m.replace(/^<sst\b[^>]*>/, (open) => open.replace(/count="\d+"/, `count="${count}"`).replace(/uniqueCount="\d+"/, `uniqueCount="${shared.length}"`))
    .replace(/<si>[\s\S]*<\/si>/, shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')));
  zip.file(sheetPath, sheet);
  zip.file('xl/sharedStrings.xml', sst);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { buffer, companies, filled: [...byDate.keys()], empty: tmpl.filter((t) => !byDate.has(t.date)).map((t) => t.date), totals, days };
}
