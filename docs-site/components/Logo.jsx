import { useRouter } from 'next/router'

export function Logo() {
  const { basePath } = useRouter()
  return (
    <span className="hx-logo">
      <img className="hx-logo-light" src={`${basePath}/brand/logo-hecto-black.png`} alt="Hecto" />
      <img className="hx-logo-dark" src={`${basePath}/brand/logo-hecto-white.png`} alt="Hecto" />
      <span className="hx-logo-product">HAI</span>
    </span>
  )
}
