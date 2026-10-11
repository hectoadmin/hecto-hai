import { Logo } from './components/Logo'
import { Diagram } from './components/Diagram'
import { Search } from './components/Search'
import { useConfig } from 'nextra-theme-docs'
import { useRouter } from 'next/router'

const REPO_URL =
  process.env.NEXT_PUBLIC_REPO_URL || 'https://github.com/hectoadmin/hecto-hai';

// Hecto orange #FF6114 is hsl(20 100% 54%). Links and active states use a slightly deeper
// tone on white for contrast; dark mode uses the Hecto-adjusted #FF7A38.
export default {
  logo: <Logo />,
  project: {
    link: REPO_URL
  },
  docsRepositoryBase: `${REPO_URL}/tree/main/docs-site`,
  color: {
    hue: 20,
    saturation: 100,
    lightness: { light: 45, dark: 61 }
  },
  backgroundColor: {
    light: '255,255,255',
    dark: '16,16,16'
  },
  components: { Diagram },
  head: function Head() {
    const { title } = useConfig()
    const { basePath } = useRouter()
    return (
      <>
        <title>{title ? `${title} | HAI 플러그인` : 'HAI 플러그인'}</title>
        <link rel="icon" href={`${basePath}/brand/favicon.ico`} sizes="48x48" />
        <link rel="icon" type="image/png" sizes="32x32" href={`${basePath}/brand/favicon-32x32.png`} />
        <link rel="icon" type="image/png" sizes="16x16" href={`${basePath}/brand/favicon-16x16.png`} />
        <link rel="apple-touch-icon" href={`${basePath}/brand/apple-touch-icon.png`} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Noto+Sans+KR:wght@400;500;700;900&display=swap"
        />
      </>
    )
  },
  // Korean labels for the theme's built-in UI. The feedback link (GitHub issues) is removed:
  // most readers are non-developers without a GitHub account.
  // Custom search: the built-in FlexSearch index drops Hangul (see components/Search.jsx).
  search: {
    component: Search
  },
  toc: {
    title: '이 페이지 목차',
    backToTop: '맨 위로'
  },
  feedback: {
    content: null
  },
  editLink: {
    content: 'GitHub에서 이 페이지 고치기'
  },
  gitTimestamp: function GitTimestamp({ timestamp }) {
    return (
      <>
        마지막 수정{' '}
        {timestamp.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
      </>
    )
  },
  themeSwitch: {
    useOptions() {
      return { light: '라이트', dark: '다크', system: '시스템 설정' }
    }
  },
  notFound: {
    content: null
  },
  footer: {
    content: <span>헥토 총무팀</span>
  }
}
