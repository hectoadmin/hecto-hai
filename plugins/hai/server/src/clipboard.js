/**
 * 클립보드의 그림(캡처)을 메모리로만 읽는다 — 디스크에 파일을 만들지 않는다.
 * 저장하는 순간 DRM 이 걸리는 PC 에서 캡처를 바로 HAI 로 넘기려고 쓴다. Claude 에도 오지 않는다.
 *   Windows  PowerShell(System.Windows.Forms.Clipboard) → PNG
 *   macOS    osascript(JXA, NSPasteboard) → PNG (캡처가 TIFF 로만 있으면 PNG 로 바꾼다)
 *   Linux    wl-paste 또는 xclip
 */
import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { HaiError } from './hai.js';

const run = promisify(execFile);
const MAX = 20 * 1024 * 1024;
const NO_IMAGE = 'NO_IMAGE';

const WIN = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$img = [System.Windows.Forms.Clipboard]::GetImage()
if (-not $img) { [Console]::Out.Write('${NO_IMAGE}'); exit 0 }
$ms = New-Object System.IO.MemoryStream
$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))`;

const MAC = `ObjC.import('AppKit');
const pb = $.NSPasteboard.generalPasteboard;
let d = pb.dataForType($.NSPasteboardTypePNG);
if (d.isNil()) {
  const t = pb.dataForType($.NSPasteboardTypeTIFF);
  if (!t.isNil()) d = $.NSBitmapImageRep.imageRepWithData(t).representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
}
d.isNil() ? '${NO_IMAGE}' : d.base64EncodedStringWithOptions(0).js;`;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** base64 출력 → PNG Buffer. 그림이 없으면 null */
export function decodeOutput(out) {
  const s = String(out ?? '').trim();
  if (!s || s === NO_IMAGE) return null;
  const buf = Buffer.from(s, 'base64');
  if (!buf.subarray(0, 4).equals(PNG)) throw new HaiError('HAI_BAD_INPUT', '클립보드 그림을 PNG 로 읽지 못했습니다');
  return buf;
}

/** → { data: PNG Buffer, name: '클립보드 캡처 YYYYMMDD-HHMMSS.png' } */
export async function readClipboardImage() {
  const opt = { encoding: 'utf8', maxBuffer: MAX * 2, timeout: 30_000, windowsHide: true };
  let data;
  try {
    const p = os.platform();
    if (p === 'win32') {
      // 클립보드는 STA 스레드에서만 읽힌다
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(WIN, 'utf16le').toString('base64')], opt);
      data = decodeOutput(stdout);
    } else if (p === 'darwin') {
      const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', MAC], opt);
      data = decodeOutput(stdout);
    } else {
      data = await linux();
    }
  } catch (err) {
    if (err instanceof HaiError) throw err;
    if (process.env.HAI_DEBUG) process.stderr.write(`clipboard: ${String(err?.stderr || err?.message).slice(0, 300)}\n`);
    throw new HaiError('HAI_BAD_INPUT', '클립보드를 읽지 못했습니다. 다시 캡처한 뒤 해 보세요.');
  }
  if (!data) throw new HaiError('HAI_BAD_INPUT', '클립보드에 그림이 없습니다. 캡처(Windows: Win+Shift+S, macOS: Cmd+Ctrl+Shift+4)한 뒤 다시 하세요. 파일을 "복사"한 것은 그림이 아닙니다 — 그때는 파일 경로를 주세요.');
  if (data.length > MAX) throw new HaiError('HAI_BAD_INPUT', '클립보드 그림이 너무 큽니다(20MB 초과). 나눠서 캡처하세요.');
  return { data, name: `클립보드 캡처 ${stamp()}.png` };
}

async function linux() {
  for (const [cmd, args] of [['wl-paste', ['--type', 'image/png']], ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']]]) {
    try {
      const { stdout } = await run(cmd, args, { encoding: 'buffer', maxBuffer: MAX * 2, timeout: 30_000 });
      if (stdout.subarray(0, 4).equals(PNG)) return stdout;
    } catch { /* 다음 */ }
  }
  return null;
}

const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
