#!/usr/bin/env python3
"""Generate the docs-site diagrams as static SVG files in the Hecto visual language.

Hecto rules applied here (hecto-design skill): square corners, no shadows, no emoji,
orange #FF6114 as the single accent with black and white, 1px/2px borders for depth.

Each diagram is laid out by hand (explicit coordinates) and written twice:
<name>.svg for the light theme and <name>-dark.svg for the dark theme.
The <Diagram> component in components/Diagram.jsx shows the one matching the theme.

Edit a diagram below, then run:  python3 docs-site/diagrams/build.py
(Builder copied from the AEF docs site — same look.)
"""
import os
from html import escape

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'diagrams')
FONT = "'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif"

# tone: (fill, stroke, text)
THEMES = {
    'light': {
        'tones': {
            'step':  ('#FFFFFF', '#101010', '#101010'),
            'user':  ('#FFF0E8', '#FF6114', '#101010'),
            'done':  ('#FF6114', '#FF6114', '#000000'),
            'stop':  ('#101010', '#101010', '#FFFFFF'),
            'gate':  ('#F1F1F0', '#6B6B6B', '#101010'),
            'plain': ('#F8F8F7', '#A3A3A3', '#2E2E2E'),
        },
        'line': '#6B6B6B',
        'label': ('#FFFFFF', '#E4E4E4', '#6B6B6B'),
        'badge': ('#101010', '#FFFFFF'),
    },
    'dark': {
        'tones': {
            'step':  ('#1A1A1A', '#FFFFFF', '#FFFFFF'),
            'user':  ('#2A1710', '#FF7A38', '#FFFFFF'),
            'done':  ('#FF7A38', '#FF7A38', '#101010'),
            'stop':  ('#FFFFFF', '#FFFFFF', '#101010'),
            'gate':  ('#232323', '#A3A3A3', '#FFFFFF'),
            'plain': ('#101010', '#6B6B6B', '#E4E4E4'),
        },
        'line': '#A3A3A3',
        'label': ('#101010', '#2E2E2E', '#A3A3A3'),
        'badge': ('#FFFFFF', '#101010'),
    },
}


class Diagram:
    def __init__(self, width, height, title, theme):
        self.w, self.h, self.title = width, height, title
        self.t = THEMES[theme]
        self.parts = []
        self.nodes = {}

    @property
    def line(self):
        return self.t['line']

    def box(self, key, x, y, w, h, lines, tone='step', shape='rect', num=None):
        fill, stroke, text = self.t['tones'][tone]
        if shape == 'diamond':
            cx, cy = x + w / 2, y + h / 2
            pts = f'{cx},{y} {x + w},{cy} {cx},{y + h} {x},{cy}'
            self.parts.append(f'<polygon points="{pts}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>')
        else:
            self.parts.append(
                f'<rect x="{x}" y="{y}" width="{w}" height="{h}" '
                f'fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>')
        if num is not None:
            bg, fg = self.t['badge']
            if tone in ('done', 'stop'):
                bg, fg = text, fill
            self.parts.append(f'<rect x="{x}" y="{y}" width="26" height="26" fill="{bg}"/>')
            self.parts.append(
                f'<text x="{x + 13}" y="{y + 13}" fill="{fg}" font-size="13" font-weight="700" '
                f'text-anchor="middle" dominant-baseline="central">{num}</text>')
        self.text(x + w / 2, y + h / 2, lines, text)
        self.nodes[key] = (x, y, w, h)

    def text(self, cx, cy, lines, color, size=15):
        if isinstance(lines, str):
            lines = [lines]
        lh = size * 1.35
        top = cy - lh * (len(lines) - 1) / 2
        for i, line in enumerate(lines):
            weight = '700' if i == 0 else '400'
            sz = size if i == 0 else size - 2
            self.parts.append(
                f'<text x="{cx}" y="{top + i * lh}" fill="{color}" font-size="{sz}" '
                f'font-weight="{weight}" letter-spacing="-0.02em" text-anchor="middle" '
                f'dominant-baseline="central">{escape(line)}</text>')

    def group(self, x, y, w, h, label):
        self.parts.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="none" '
            f'stroke="{self.line}" stroke-width="1" stroke-dasharray="6 5"/>')
        self.label(x + 16, y, label, anchor='start')

    def label(self, x, y, text, anchor='middle'):
        fill, stroke, color = self.t['label']
        width = text_width(text, 13) + 18
        left = x - width / 2 if anchor == 'middle' else x
        self.parts.append(
            f'<rect x="{left}" y="{y - 12}" width="{width}" height="24" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="1"/>')
        self.parts.append(
            f'<text x="{left + width / 2}" y="{y}" fill="{color}" font-size="13" '
            f'text-anchor="middle" dominant-baseline="central">{escape(text)}</text>')

    def anchor(self, key, side):
        x, y, w, h = self.nodes[key]
        if isinstance(side, tuple):  # ('t' or 'b', absolute x) for an off-center exit
            edge, px = side
            return (px, y if edge == 't' else y + h)
        return {'r': (x + w, y + h / 2), 'l': (x, y + h / 2),
                't': (x + w / 2, y), 'b': (x + w / 2, y + h)}[side]

    def arrow(self, a, a_side, b, b_side, label=None, dashed=False, via=None, label_at=None):
        p1, p2 = self.anchor(a, a_side), self.anchor(b, b_side)
        pts = [p1] + (via or []) + [p2]
        d = 'M ' + ' L '.join(f'{x},{y}' for x, y in pts)
        dash = ' stroke-dasharray="7 6"' if dashed else ''
        self.parts.append(
            f'<path d="{d}" fill="none" stroke="{self.line}" stroke-width="1.5"{dash} marker-end="url(#head)"/>')
        if label:
            if label_at:
                lx, ly = label_at
            else:
                mid = len(pts) // 2
                (x1, y1), (x2, y2) = pts[mid - 1], pts[mid]
                lx, ly = (x1 + x2) / 2, (y1 + y2) / 2
            self.label(lx, ly, label)

    def raw(self, svg):
        self.parts.append(svg)

    def write(self, name, theme):
        suffix = '' if theme == 'light' else '-dark'
        head = (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" '
            f'width="{self.w}" height="{self.h}" role="img" aria-label="{escape(self.title)}" '
            f'font-family="{escape(FONT)}">\n<title>{escape(self.title)}</title>\n'
            f'<defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
            f'markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{self.line}"/>'
            f'</marker></defs>\n')
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, f'{name}{suffix}.svg'), 'w', encoding='utf-8') as f:
            f.write(head + '\n'.join(self.parts) + '\n</svg>\n')


def text_width(text, size):
    return sum(size if ord(c) > 0x2E80 else size * 0.58 for c in text)


# ── index: where the original goes ────────────────────────────────────────────
def home_flow(theme):
    d = Diagram(760, 330, '원문은 사내 AI 만 읽고, Claude 는 가린 글만 본다', theme)
    W, H = 180, 70
    xs = [30, 290, 550]
    d.box('file', xs[0], 40, W, H, ['내 PC 파일', '문서·스캔·녹음'], 'user', num=1)
    d.box('hai', xs[1], 40, W, H, ['사내 AI(HAI)', '읽기·받아쓰기·가리기'], num=2)
    d.box('claude', xs[2], 40, W, H, ['Claude', '정리·초안·집계'], num=3)
    d.box('out', xs[2], 220, W, H, ['실명 결과 파일', '내 PC 에만 저장'], 'done', num=4)
    d.box('block', xs[0], 220, W, H, ['원본 직접 열기', '보호 훅이 막음'], 'stop')
    d.arrow('file', 'r', 'hai', 'l', label='원문')
    d.arrow('hai', 'r', 'claude', 'l', label='가린 글')
    d.arrow('claude', 'b', 'out', 't', label='실명은 내 PC 에서만')
    d.arrow('block', 't', 'file', 'b', dashed=True, label='Claude 가 직접 열면')
    return d, 'home-flow'


# ── privacy: how masking works ────────────────────────────────────────────────
def masking_steps(theme):
    d = Diagram(760, 300, '개인정보를 가리는 순서', theme)
    W, H = 160, 70
    xs = [20, 205, 390, 575]
    d.box('t', xs[0], 40, W, H, ['표 열 가리기', '성명·연락처 열'], num=1)
    d.box('p', xs[1], 40, W, H, ['모양으로', '주민번호·전화·계좌'], num=2)
    d.box('n', xs[2], 40, W, H, ['사내 AI 가 찾기', '이름·주소·생년월일'], num=3)
    d.box('c', xs[3], 40, W, H, ['남은 것 검사', '하나라도 남으면'], 'gate', num=4)
    d.box('ok', xs[2], 200, W, H, ['[이름1] 자리표시', 'Claude 에게'], 'done')
    d.box('stop', xs[3], 200, W, H, ['넘기지 않고 실패'], 'stop')
    d.arrow('t', 'r', 'p', 'l')
    d.arrow('p', 'r', 'n', 'l')
    d.arrow('n', 'r', 'c', 'l')
    d.arrow('c', ('b', 620), 'ok', ('t', 470), via=[(620, 150), (470, 150)], label='깨끗하면', label_at=(545, 150))
    d.arrow('c', ('b', 690), 'stop', ('t', 690), label='남으면', label_at=(690, 170))
    return d, 'masking-steps'


# ── privacy: protection layers per OS ─────────────────────────────────────────
def protect_layers(theme):
    d = Diagram(760, 330, '원본을 지키는 세 겹', theme)
    d.box('l1', 30, 30, 700, 70, ['1. HAI 도구 — 원문은 사내 AI 만 읽는다', '모든 PC · 가장 중요한 겹'], 'user')
    d.box('l2', 30, 130, 700, 70, ['2. 보호 훅 — Read·Grep·Bash·PowerShell 이 보호 폴더를 열면 막는다', '모든 PC · 명령 글자를 보고 판단(실수 방지 안전망)'])
    d.box('mac', 30, 230, 340, 70, ['3. 샌드박스 (Mac·Linux)', '운영체제가 읽기 자체를 막음 · /hai:protect'], 'done')
    d.box('win', 390, 230, 340, 70, ['3. Windows', '기본 도구 차단 규칙 + 명령 실행 확인'], 'gate')
    return d, 'protect-layers'


BUILDERS = [home_flow, masking_steps, protect_layers]

if __name__ == '__main__':
    for theme in THEMES:
        for build in BUILDERS:
            diagram, name = build(theme)
            diagram.write(name, theme)
    print(f'wrote {len(BUILDERS) * len(THEMES)} diagrams to {os.path.normpath(OUT)}')
