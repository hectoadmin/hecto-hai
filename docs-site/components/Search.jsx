import Link from 'next/link'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

// Nextra 3's built-in search uses FlexSearch 0.7, whose default tokenizer drops Hangul, so Korean
// queries never match. This site has only a handful of pages, so a substring search over the
// same index file Nextra already emits is simpler and matches Korean anywhere in a word.

const MAX_RESULTS = 8
let cached = null

function loadSections(basePath, locale) {
  if (!cached) {
    cached = fetch(`${basePath}/_next/static/chunks/nextra-data-${locale}.json`)
      .then(response => {
        if (!response.ok) throw new Error(`search index ${response.status}`)
        return response.json()
      })
      .then(data =>
        Object.entries(data).flatMap(([route, page]) =>
          Object.entries(page.data).map(([key, text]) => {
            const [headingId, heading] = key.split('#')
            return {
              url: route + (headingId ? `#${headingId}` : ''),
              page: page.title,
              title: heading || page.title,
              text: text.replace(/\s+/g, ' ').trim()
            }
          })
        )
      )
      .catch(error => {
        cached = null
        throw error
      })
  }
  return cached
}

function search(sections, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  return sections
    .map(section => {
      const title = section.title.toLowerCase()
      const haystack = `${title} ${section.text.toLowerCase()}`
      if (!terms.every(term => haystack.includes(term))) return null
      const score = terms.reduce((sum, term) => sum + (title.includes(term) ? 10 : 1), 0)
      return { ...section, score }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
}

function Snippet({ text, query }) {
  const term = query.trim().split(/\s+/)[0]?.toLowerCase()
  if (!text) return null
  const at = term ? text.toLowerCase().indexOf(term) : -1
  if (at < 0) return <span>{text.slice(0, 80)}{text.length > 80 ? '…' : ''}</span>
  const start = Math.max(0, at - 30)
  const end = Math.min(text.length, at + term.length + 50)
  return (
    <span>
      {start > 0 ? '…' : ''}
      {text.slice(start, at)}
      <mark>{text.slice(at, at + term.length)}</mark>
      {text.slice(at + term.length, end)}
      {end < text.length ? '…' : ''}
    </span>
  )
}

export function Search({ className }) {
  const router = useRouter()
  const { basePath } = router
  const locale = router.locale || 'en-US'
  const listId = useId()
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [sections, setSections] = useState(null)
  const [status, setStatus] = useState('idle')
  const [active, setActive] = useState(0)

  const load = useCallback(() => {
    if (sections || status === 'loading') return
    setStatus('loading')
    loadSections(basePath, locale)
      .then(result => {
        setSections(result)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [basePath, locale, sections, status])

  const results = useMemo(() => (sections ? search(sections, query) : []), [sections, query])

  useEffect(() => setActive(0), [query])

  useEffect(() => {
    function onKey(event) {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')
      if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const close = () => setOpen(false)
    router.events.on('routeChangeStart', close)
    return () => router.events.off('routeChangeStart', close)
  }, [router.events])

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive(index => Math.min(index + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(index => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && results[active]) {
      event.preventDefault()
      router.push(results[active].url)
      setQuery('')
      setOpen(false)
    }
  }

  const showPanel = open && query.trim().length > 0

  return (
    <div className={['hx-search', className].filter(Boolean).join(' ')}>
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder="문서 검색"
        aria-label="문서 검색"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-activedescendant={showPanel && results[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => {
          load()
          setOpen(true)
        }}
        onBlur={() => setOpen(false)}
        onChange={event => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
      />
      <kbd className="hx-search-kbd" aria-hidden="true">⌘K</kbd>
      {showPanel && (
        // Keep focus in the input while clicking a result, so blur never removes the
        // panel before the click lands (Safari does not focus links on click).
        <div className="hx-search-panel" onMouseDown={event => event.preventDefault()}>
          {status === 'loading' && <p className="hx-search-note">불러오는 중…</p>}
          {status === 'error' && (
            <p className="hx-search-note">검색 목록을 불러오지 못했습니다. 새로고침해 보세요.</p>
          )}
          {status === 'ready' && results.length === 0 && (
            <p className="hx-search-note">검색 결과가 없습니다.</p>
          )}
          {results.length > 0 && (
            <ul id={listId} role="listbox" className="hx-search-list">
              {results.map((result, index) => (
                <li
                  key={result.url + index}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                >
                  <Link href={result.url} className="hx-plain" onClick={() => setQuery('')}>
                    <span className="hx-search-page">{result.page}</span>
                    <span className="hx-search-title">{result.title}</span>
                    <span className="hx-search-snippet">
                      <Snippet text={result.text} query={query} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
