import { useRouter } from 'next/router'

// Light and dark variants are separate files (docs-site/diagrams/build.py writes both);
// CSS shows the one that matches the theme. basePath keeps the paths valid on GitHub Pages.
export function Diagram({ name, alt }) {
  const { basePath } = useRouter()
  return (
    <figure className="hx-diagram">
      <img className="hx-diagram-light" src={`${basePath}/diagrams/${name}.svg`} alt={alt} />
      <img className="hx-diagram-dark" src={`${basePath}/diagrams/${name}-dark.svg`} alt="" aria-hidden="true" />
    </figure>
  )
}
