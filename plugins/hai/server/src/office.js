/**
 * 엑셀(xlsx)·한글(hwpx) → 텍스트. 둘 다 zip 안의 XML 이라 jszip 으로 열고 필요한 태그만 읽는다(서식·그림은 버린다).
 * 옛 한글(.hwp, 바이너리)·옛 엑셀(.xls)은 못 읽는다 — PDF·xlsx 로 다시 저장해서 쓴다.
 */
import JSZip from 'jszip';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const unxml = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENT[e.toLowerCase()] ?? m;
});
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const texts = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => unxml(m[1].replace(/<[^>]+>/g, '')));

// ── xlsx ──────────────────────────────────────────────────────────────

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const colIndex = (ref) => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** 엑셀 날짜 일련번호 → YYYY-MM-DD(시간이 있으면 HH:MM) */
export function excelDate(serial, date1904 = false) {
  const ms = Math.round((Number(serial) + (date1904 ? 1462 : 0) - 25569) * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(serial);
  const iso = d.toISOString();
  return Number(serial) % 1 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

export async function readXlsx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const read = async (p) => (await zip.file(p)?.async('string')) ?? '';
  const wb = await read('xl/workbook.xml');
  if (!wb) throw new Error('엑셀 파일 구조를 읽지 못했습니다');
  const date1904 = /date1904="(1|true)"/.test(wb);
  const rels = Object.fromEntries([...(await read('xl/_rels/workbook.xml.rels')).matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const shared = [...(await read('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1], 't').join(''));

  // 날짜 서식인 스타일 번호
  const styles = await read('xl/styles.xml');
  const custom = Object.fromEntries([...styles.matchAll(/<numFmt\b[^>]*>/g)].map((m) => [Number(attr(m[0], 'numFmtId')), unxml(attr(m[0], 'formatCode') ?? '')]));
  const isDateFmt = (id) => BUILTIN_DATE.has(id) || (custom[id] !== undefined && /[ymd]/i.test(custom[id].replace(/"[^"]*"|\[[^\]]*\]/g, '')));
  const xfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  const dateStyle = [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => isDateFmt(Number(attr(m[0], 'numFmtId') ?? 0)));

  const out = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unxml(attr(m[0], 'name') ?? '');
    if (attr(m[0], 'state') === 'hidden' || attr(m[0], 'state') === 'veryHidden') continue;
    const target = rels[attr(m[0], 'r:id')] ?? '';
    const sheet = await read(target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
    const rows = [];
    for (const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const head = c[1], body = c[2] ?? '';
        const ref = attr(head, 'r');
        const t = attr(head, 't');
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val = '';
        if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = texts(body, 't').join('');
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else if (v !== undefined) val = t === 'str' || t === 'e' ? unxml(v) : dateStyle[Number(attr(head, 's') ?? 0)] ? excelDate(v, date1904) : v;
        const i = ref ? colIndex(ref) : cells.length;
        cells[i] = val.replace(/[\t\r\n]+/g, ' ').trim();
      }
      const line = Array.from(cells, (x) => x ?? '').join('\t').replace(/\t+$/, '');
      if (line) rows.push(line);
    }
    if (rows.length) out.push(`## 시트: ${name}\n${rows.join('\n')}`);
  }
  return out.join('\n\n');
}

// ── hwpx ──────────────────────────────────────────────────────────────

export async function readHwpx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const sections = Object.keys(zip.files).filter((p) => /^Contents\/section\d+\.xml$/i.test(p))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (!sections.length) throw new Error('한글(hwpx) 본문을 찾지 못했습니다');
  const paras = [];
  for (const p of sections) {
    const xml = await zip.file(p).async('string');
    for (const para of xml.split(/<\/hp:p>/)) {
      const line = texts(para.replace(/<hp:(tab|lineBreak)\b[^>]*\/>/g, ' '), 'hp:t').join('').trim();
      if (line) paras.push(line);
    }
  }
  return paras.join('\n');
}
