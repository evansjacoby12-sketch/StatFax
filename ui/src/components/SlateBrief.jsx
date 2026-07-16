import Icon from './Icon.jsx'
import { pct } from '../lib/format.js'

// Legacy v1 briefs were one paragraph. Keep them readable while cached or
// previously deployed artifacts age out.
function cleanBrief(raw) {
  let text = String(raw || '').trim()
  text = text.replace(/^\s*\*\*([^*\n]*)\*\*\s*[-–—:]*\s*/, (match, inner) =>
    /brief|20\d\d/i.test(inner) ? '' : match,
  ).trim()
  return text
}

function renderInline(text) {
  const out = []
  const re = /\*\*([^*]+)\*\*/g
  let last = 0
  let match
  let index = 0
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index))
    out.push(<strong key={index++}>{match[1]}</strong>)
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function BriefHeader({ brief, structured }) {
  const prime = Number.isFinite(brief.primeCount) ? brief.primeCount : null
  const strong = Number.isFinite(brief.strongCount) ? brief.strongCount : null
  const dateLabel = brief.date ? String(brief.date).slice(5) : null

  return (
    <div className="slate-brief-head">
      <span className="slate-brief-title" id="slate-brief-title">
        <Icon name="Focus" size={14} className="slate-brief-spark" />
        {structured ? 'Decision Brief' : "Today's Brief"}
      </span>
      {dateLabel && <span className="slate-brief-date">{dateLabel}</span>}
      <span className="slate-brief-chips">
        {prime != null && <span className="sb-chip sb-prime">{prime} PRIME</span>}
        {strong != null && <span className="sb-chip sb-strong">{strong} STRONG</span>}
      </span>
    </div>
  )
}

function DecisionBrief({ brief }) {
  const leaders = Array.isArray(brief.leaders) ? brief.leaders.slice(0, 2) : []
  const environment = brief.environment
  const watchout = brief.watchout

  return (
    <>
      <h3 className="slate-brief-headline">{brief.headline}</h3>

      {leaders.length > 0 && (
        <div className="slate-brief-leaders" aria-label="Model leaders">
          {leaders.map((leader) => {
            const grade = String(leader.grade || '').toUpperCase()
            return (
              <div className="slate-brief-leader" key={leader.id || leader.name}>
                <div className="slate-brief-leader-copy">
                  <div className="slate-brief-leader-name">
                    <strong>{leader.name}</strong>
                    {leader.team && <span>{leader.team}</span>}
                  </div>
                  {leader.note && <p className="slate-brief-leader-note">{leader.note}</p>}
                  {leader.pitcher && <span className="slate-brief-matchup">vs {leader.pitcher}</span>}
                </div>
                <div className="slate-brief-leader-meta">
                  {grade && <span className={`sb-chip sb-${grade.toLowerCase()}`}>{grade}</span>}
                  {Number.isFinite(leader.hrProbability) && (
                    <strong className="slate-brief-leader-prob">{pct(leader.hrProbability, 0)}</strong>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(environment || watchout) && (
        <div className="slate-brief-context">
          {environment && (
            <div className="slate-brief-context-item">
              <div className="slate-brief-context-label">
                <Icon name="MapPin" size={11} /> Environment
              </div>
              <div className="slate-brief-context-main">
                <strong>{environment.venue || environment.matchup}</strong>
                {Number.isFinite(environment.score) && <span>env {environment.score}/100</span>}
              </div>
              {environment.note && <p className="slate-brief-context-note">{environment.note}</p>}
            </div>
          )}
          {watchout && (
            <div className="slate-brief-context-item slate-brief-watch">
              <div className="slate-brief-context-label">
                <Icon name="TriangleAlert" size={11} /> {watchout.label || 'Watchout'}
              </div>
              <p className="slate-brief-context-main">{watchout.fact}</p>
              {watchout.note && <p className="slate-brief-context-note">{watchout.note}</p>}
            </div>
          )}
        </div>
      )}
    </>
  )
}

export default function SlateBrief({ brief }) {
  const structured = Number(brief?.version) >= 2 && Boolean(brief?.headline)
  const legacyText = structured ? '' : cleanBrief(brief?.text)
  if (!structured && !legacyText) return null

  return (
    <section className="slate-brief" aria-labelledby="slate-brief-title">
      <span className="slate-brief-bar" aria-hidden="true" />
      <BriefHeader brief={brief} structured={structured} />
      {structured
        ? <DecisionBrief brief={brief} />
        : <p className="slate-brief-body">{renderInline(legacyText)}</p>}
      <div className="slate-brief-foot">
        <Icon name="Sparkles" size={9} />
        {structured
          ? 'AI narrative · engine numbers unchanged · advisory only'
          : "AI summary of the model's board · advisory only"}
      </div>
    </section>
  )
}
