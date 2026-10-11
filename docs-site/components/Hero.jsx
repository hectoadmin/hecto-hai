// Home hero built on the Hecto "Cropped Sun" motif (CI 3.4, system C):
// a full circle cropped flush against the top edge, centered, ~0.36x the block width.
export function Hero() {
  return (
    <section className="hx-hero" aria-labelledby="hx-hero-title">
      <div className="hx-sun" aria-hidden="true" />
      <p className="hx-hero-en">HECTO AI × CLAUDE CODE</p>
      <h1 id="hx-hero-title" className="hx-hero-title">
        민감한 파일은 사내 AI 가 읽고,
        <br />
        Claude 는 가린 글로 일합니다
      </h1>
      <p className="hx-hero-lede">
        인사·계약·회의 녹음 같은 원본은 사내 AI(HAI)만 읽습니다. Claude 에는 개인정보를 가린 글이나
        답만 갑니다. 요약·회의록·OCR·문서 검색까지 한국어로 말하면 됩니다.
      </p>
    </section>
  )
}
