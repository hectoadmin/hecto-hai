/**
 * 표(엑셀·CSV·TSV) 열 단위 가리기 — 머리글이 "성명·사번·연락처·차량번호…"인 열은 칸 전체를 자리표시로 바꾼다.
 * 명단 수백 줄을 Qwen 에 한 칸씩 찾게 하면 답이 길어 잘리고 느리다. 열을 먼저 가리면 Qwen 은 비고 같은 나머지 칸만 보면 된다.
 * 엑셀은 office.js 가 "## 시트: 이름" 아래 탭 구분으로 펼친 글, CSV 는 쉼표(따옴표 규칙 포함).
 */

/** 머리글 → 자리표시 유형. 위에서부터 먼저 맞는 것 */
const HEADER_TYPES = [
  [/주민(등록)?번호|resident/i, '주민등록번호'],
  [/외국인등록|여권/i, '여권번호'],
  [/(휴대|핸드)폰|휴대전화|연락처|전화|mobile|phone|tel/i, '전화번호'],
  [/e-?mail|이메일|메일/i, '이메일'],
  [/계좌/i, '계좌번호'],
  [/카드번호/i, '카드번호'],
  [/생년월일|생일|birth/i, '생년월일'],
  [/(^|[^회])사(번|원번호)|직원번호|임직원번호|회원번호|학번|employee.?(id|no)/i, '식별번호'],
  [/차량번호|차번|번호판|plate/i, '식별번호'],
  [/주소|거주지|address/i, '주소'],
  [/^(성명|이름|name|성함)$|성명|이름|(신청|담당|작성|대상|수령|예금|임대|임차|보호|운전|참석|요청)(자|인)$|직원명|사원명|고객명|환자명|^(대상자|신청자|담당자|작성자|수령인|예금주)/i, '이름'],
];

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
const csvCell = (v, sep) => (/["\n]/.test(v) || v.includes(sep) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * 표 형태 글의 열을 가린다 → { text, columns: [{header, type}] }
 * format: 'tsv'(엑셀 펼친 글·TSV) | 'csv'
 */
export function maskTable(text, vault, format) {
  const sep = format === 'csv' ? ',' : '\t';
  const lines = text.split('\n');
  const columns = [];
  let colTypes = null; // 현재 표(시트)의 열 → 유형
  const out = lines.map((line) => {
    if (line.startsWith('## 시트:')) { colTypes = null; return line; } // 시트가 바뀌면 머리글을 다시 찾는다
    if (!line.trim()) return line;
    const cells = sep === ',' ? parseCsvLine(line, sep) : line.split(sep);
    if (!colTypes) {
      const types = cells.map(headerType);
      if (types.some(Boolean)) {
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
