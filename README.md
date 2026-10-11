# hecto-hai — 사내 AI(HAI)를 Claude 에 연결하는 플러그인

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
| 폴더 문서 모아 보기 | "계약서 폴더 전부 만기일·자동갱신 표로" | Qwen |
| 내 문서에서 뜻으로 찾기 | "~/Documents/계약 에서 위약금 조항 찾아줘" | KURE(한국어 임베딩) |
| 사진·차트 설명, 문장 다듬기 | "이 사진 뭐가 문제인지 HAI 한테 물어봐줘" | Gemma · Qwen |
| 결과를 실명으로 저장 | "초안을 실명으로 바꿔 ~/Desktop/보고서.md 로" | 내 PC 에만 저장 |

처음이면 Claude Code 에서 `/hai:guide` — 연결 점검과 예시를 보여 줍니다. 문서 하나는 `/hai:doc <파일> [할 일]`.

## 설치

필요한 것: Claude Code, Node.js 20 이상, **개인 HAI 키**, 사내망.

1. **키 받기** — HAI 포털 https://hai-gateway.idc.hectoai.co.kr/ 에 헥토 이메일로 가입 → 로그인 → 오른쪽 위 "API 키 관리" → 새 키(hai- 로 시작).
2. **설치** — Claude Code 에서
   ```
   /plugin marketplace add hectoadmin/hecto-hai
   /plugin install hai@hecto
   ```
3. 설정을 묻습니다.

| 설정 | 설명 |
|---|---|
| HAI API 키 (필수) | 1에서 받은 키. PC 의 보안 저장소(키체인)에만 저장됩니다 |
| 보호 폴더 (선택) | 예: `~/Documents/인사, ~/Documents/계약`. 이 폴더 파일은 Claude 가 직접 열지 못하고 HAI 도구로만 읽힙니다 |
| 가리지 않을 이메일 도메인 (선택) | 예: `hecto.co.kr`. 비우면 이메일을 전부 가립니다 |

나중에 바꾸려면 `/plugin` → hai → 설정. 업데이트는 `/plugin marketplace update hecto`.

## 무엇을, 어떻게 가리나

- **표(엑셀·CSV)**: 머리글이 성명·사번·연락처·주소·차량번호·계좌·생년월일인 열은 칸 전체를 가립니다
- **모양으로**: 주민등록번호(뒷자리 * 포함), 휴대전화·전화(+82·괄호·전각 숫자 포함), 이메일, 계좌, 카드, 여권, 운전면허
- **사내 AI 가 찾아서**: 사람 이름, 주소, 생년월일, 사번·회원번호·차량번호 같은 식별번호
- **더 가리고 싶으면**: "거래처명이랑 계약 금액도 가려줘" — 그 유형을 더해 다시 가립니다
- 같은 값은 문서 전체에서 같은 자리표시([이름1])가 되고, 원래 값은 메모리에만 있습니다
- 사내 AI 가 응답하지 않으면 **가리다 만 글을 넘기지 않고 실패**합니다
- 받아쓰기·OCR·실명 결과 파일은 장부(`~/.hai-mcp/raw-files.log`, 경로만)에 올라 Claude 가 다시 열지 못합니다

## 한계

- 자동 가림이라 **놓칠 수 있습니다.** 중요한 문서는 결과를 한 번 훑어보세요.
- 사내 AI 는 긴 글의 **개수 세기·합계에 약합니다.** 집계는 "가려서 읽고 Claude 가 세 줘"로.
- 읽는 형식: 문서 txt·md·csv(UTF-8·UTF-16·EUC-KR)·json·html·pdf(스캔 쪽은 OCR)·docx·xlsx·hwpx / 사진 png·jpg·tif·webp / 녹음 wav·mp3·ogg·flac·m4a 등(60분, m4a 는 macOS 내장 변환이나 ffmpeg). **옛 hwp·xls·doc 는 새 형식이나 PDF 로 저장**해서 씁니다.
- 보호 폴더 차단은 최선 노력입니다. Claude 가 일부러 우회하는 경우까지 막지는 못합니다.
- 실명 되돌리기는 같은 세션(12시간) 안에서만 됩니다.

## 구성 (개발자용)

```
.claude-plugin/marketplace.json   마켓플레이스 "hecto"
plugins/hai/
  .claude-plugin/plugin.json      사용자 설정(키·보호 폴더·도메인)
  .mcp.json                       MCP 서버 등록 → dist/hai-mcp.mjs
  dist/                           묶은 서버 한 파일 + pdf.js 한글 CMap (커밋한다 — 플러그인은 npm install 을 안 한다)
  hooks/guard.mjs                 보호 폴더·원문 파일 Read·Grep·Glob·Bash 차단 (PreToolUse)
  skills/guide|privacy|doc|minutes
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
| `hai_ocr` | 스캔·사진 → Markdown 파일 | paddleocr-api |
| `hai_search` | 폴더 의미 검색(색인은 `~/.hai-mcp/index`) | kure-embedding |
| `hai_chat` | 바로 묻기·사진 이해·추론 모드 | qwen-llm·gemma-llm |
| `hai_status` | 키·서비스 점검 | 전체 |

서비스 이름·주소는 HAI 연동 가이드 v2.10 기준이며 환경변수(`HAI_BASE_URL`, `HAI_CHAT_SERVICE` 등, `server/src/config.js`)로 바꿀 수 있습니다.
