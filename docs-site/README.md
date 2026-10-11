# HAI 플러그인 문서 사이트

사용법을 소개하는 Nextra 문서 사이트입니다. main 에 병합되면 GitHub Pages 로 배포됩니다
(https://hectoadmin.github.io/hecto-hai). 틀(디자인·검색·그림 생성기)은 AEF 문서 사이트에서 가져왔습니다.

## 실행과 빌드

```bash
npm install
npm run dev     # 로컬에서 보기
npm run build   # 정적 사이트 생성 (out/)
```

## 그림 고치기

그림은 `diagrams/build.py` 가 만드는 SVG 입니다. 고친 뒤 다시 실행하면 라이트/다크 두 벌이 `public/diagrams/` 에 생깁니다.

```bash
python3 diagrams/build.py
```
