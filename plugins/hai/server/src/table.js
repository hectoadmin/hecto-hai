/**
 * 표(엑셀·CSV·TSV) 열 단위 가리기 — 머리글이 "성명·사번·연락처·차량번호…"인 열은 칸 전체를 자리표시로 바꾼다.
 * 명단 수백 줄을 Qwen 에 한 칸씩 찾게 하면 답이 길어 잘리고 느리다. 열을 먼저 가리면 Qwen 은 비고 같은 나머지 칸만 보면 된다.
 * 엑셀은 office.js 가 "## 시트: 이름" 아래 탭 구분으로 펼친 글, CSV 는 쉼표(따옴표 규칙 포함).
 */

/** 머리글 → 자리표시 유형. 위에서부터 먼저 맞는 것. 글자 일부만 맞아도 되는 넓은 규칙은 피한다("회사이름"·"Hotel"·"메일링동의") */
const ROLE = '(고객|직원|사원|임직원|신청|담당|작성|대상|수령|예금|임대|임차|보호|운전|참석|참가|요청|수강|교육|대표|계약|보증|연대보증|입주|방문|민원|제보|피해|가해)';
const HEADER_TYPES = [
  [/주민(등록)?번호|resident/i, '주민등록번호'],
  [/외국인등록번호|여권번호|passport/i, '여권번호'],
  [/(휴대|핸드)폰|휴대전화|연락처|전화번호|^전화$|\b(tel|phone|mobile|cell)\b/i, '전화번호'],
  [/^(e-?mail|이메일|메일|메일주소|전자우편)(주소)?$|^이메일|e-?mail ?(address)?$/i, '이메일'],
  [/계좌(번호)?$|^계좌|account ?no/i, '계좌번호'],
  [/카드번호/i, '카드번호'],
  [/생년월일|^생일$|birth/i, '생년월일'],
  [/^(사번|사원번호|직원번호|임직원번호|회원번호|학번)$|employee ?(id|no)/i, '식별번호'],
  [/차량번호|^차번$|번호판|plate/i, '식별번호'],
  [/주소|거주지|address/i, '주소'],
  [new RegExp(`^(한글|영문|국문)?(성명|이름|성함)$|^(full ?)?name$|^${ROLE}((자|인|생|주)(명|이름|성명)?|명|이름|성명)$`, 'i'), '이름'],
];

/** 머리글 줄로 볼까: 칸이 2개 이상, 칸이 다 짧고 숫자가 아니며, 아는 머리글이 하나 이상 — 제목 한 칸짜리 줄("임직원 연락처 명단")은 아니다 */
function headerRow(cells) {
  const filled = cells.map((c) => String(c ?? '').trim()).filter(Boolean);
  if (filled.length < 2 || filled.some((c) => c.length > 20 || /^[\d\s,.\-:/]+$/.test(c))) return null;
  const types = cells.map(headerType);
  return types.some(Boolean) ? types : null;
}

export function headerType(cell) {
  const h = String(cell ?? '').replace(/\s+/g, '').trim();
  if (!h || h.length > 20) return null;
  for (const [re, type] of HEADER_TYPES) if (re.test(h)) return type;
  return null;
}

// ── CSV ──────────────────────────────────────────────────────────────

export function parseCsvLine(line, sep = ',') {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
/** CSV 를 논리 행으로 — 따옴표 안의 줄바꿈("주소\n2층")은 한 행 */
export function csvRows(text) {
  const rows = [];
  let cur = null;
  for (const line of text.split('\n')) {
    cur = cur === null ? line : `${cur}\n${line}`;
    if ((cur.match(/"/g)?.length ?? 0) % 2 === 0) { rows.push(cur); cur = null; }
  }
  if (cur !== null) rows.push(cur);
  return rows;
}
const csvCell = (v, sep) => (/["\n]/.test(v) || v.includes(sep) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * 표 형태 글의 열을 가린다 → { text, columns: [{header, type}] }
 * format: 'tsv'(엑셀 펼친 글·TSV) | 'csv'
 */
export function maskTable(text, vault, format) {
  const sep = format === 'csv' ? ',' : '\t';
  const lines = format === 'csv' ? csvRows(text) : text.split('\n');
  const columns = [];
  let colTypes = null; // 현재 표(시트)의 열 → 유형
  const out = lines.map((line) => {
    if (line.startsWith('## 시트:')) { colTypes = null; return line; } // 시트가 바뀌면 머리글을 다시 찾는다
    if (!line.trim()) return line;
    const cells = sep === ',' ? parseCsvLine(line, sep) : line.split(sep);
    if (!colTypes) {
      const types = headerRow(cells);
      if (types) {
        colTypes = types;
        types.forEach((t, i) => t && columns.push({ header: cells[i].trim(), type: t }));
      }
      return line; // 머리글 줄은 그대로
    }
    let changed = false;
    const masked = cells.map((c, i) => {
      const t = colTypes[i];
      const v = c.trim();
      if (!t || !v || /^\[[^\]]+\d\]$/.test(v) || /^[-–·.\s]+$/.test(v)) return c;
      changed = true;
      return vault.placeholder(t, v);
    });
    return changed ? masked.map((c) => (sep === ',' ? csvCell(c, sep) : c)).join(sep) : line;
  });
  return { text: out.join('\n'), columns };
}
