import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip, hexA } from './atoms.jsx'
import { pct, american, signedPct, surname } from '../lib/format.js'
import { gradeColor } from '../lib/badges.js'
import { buildParlay } from '../lib/parlayMath.js'
import { comboStatus, legStatus, LEG_META, VERDICT_META } from '../lib/live.js'
import * as store from '../lib/storage.js'
import { makeTicket, trackTicket } from '../lib/tickets.js'
import { toast } from './Toast.jsx'

const GRADE_COLOR = { S: '#d6b56f', A: '#69b99e', B: '#8587b7', C: '#94a3b8', D: '#676673' }

function useCountUp(target, ms = 450) {
  const [value, setValue] = useState(target)
  useEffect(() => {
    if (target == null || !Number.isFinite(target)) { setValue(target); return }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setValue(target); return }
    let raf
    let start = null
    const from = Number.isFinite(value) ? value : 0
    const tick = (time) => {
      if (start === null) start = time
      const progress = Math.min(1, (time - start) / ms)
      setValue(from + (target - from) * (1 - Math.pow(1 - progress, 3)))
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ms])
  return value
}

function copyText(legs, parlay) {
  const market = parlay.allPriced ? ` | ${american(parlay.american)}` : ` | Fair ${american(parlay.fairAmerican)}`
  const header = `StatFax ${parlay.n}-leg parlay | Model ${pct(parlay.modelAllHit, parlay.modelAllHit < 0.01 ? 2 : 1)}${market}`
  const items = legs.map((b, i) => {
    const odds = b.odds?.best?.american ? ` ${american(b.odds.best.american)}` : ''
    return `${i + 1}. ${b.name} (${b.team})${odds} - ${pct(b.hrProbability, 1)} HR`
  })
  return [header, ...items].join('\n')
}

function decisionLabel(parlay, unconfirmed) {
  if (unconfirmed > 0) return { label: 'Research preview', detail: `${unconfirmed} projected ${unconfirmed === 1 ? 'lineup' : 'lineups'} · verify before betting`, tone: 'warning' }
  if (!parlay.allPriced) return { label: 'Model-ready', detail: 'Awaiting complete market odds', tone: 'neutral' }
  if (parlay.ev >= 0.05) return { label: 'Positive-value build', detail: `${signedPct(parlay.ev, 0)} expected value`, tone: 'positive' }
  if (parlay.ev >= 0) return { label: 'Slight model edge', detail: `${signedPct(parlay.ev, 0)} expected value`, tone: 'positive' }
  return { label: 'Market is expensive', detail: `${signedPct(parlay.ev, 0)} expected value`, tone: 'negative' }
}

function saveSlip(legs, parlay, wager) {
  const saved = store.load('savedSlips', [])
  const entry = {
    id: `s${Date.now()}`,
    name: legs.map((b) => surname(b.name)).join(' · '),
    ids: legs.map((b) => b.id),
    savedAt: Date.now(),
  }
  const next = [entry, ...saved.filter((s) => s.ids.join() !== entry.ids.join())].slice(0, 20)
  store.save('savedSlips', next)
  const wagerNumber = Number(wager)
  trackTicket(makeTicket({
    legs,
    date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
    strategy: 'saved-parlay',
    label: 'Saved parlay',
    size: legs.length,
    allHit: parlay.modelAllHit,
    american: parlay.american,
    wager: Number.isFinite(wagerNumber) && wagerNumber > 0 ? wagerNumber : null,
  }))
  toast.success('Slip saved')
}

export default function ParlaySlip({ legs, batters = [], onRemove, onClear, onSelect, onOpenBuilder, onReplace }) {
  const [open, setOpen] = useState(false)
  const [wager, setWager] = useState('10')
  const [replaceOpen, setReplaceOpen] = useState(false)
  const parlay = useMemo(() => buildParlay(legs, { correlate: false }), [legs])
  const live = useMemo(() => comboStatus(legs), [legs])
  const unconfirmed = legs.filter((b) => b.lineupConfirmed !== true).length
  const verdict = decisionLabel(parlay, unconfirmed)
  const grade = parlay.grade
  const gradeTone = grade ? GRADE_COLOR[grade.letter] : null
  const weak = parlay.weak
  const missingPrices = parlay.n - parlay.priced
  const sameGameGroups = parlay.byGame.filter((g) => g.legs.length >= 2).length
  const payDecimal = parlay.allPriced ? parlay.decimal : parlay.fairDecimal
  const wagerNum = parseFloat(wager)
  const payout = Number.isFinite(wagerNum) && wagerNum > 0 && payDecimal ? wagerNum * payDecimal : null
  const shownPayout = useCountUp(payout)

  const replacements = useMemo(() => {
    if (!weak || !onReplace) return []
    const base = legs.filter((b) => b.id !== weak.id)
    const usedIds = new Set(base.map((b) => b.id))
    const usedGames = new Set(base.map((b) => b.gamePk).filter((x) => x != null))
    const perGame = new Map()
    for (const b of batters) {
      if (b.id === weak.id || usedIds.has(b.id) || b.game?.isFinal || b.game?.isLive) continue
      if (b.gamePk != null && usedGames.has(b.gamePk)) continue
      if ((b.grade?.label || 'SKIP') === 'SKIP' || !Number.isFinite(b.hrProbability)) continue
      const key = b.gamePk ?? `solo-${b.id}`
      const current = perGame.get(key)
      if (!current || (b.score ?? 0) > (current.score ?? 0)) perGame.set(key, b)
    }
    return [...perGame.values()]
      .map((candidate) => {
        const next = buildParlay([...base, candidate], { correlate: false })
        return { candidate, next, delta: next.modelAllHit - parlay.modelAllHit }
      })
      .filter(({ delta }) => delta > 0)
      .sort((a, b) => b.delta - a.delta || (b.candidate.score ?? 0) - (a.candidate.score ?? 0))
      .slice(0, 3)
  }, [batters, legs, onReplace, parlay.modelAllHit, weak])

  if (!legs.length) return null

  const signals = [
    parlay.allPriced
      ? { icon: 'TrendingUp', label: parlay.ev >= 0 ? `${signedPct(parlay.ev, 0)} EV vs posted prices` : `${signedPct(parlay.ev, 0)} EV at posted prices`, tone: parlay.ev >= 0 ? 'positive' : 'negative' }
      : { icon: 'CircleDollarSign', label: `${missingPrices} ${missingPrices === 1 ? 'leg needs' : 'legs need'} sportsbook odds`, tone: 'neutral' },
    { icon: unconfirmed ? 'Clock' : 'CircleCheck', label: unconfirmed ? `${unconfirmed} of ${parlay.n} lineups projected` : `All ${parlay.n} lineups confirmed`, tone: unconfirmed ? 'warning' : 'positive' },
    { icon: sameGameGroups ? 'GitBranch' : 'Split', label: sameGameGroups ? `${sameGameGroups} same-game ${sameGameGroups === 1 ? 'group' : 'groups'} · independent estimate` : 'Every leg is from a separate game', tone: 'neutral' },
  ]

  const share = async () => {
    try {
      const text = copyText(legs, parlay)
      if (navigator.share) await navigator.share({ title: 'StatFax parlay', text })
      else {
        await navigator.clipboard.writeText(text)
        toast.success('Parlay copied')
      }
    } catch {
      // Dismissing a native share sheet is not an error worth surfacing.
    }
  }

  return (
    <div className={`slip parlay-slip ${open ? 'open' : ''}`}>
      {open && (
        <div className="slip-panel">
          <header className="slip-panel-head">
            <div className="slip-head-copy">
              <span className="slip-eyebrow">Active parlay</span>
              <div className="slip-title-row">
                <h2>Decision Slip</h2>
                <span className="slip-leg-count">{parlay.n} {parlay.n === 1 ? 'leg' : 'legs'}</span>
                {grade && (
                  <span className={`slip-grade grade-glow-${grade.letter}`} style={{ color: gradeTone, borderColor: hexA(gradeTone, 0.4), background: hexA(gradeTone, 0.08) }}>
                    Grade {grade.letter}
                  </span>
                )}
              </div>
            </div>
            <div className="slip-head-actions" role="group" aria-label="Slip actions">
              <button type="button" className="icon-btn" onClick={share} aria-label="Share parlay" title="Share or copy"><Icon name="Share2" size={15} /></button>
              <button type="button" className="icon-btn" onClick={() => saveSlip(legs, parlay, wager)} aria-label="Save parlay" title="Save"><Icon name="Bookmark" size={15} /></button>
              <button type="button" className="icon-btn" onClick={onClear} aria-label="Clear parlay" title="Clear"><Icon name="Trash2" size={15} /></button>
              <button type="button" className="icon-btn slip-close" onClick={() => setOpen(false)} aria-label="Close decision slip"><Icon name="X" size={17} /></button>
            </div>
          </header>

          <div className="slip-decision-body">
            <section className={`slip-scorecard ${verdict.tone}`} aria-label="Parlay scorecard">
              <div className="slip-scorecard-verdict">
                <span>{verdict.label}</span>
                <small>{verdict.detail}</small>
              </div>
              <div className="slip-score-metric">
                <span>All-hit</span>
                <strong className="mono">{pct(parlay.modelAllHit, parlay.modelAllHit < 0.01 ? 2 : 1)}</strong>
              </div>
              <div className="slip-score-metric">
                <span>{parlay.allPriced ? 'Market odds' : 'Fair odds'}</span>
                <strong className="mono">{american(parlay.allPriced ? parlay.american : parlay.fairAmerican)}</strong>
              </div>
            </section>

            <section className="slip-signals" aria-label="Construction checks">
              {signals.map((signal) => (
                <div className={`slip-signal ${signal.tone}`} key={signal.label}>
                  <Icon name={signal.icon} size={13} />
                  <span>{signal.label}</span>
                </div>
              ))}
            </section>

            {live.started && (
              <section className={`slip-live-state ${live.code}`}>
                <span style={{ color: VERDICT_META[live.code].color }}><Icon name={VERDICT_META[live.code].icon} size={13} /> {VERDICT_META[live.code].label}</span>
                <b>{live.hits}/{live.n} legs hit</b>
              </section>
            )}

            <section className="slip-leg-section">
              <div className="slip-section-head"><span>Your legs</span><small>Strongest signal first</small></div>
              <div className="slip-legs">
                {[...legs].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((b) => {
                  const status = legStatus(b)
                  const statusMeta = LEG_META[status.code]
                  const isWeak = b.id === weak?.id
                  return (
                    <article className={`slip-leg-card ${isWeak ? 'weak' : ''}`} key={b.id}>
                      <button type="button" className="slip-leg-main" onClick={() => onSelect(b)}>
                        <span className="slip-leg-grade-mark" style={{ background: gradeColor(b.grade?.label) }} />
                        <span className="slip-leg-identity">
                          <span><b>{b.name}</b><small>{b.team}</small></span>
                          <span className="slip-leg-meta">
                            {isWeak && <em><Icon name="TriangleAlert" size={10} /> Weakest leg</em>}
                            <span style={{ color: statusMeta.color }}><Icon name={statusMeta.icon} size={10} /> {status.label}</span>
                          </span>
                        </span>
                      </button>
                      <GradeChip grade={b.grade} size="sm" score={b.score} />
                      <span className="slip-leg-number mono"><b>{pct(b.hrProbability, 1)}</b><small>model</small></span>
                      <span className="slip-leg-number mono"><b>{b.odds?.best ? american(b.odds.best.american) : '—'}</b><small>book</small></span>
                      <button type="button" className="slip-leg-remove" onClick={() => onRemove(b.id)} aria-label={`Remove ${b.name}`}><Icon name="X" size={14} /></button>
                    </article>
                  )
                })}
              </div>
            </section>

            {weak && (
              <section className="slip-weak-card">
                <div>
                  <span className="slip-eyebrow">Weakest leg</span>
                  <b>{weak.name} is the first stress point.</b>
                  <small>Its {pct(weak.hrProbability, 1)} model rate limits this ticket most.</small>
                </div>
                {replacements.length > 0 && (
                  <button type="button" className="slip-replace-toggle" onClick={() => setReplaceOpen((value) => !value)}>
                    <Icon name="RefreshCw" size={13} /> {replaceOpen ? 'Hide options' : 'Find a stronger leg'}
                  </button>
                )}
                {replaceOpen && (
                  <div className="slip-replacements">
                    {replacements.map(({ candidate, next, delta }) => (
                      <button type="button" key={candidate.id} onClick={() => {
                        onReplace(legs.map((b) => b.id === weak.id ? candidate.id : b.id))
                        setReplaceOpen(false)
                        toast.success(`${surname(candidate.name)} replaced ${surname(weak.name)}`)
                      }}>
                        <span><b>{candidate.name}</b><small>{candidate.team} · Grade {next.grade?.letter || '—'}</small></span>
                        <span className={`mono ${delta >= 0 ? 'pos' : 'neg'}`}>{signedPct(delta, 3)} all-hit</span>
                        <Icon name="ArrowRight" size={13} />
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>

          <footer className="slip-review-footer">
            <div className="slip-wager">
              <label><span>Wager</span><span className="slip-money-input mono">$<input type="number" inputMode="decimal" min="0" step="1" value={wager} onChange={(e) => setWager(e.target.value)} aria-label="Wager" /></span></label>
              <Icon name="ArrowRight" size={14} />
              <div><span>Payout{parlay.allPriced ? '' : ' at fair odds'}</span><strong className="mono">{shownPayout != null && Number.isFinite(shownPayout) ? `$${shownPayout >= 100 ? Math.round(shownPayout) : shownPayout.toFixed(2)}` : '—'}</strong></div>
            </div>
            <button type="button" className="slip-review-btn" onClick={() => { setOpen(false); onOpenBuilder?.() }}><Icon name="ScanSearch" size={16} /> {unconfirmed ? 'Review preview' : 'Review parlay'}</button>
          </footer>
        </div>
      )}

      <button className="slip-bar" type="button" onClick={() => setOpen(true)} aria-label="Open decision slip">
        <span className="slip-bar-left">
          <span className="slip-count">{parlay.n}</span>
          <span><b>Decision Slip</b><small>{verdict.label}</small></span>
        </span>
        <span className="slip-bar-stats">
          <span><small>All-hit</small><b className="mono">{pct(parlay.modelAllHit, parlay.modelAllHit < 0.01 ? 2 : 1)}</b></span>
          {parlay.ev != null && <span><small>EV</small><b className={`mono ${parlay.ev >= 0 ? 'pos' : 'neg'}`}>{signedPct(parlay.ev, 0)}</b></span>}
          <Icon name="ChevronUp" size={15} />
        </span>
      </button>
    </div>
  )
}
