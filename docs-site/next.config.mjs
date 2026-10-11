import nextra from 'nextra'

const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.jsx'
})

// GITHUB_PAGES=true는 Pages 배포 워크플로우에서만 설정한다.
// github.io는 /<repo>/ 하위 경로로 서빙되므로 그때만 basePath를 붙인다.
const isGitHubPages = process.env.GITHUB_PAGES === 'true'

export default withNextra({
  output: 'export',
  images: { unoptimized: true },
  ...(isGitHubPages ? { basePath: '/hecto-hai' } : {})
})
