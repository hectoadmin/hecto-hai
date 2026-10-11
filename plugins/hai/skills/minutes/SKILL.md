---
name: minutes
description: 회의 녹음을 사내 AI 로 받아써 회의록을 만든다 — 녹음 원문은 HAI 만 듣고 Claude 는 회의록(이름 가림)만 본다. 사용법 /hai:minutes <녹음 파일> [참석자·용어]
argument-hint: <녹음 파일(m4a·mp3·wav)> [고유명사·용어]
---

# 회의록

인자: $ARGUMENTS

1. 첫 단어(따옴표 안이면 그 전체)를 녹음 파일로, 나머지를 인식을 돕는 용어(사람·회사·제품 이름)로 본다.
2. 전화·상담 녹음이면 `engine: "qwen"`, 그 밖은 기본(whisper).
3. `hai_ask_file(path, instruction, terms, engine)` 한 번으로 회의록을 받는다. instruction:
   "회의록을 써라. 1) 회의 개요(주제·일시가 녹음에 있으면) 2) 안건별 논의 요약 3) 결정 사항 4) 할 일 표(내용·담당·기한) 5) 다음 회의·미결 사항. 녹음에 없는 내용은 만들지 않는다."
4. 받은 회의록을 보고 문장만 다듬어 보여 준다. 맨 위에 한 줄: `녹음은 사내 AI 만 들었습니다 · 가린 것: …`
5. 실명으로 저장할지 한 줄 묻는다. 원하면 다듬은 회의록을 `hai_restore(mask_id, text, out_path)` 로 원문 결과 폴더(hai_status 에 나옴)의 `<이름> 회의록.md` 에 저장한다.
6. 받아쓰기 원문 파일도 원하면 `hai_transcribe(path, timestamps: true)` — 원문은 내가 열지 못하니 경로만 알려 준다.
