import Icon from './Icon.jsx'

// Today's Slate Brief — the server-generated one-paragraph board summary
// (slate-brief.mjs → dist/brief.json). Advisory prose over the already-scored
// board; renders nothing when the brief wasn't generated.

// The model is told "no markdown / no title", but sometimes slips a **bold**
// title or emphasis in anyway. Clean it: drop a leading bold title line, then
// render any remaining **bold** as real emphasis instead of raw asterisks.
function cleanBrief(raw) {
  let t = String(raw || '').trim()
  // Strip a leading "**… BRIEF …**" or "**… 2026**" title line if present.
  t = t.replace(/^\s*\*\*([^*\n]*)\*\*\s*[-–—:]*\s*/, (m, inner) =>
    /brief|20\d\d/i.test(inner) ? '' : m,
  ).trim()
  return t
}

function renderInline(text) {
  const out = []
  const re = /\*\*([^*]+)\*\*/g
  let last = 0, m, i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<strong key={i++} style={{ color: '#fff', fontWeight: 700 }}>{m[1]}</strong>)
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function SlateBrief({ brief }) {
  if (!brief?.text) return null
  const text = cleanBrief(brief.text)
  if (!text) return null

  const prime = Number.isFinite(brief.primeCount) ? brief.primeCount : null
  const strong = Number.isFinite(brief.strongCount) ? brief.strongCount : null
  const dateLabel = brief.date ? String(brief.date).slice(5) : null

  return (
    <section className="slate-brief">
      <span className="slate-brief-bar" aria-hidden="true" />
      <div className="slate-brief-head">
        <span className="slate-brief-title">
          <Icon name="Sparkles" size={14} className="slate-brief-spark" /> Today's Brief
        </span>
        {dateLabel && <span className="slate-brief-date">{dateLabel}</span>}
        <span className="slate-brief-chips">
          {prime != null && <span className="sb-chip sb-prime">{prime} PRIME</span>}
          {strong != null && <span className="sb-chip sb-strong">{strong} STRONG</span>}
        </span>
      </div>
      <p className="slate-brief-body">{renderInline(text)}</p>
      <div className="slate-brief-foot">
        <Icon name="Sparkles" size={9} /> AI summary of the model's board · advisory only
      </div>
    </section>
  )
}
