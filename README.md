# hai — 사내 AI(HAI·Qwen)를 Claude 에 연결하는 플러그인

민감한 파일은 **사내 Qwen 이 먼저 읽고**, Claude 에는 개인정보를 가린 글이나 Qwen 의 답만 넘깁니다.
"보안 때문에 Claude 에 파일을 못 넣는다"는 경우와, 사내 AI 가 있어도 어떻게 쓸지 모르는 경우를 위해 만들었습니다.

## 이렇게 동작합니다

| 하고 싶은 일 | 말하는 법 | 원문이 Claude 에 가나요? |
|---|---|---|
| 민감한 문서 요약·조항 찾기 | "임대차.pdf 를 HAI 로만 읽고 해지 조건 정리해줘" | 아니요. Qwen 만 읽고 답만 옵니다 |
| 개인정보를 가리고 Claude 와 작업 | "인사평가.docx 를 가려서 읽고 보고서 초안 써줘" | 가린 글만 갑니다(홍길동 → [이름1]) |
| 결과를 실명으로 저장 | "초안을 원래 이름으로 바꿔서 ~/Desktop/보고서.md 로 저장해줘" | 아니요. 내 PC 파일에만 저장 |
| 사내 AI 에 바로 질문 | "HAI 한테 이 문장 공문체로 다듬어 달라고 해줘" | 이미 Claude 가 본 글 |

처음이면 Claude Code 에서 `/hai:guide` 를 입력하세요. 연결 점검과 사용 예시를 보여 줍니다.

## 설치

필요한 것: Claude Code, Node.js 20 이상, **개인 HAI 키**, 사내망(또는 HAI 에 허용된 네트워크).

```
/plugin marketplace add hectoadmin/<저장소>
/plugin install hai@hecto
```

설치할 때 설정을 묻습니다.

| 설정 | 설명 |
|---|---|
| HAI API 키 (필수) | 각자 발급받은 키. PC 의 보안 저장소(키체인)에만 저장됩니다 |
| 보호 폴더 (선택) | 예: `~/Documents/인사, ~/Documents/계약`. 이 폴더 파일은 Claude 가 직접 열지 못하고 HAI 도구로만 읽힙니다 |
| 가리지 않을 이메일 도메인 (선택) | 예: `hecto.co.kr`. 비우면 이메일을 전부 가립니다 |

나중에 바꾸려면 `/plugin` → hai → 설정.

## 무엇을 가리나

- **항상(모양으로)**: 주민등록번호, 휴대전화·전화번호, 이메일, 계좌번호, 카드번호, 여권번호, 운전면허번호
- **Qwen 이 찾아서**: 사람 이름, 주소, 생년월일, 사번·회원번호 같은 식별번호
- **더 가리고 싶으면**: "거래처명이랑 계약 금액도 가려줘"처럼 말하면 그 유형을 더해 다시 가립니다
- 같은 값은 문서 전체에서 같은 자리표시가 됩니다(홍길동은 어디서나 [이름1])
- Qwen 이 응답하지 않으면 **가리다 만 글을 넘기지 않고 실패**합니다

## 한계

- 자동 가림이라 **놓칠 수 있습니다.** 중요한 문서는 결과를 한 번 훑어보세요.
- Qwen 은 긴 글의 **개수 세기·합계에 약합니다.** 집계는 "가려서 읽고 Claude 가 세 줘"로.
- 읽는 형식: txt·md·csv·json·html·pdf·docx. **hwp·xlsx 는 PDF·CSV 로 저장**해서 씁니다. 스캔 이미지 PDF 는 글자가 없어 못 읽습니다.
- 보호 폴더 차단은 최선 노력입니다. Claude 가 일부러 우회하는 경우까지 막지는 못합니다.
- 실명 되돌리기는 같은 세션(12시간) 안에서만 됩니다. 원래 값은 메모리에만 있고 디스크에 남기지 않습니다.

## 구성 (개발자용)

```
plugins/hai/
  .claude-plugin/plugin.json   사용자 설정(키·보호 폴더·도메인)
  .mcp.json                    MCP 서버 등록 → dist/hai-mcp.mjs
  dist/                        묶은 서버 한 파일 + pdf.js 한글 CMap (커밋한다 — 플러그인은 npm install 을 안 한다)
  hooks/guard.mjs              보호 폴더 Read·Grep·Bash 차단 (PreToolUse)
  skills/guide|privacy|doc     /hai:guide, 민감 파일 규칙, /hai:doc
  server/                      소스·테스트
```

```
cd plugins/hai/server
npm ci
npm test            # 가리기 규칙 단위 테스트 (네트워크 없음)
npm run build       # dist/ 다시 묶기 — 소스를 고치면 반드시 같이 커밋
HAI_API_KEY=... node scripts/call.mjs hai_status
HAI_API_KEY=... node scripts/call.mjs hai_mask_file '{"path":"~/a.pdf"}'
```

도구: `hai_mask_file`(가려서 읽기) · `hai_ask_file`(Qwen 만 읽고 답) · `hai_restore`(실명으로 로컬 저장) · `hai_chat`(바로 묻기) · `hai_status`(점검).
게이트웨이 주소·서비스는 환경변수 `HAI_BASE_URL`·`HAI_CHAT_SERVICE` 로 바꿀 수 있습니다(기본 `qwen-llm`).
