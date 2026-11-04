# hecto-hai — 사내 AI(HAI)를 Claude 에 연결하는 플러그인

**사용법 문서: https://hectoadmin.github.io/hecto-hai** (설치·따라 하기·문제 해결)

문서·스캔본·녹음을 **사내 AI 가 먼저 읽고**, Claude 에는 개인정보를 가린 글이나 사내 AI 의 답만 넘깁니다.
"보안 때문에 Claude 에 파일을 못 넣는다"는 경우와, 사내 AI 가 있어도 어떻게 쓸지 모르는 경우를 위해 만들었습니다.

## 할 수 있는 것

| 하고 싶은 일 | 말하는 법 | 쓰는 사내 AI |
|---|---|---|
| 민감한 문서 요약·조항 찾기 | "임대차.pdf 를 HAI 로만 읽고 해지 조건 정리해줘" | Qwen |
| 개인정보 가리고 Claude 와 작업 | "인사평가.docx 를 가려서 읽고 보고서 초안 써줘" | Qwen(이름·주소 찾기) |
| 엑셀 명단 집계 | "주차등록.xlsx 가려서 읽고 부서별 인원 세줘" | 열 단위 가리기 |
| 회의 녹음 → 회의록 | `/hai:minutes 회의.m4a` | Whisper · Qwen3-ASR |
| 스캔 계약서·사진 읽기 | "스캔본.pdf 에서 계약 기간만 뽑아줘" | PaddleOCR |
| 스캔본을 고칠 수 있는 워드로 | "스캔본.pdf 워드 파일로 바꿔줘" | PaddleOCR(docx, 쪽 경계 표 잇기) |
| 화면 캡처를 파일 없이 읽기 | 캡처만 하고(붙여 넣지 않음) "클립보드 캡처 가려서 읽고 금액 고쳐줘" | PaddleOCR(메모리로만, 저장 즉시 DRM 이 걸리는 PC 용) |
| 폴더 문서 모아 보기 | "계약서 폴더 전부 만기일·자동갱신 표로" | Qwen |
| 내 문서에서 뜻으로 찾기 | "~/Documents/계약 에서 위약금 조항 찾아줘" | KURE(한국어 임베딩) |
| 사진·차트 설명, 문장 다듬기 | "이 사진 뭐가 문제인지 HAI 한테 물어봐줘" | Gemma · Qwen |
| 결과를 실명으로 저장 | "초안을 실명으로 바꿔 ~/Desktop/보고서.md 로" | 내 PC 에만 저장 |
| EVS 타임테이블 작성 | `/hai:timetable 2026-10` — 내 배분 규칙을 기억하고 양식 엑셀까지 채움(업로드·확정은 직접) | (HAI 안 씀, 근거 문서는 HAI 로) |
| 메일·메신저·캘린더·그룹웨어 읽기 | "오늘 안 읽은 메일 요약해줘", "결재함 뭐 와 있어?" — 크롬 뒤쪽 탭에서 사내 AI 가 읽고 답만 Claude 에 줍니다. 저장·보내기·승인은 막힙니다 | 화면 판단은 agent 서버가 HAI 로 |
| 사내 화면 일 맡기기 | "그룹웨어에서 ○○ 해줘" — 크롬이 꺼져 있으면 켜고, 화면을 바꾸는 동작은 확인을 받습니다 | 화면 판단은 agent 서버가 HAI 로 |
| 오늘 할 일 한눈에 | `/hai:brief` — 일정·결재·메일·메신저를 읽어 할 일부터 정리 | 화면 판단은 agent 서버가 HAI 로 |
| 웍스 대화 요약 | `/hai:works` — 안 읽은 방을 읽어 방별 요약과 할 일 정리(방을 열면 읽음 처리) | 화면 판단은 agent 서버가 HAI 로 |
| 할 일 정리 | `/hai:todo` — 메일·대화·회의록에서 내 일·남 일·확인할 일을 뽑아 내 PC 에 저장 | Claude(근거는 HAI 로) |
| 규칙 알림 | `/hai:watch` — "긴급 메일 오면 알려줘". 나에게 웍스 봇 DM | 화면 판단은 agent 서버가 HAI 로 |
| 정해진 시간에 돌리기 | `/hai:schedule` — "매일 아침 메일 요약", Claude 데스크톱 앱 예약으로 만들고 막히면 웍스 봇 DM | 화면 판단은 agent 서버가 HAI 로 |
| 크롬에 저장한 사내 화면 작업 실행 | "법인카드 정산 작업 돌려줘" — 크롬 헥토 에이전트에서 녹화·저장한 작업이 내 크롬에서 돈다. 저장 확인은 대화로, 상신·승인·삭제는 크롬 패널에서만 | 화면 판단은 agent 서버가 HAI 로 |

처음이면 Claude Code 에서 `/hai:guide` — 연결 점검과 예시를 보여 줍니다. 문서 하나는 `/hai:doc <파일> [할 일]`.

## 설치

필요한 것: Claude Code(2.1.295 이상), Node.js 20 이상, 헥토 이메일. Windows(WSL 없이)·macOS 모두 됩니다. **개인 HAI 키와 사내망은 필요 없습니다** — `hai_login` 으로 통합인증 로그인을 하면 agent 서버(agent.hecto.co.kr)가 사내 AI 를 대신 부릅니다(회사 밖에서도 됨). 개인 키를 넣어 두면 로그인하지 않았을 때 사내망에서 게이트웨이로 바로 부릅니다.

**Node.js 먼저** — https://nodejs.org 에서 LTS 설치 파일을 받아 "다음"만 눌러 설치하고 Claude Code 를 다시 시작합니다(Windows 에서 검은 창이 편하면 cmd·PowerShell 에 `winget install OpenJS.NodeJS.LTS`). Git Bash 는 없어도 됩니다.
Node.js 가 없으면 보호 훅이 돌지 못해 **파일 읽기·명령이 모두 막힙니다**(원본이 새지 않게 일부러 막는 것). 설치하면 풀립니다.

1. **설치** — Claude Code 에 한 줄 붙여넣기(설치·자동 업데이트 설정을 Claude 가 대신 함)
   ```
   https://agent.hecto.co.kr/plugin 에 적힌 대로 헥토 플러그인을 설치해줘
   ```
   직접 하려면 `/plugin marketplace add https://agent.hecto.co.kr/plugin/marketplace.json` → `/plugin install hai@hectoadmin`.
   새 판은 `bash scripts/pack-plugins.sh`(hecto-agent 저장소)로 agent 서버에 올린다. 이 저장소의 `.claude-plugin/marketplace.json` 은 개발·CI 용.
2. **로그인** — Claude Code 에 "hai 로그인해줘"(또는 `/hai:guide`). 브라우저가 열리면 헥토 이메일 → 웍스로 온 인증번호. 기간 제한 없이 유지되고 `hai_logout`·퇴사·관리자 차단 때만 끊깁니다.
3. 설정(모두 선택) — `/plugin configure hai@hectoadmin`.

| 설정 | 설명 |
|---|---|
| HAI API 키 (선택) | 보통 비워 둡니다(로그인으로 씀). 넣으면 로그인하지 않았을 때 사내망에서 게이트웨이로 바로. 비밀 값으로 따로 저장됩니다 |
| 보호 폴더 (선택) | 예: `~/Documents/인사, ~/Documents/계약`. Windows 는 탐색기 주소 그대로(`C:\Users\이름\Documents\인사`) 적어도 됩니다. 이 폴더 파일은 Claude 가 직접 열지 못하고 HAI 도구로만 읽힙니다 |
| 원문 결과 폴더 (선택) | 받아쓰기·OCR 결과(가리지 않은 원문)를 모으는 곳. 비우면 내 문서 폴더의 `HAI 원문`(Windows 에서 문서가 OneDrive 에 있으면 그곳). 이 폴더도 Claude 가 열지 못합니다 |
| 가리지 않을 이메일 도메인 (선택) | 예: `hecto.co.kr`. 비우면 이메일을 전부 가립니다 |

나중에 바꾸려면 `/plugin configure hai@hectoadmin`. 업데이트는 자동(바로 받으려면 `/plugin marketplace update hectoadmin`).

4. **(권장) 더 확실하게 막기** — `/hai:protect`. 사용자 동의 후 `~/.claude/settings.json` 을 고칩니다.
   - **macOS·Linux**: Claude Code 샌드박스의 읽기 차단(`sandbox.filesystem.denyRead`)에 보호 폴더·원문 결과 폴더를 넣습니다. 명령을 어떻게 쓰든 그 폴더를 읽지 못합니다.
   - **Windows**: 샌드박스가 없습니다. 기본 도구 차단 규칙(`permissions.deny` 의 Read·Edit)을 더하고, 명령(PowerShell·Git Bash)은 보호 훅이 막습니다. Claude 가 명령을 실행하겠다고 물을 때 **"항상 허용"을 누르지 말고** 한 번씩 확인하세요. 인사·계약 폴더 **안에서** Claude Code 를 시작하지 마세요.

## 무엇을, 어떻게 가리나

- **표(엑셀·CSV)**: 머리글이 성명·사번·연락처·주소·차량번호·계좌·생년월일인 열은 칸 전체를 가립니다
- **모양으로**: 주민등록번호(뒷자리 * 포함), 휴대전화·전화(+82·괄호·전각 숫자 포함), 이메일, 계좌, 카드, 여권, 운전면허
- **사내 AI 가 찾아서**: 사람 이름, 주소, 생년월일, 사번·회원번호·차량번호 같은 식별번호
- **더 가리고 싶으면**: "거래처명이랑 계약 금액도 가려줘" — 그 유형을 더해 다시 가립니다
- 같은 값은 문서 전체에서 같은 자리표시([이름1])가 되고, 원래 값은 메모리에만 있습니다
- 사내 AI 가 응답하지 않으면 **가리다 만 글을 넘기지 않고 실패**합니다
- 받아쓰기·OCR 결과는 원문 결과 폴더에 모이고, 실명 결과 파일과 함께 장부(`~/.hai-mcp/raw-files.log`, 경로만)에도 올라 Claude 가 다시 열지 못합니다

## 한계

- 자동 가림이라 **놓칠 수 있습니다.** 중요한 문서는 결과를 한 번 훑어보세요.
- 사내 AI 는 긴 글의 **개수 세기·합계에 약합니다.** 집계는 "가려서 읽고 Claude 가 세 줘"로.
- 읽는 형식: 문서 txt·md·csv(UTF-8·UTF-16·EUC-KR)·json·html·pdf(스캔 쪽은 OCR)·docx·xlsx·hwpx / 사진 png·jpg·tif·webp / 녹음 wav·mp3·ogg·flac·m4a·mp4 등(60분. m4a·mp4 는 macOS·Windows 내장 기능으로 변환, 그 밖은 ffmpeg). **옛 hwp·xls·doc 는 새 형식이나 PDF 로 저장**해서 씁니다.
- 보호 폴더 차단은 두 겹입니다. ① 가드 훅(항상 켜짐): **실수로 원본을 여는 것을 막는 안전망**입니다. Read·Grep·Glob 은 경로로 확실히 막고, Bash 는 명령을 셸처럼 풀어(따옴표·이스케이프·와일드카드·변수·명령 치환), PowerShell 은 변수·문자열 잇기·Join-Path 를 풀어 판단하고, 실행하는 스크립트 파일(python a.py · .\a.ps1)의 내용도 봅니다. 판단할 수 없는 형태(인코딩한 글자·eval·iex·base64 풀기)는 막습니다. 다만 경로를 실행 중에 만들어 내는 코드까지 글자만 보고 막을 수는 없습니다. ② 샌드박스(`/hai:protect`로 켬, macOS·Linux): 운영체제가 읽기 자체를 막으므로 이 한계가 없습니다. **Windows 는 샌드박스가 없어 ①과 기본 도구 차단 규칙까지**이므로, 명령 실행을 한 번씩 확인하는 습관이 세 번째 장치입니다. 원본이 Claude 에 갈 일 자체가 없게 하는 중심은 HAI 도구(원문은 사내 AI 만 읽음)이고, 두 겹은 그 위의 장치입니다.
- 실명 되돌리기는 같은 세션(12시간) 안에서만 됩니다.

## 구성 (개발자용)

```
.claude-plugin/marketplace.json   마켓플레이스 "hectoadmin"(개발·CI 용 — 배포는 agent 서버)
plugins/hai/
  .claude-plugin/plugin.json      사용자 설정(키·보호 폴더·도메인)
  .mcp.json                       MCP 서버 등록 → dist/hai-mcp.mjs
  dist/                           묶은 서버 한 파일 + pdf.js 한글 CMap (커밋한다 — 플러그인은 npm install 을 안 한다)
  hooks/guard.mjs                 보호 폴더·원문 파일 Read·Grep·Glob·Bash 차단 (PreToolUse)
  skills/guide|privacy|doc|minutes|protect|timetable|browser|brief|works|todo|watch|schedule
  server/src                      config · hai(게이트웨이) · mask · ner · table · extract · office · search · ledger · index
  server/test                     가리기·표·형식·가드·매니페스트 (네트워크 없음)
```

```
cd plugins/hai/server
npm ci
npm test            # 단위 테스트
npm run build       # dist/ 다시 묶기 — 소스를 고치면 반드시 같이 커밋 (CI 가 확인)
HAI_API_KEY=... node scripts/call.mjs hai_status
HAI_API_KEY=... node scripts/call.mjs hai_mask_file '{"path":"~/a.pdf"}' hai_restore '{"mask_id":"{{mask_id}}","text":"[이름1]","out_path":"/tmp/x.md"}'
```

| 도구 | 하는 일 | HAI 서비스 |
|---|---|---|
| `hai_ask_file` | 파일을 사내 AI 만 읽고 답(가림) | qwen-llm·gemma-llm (+OCR·STT 자동) |
| `hai_ask_files` | 여러 파일에 같은 질문 | qwen-llm·gemma-llm (+OCR·STT 자동) |
| `hai_mask_file` | 가린 본문 | 표 열 → 정규식 → qwen-llm |
| `hai_restore` | 자리표시 → 실명, 로컬 파일로만 | — |
| `hai_transcribe` | 녹음 → 받아쓰기 파일 | whisper-large-v3 · qwen3-asr |
| `hai_ocr` | 스캔·사진 → Markdown·워드(docx) 파일 | paddleocr-api (+restructure-pages) |
| `hai_search` | 폴더 의미 검색(색인은 `~/.hai-mcp/index`) | kure-embedding |
| `hai_chat` | 바로 묻기·사진 이해·추론 모드 | qwen-llm·gemma-llm |
| `hai_status` | 키·서비스 점검 | 전체 |
| `agent_recipes` · `agent_run` · `agent_status` · `agent_answer` | 크롬 헥토 에이전트에 저장한 작업을 내 크롬에서 실행(agent 서버 `/hai-api`, 대화 확인은 저장류만) | — (화면 판단은 agent 서버가 HAI 로) |

서비스 이름·주소는 HAI 연동 가이드 v2.10 기준이며 환경변수(`HAI_BASE_URL`, `HAI_CHAT_SERVICE` 등, `server/src/config.js`)로 바꿀 수 있습니다.
