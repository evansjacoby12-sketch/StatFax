import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { GRADE_ORDER, gradeColor } from '../lib/badges.js'

const BASE_URL = import.meta.env?.BASE_URL ?? '/'

// Prettify a camelCase badge key → "Bullpen Legend".
const pretty = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
const pctOf = (x) => (x * 100).toFixed(1) + '%'

// Signal Backtest — a structured "system builder" over the reconciled log:
// stack a grade and/or signal conditions and see the historical HR hit rate vs
// the base rate. (Not natural language — that needs an LLM backend; this is the
// same evidence `npm run lab:audit` produces, made interactive.)
export default function BacktestView() {
  const [log, setLog] = useState(null)
  const [err, setErr] = useState(null)
  const [grades, setGrades] = useState(new Set())
  const [signals, setSignals] = useState(new Set())

  useEffect(() => {
    let alive = true
    fetch(`${BASE_URL}data/backtest-log.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((j) => alive && setLog(j))
      .catch((e) => alive && setErr(e.message))
    return () => {
      alive = false
    }
  }, [])

  const rows = useMemo(() => {
    if (!log) return []
    const out = []
    for (const d of log.dates || []) for (const r of log.records?.[d] || []) {
      if (r.actuallyPlayed === false) continue
      if (typeof r.homered !== 'boolean') continue
      out.push(r)
    }
    return out
  }, [log])

  const signalKeys = useMemo(() => [...new Set(rows.flatMap((r) => r.badges || []))].sort(), [rows])

  const res = useMemo(() => {
    if (!rows.length) return null
    const base = rows.filter((r) => r.homered).length / rows.length
    const matched = rows.filter(
      (r) =>
        (grades.size === 0 || grades.has(r.grade)) &&
        (signals.size === 0 || [...signals].every((s) => (r.badges || []).includes(s))),
    )
    const hits = matched.filter((r) => r.homered).length
    const hr = matched.length ? hits / matched.length : 0
    return { base, n: matched.length, hits, hr, lift: base ? hr / base : 0, days: log.dates?.length || 0, total: rows.length }
  }, [rows, grades, signals, log])

  const toggle = (set, setSet) => (key) => {
    const next = new Set(set)
    next.has(key) ? next.delete(key) : next.add(key)
    setSet(next)
  }
  const reset = () => {
    setGrades(new Set())
    setSignals(new Set())
  }

  if (err) return <div className="empty-note">Couldn’t load the backtest log ({err}).</div>
  if (!log) return <div className="empty-note">Loading reconciled history…</div>

  const liftTone = res && res.n >= 20 ? (res.lift >= 1.15 ? 'good' : res.lift <= 0.85 ? 'bad' : 'warn') : ''
  const small = res && res.n < 20

  return (
    <div className="bt">
      <p className="bt-intro dim">
        Stack conditions and see how often they actually homered over{' '}
        <b>{res?.days} days · {res?.total.toLocaleString()} bats</b> (base rate {res ? pctOf(res.base) : '—'}). Signals
        require <b>all</b> selected to be present.
      </p>

      <div className="bt-group">
        <span className="bt-glabel">Grade {grades.size ? `(any of ${grades.size})` : ''}</span>
        <div className="bt-chips">
          {GRADE_ORDER.map((g) => {
            const on = grades.has(g)
            const c = gradeColor(g)
            return (
              <button
                key={g}
                className={`badge-toggle ${on ? 'on' : ''}`}
                onClick={() => toggle(grades, setGrades)(g)}
                style={on ? { color: c, borderColor: c, background: 'color-mix(in srgb,' + c + ' 14%, transparent)' } : undefined}
              >
                {g}
              </button>
            )
          })}
        </div>
      </div>

      <div className="bt-group">
        <span className="bt-glabel">Signals {signals.size ? `(all of ${signals.size})` : ''}</span>
        <div className="bt-chips">
          {signalKeys.map((k) => (
            <button key={k} className={`badge-toggle ${signals.has(k) ? 'on' : ''}`} onClick={() => toggle(signals, setSignals)(k)}>
              {pretty(k)}
            </button>
          ))}
        </div>
      </div>

      {res && (
        <div className={`bt-result ${liftTone}`}>
          <div className="bt-stat">
            <span className="bt-stat-v mono">{pctOf(res.hr)}</span>
            <span className="bt-stat-k">homered</span>
          </div>
          <div className="bt-stat">
            <span className="bt-stat-v mono">{res.lift.toFixed(2)}×</span>
            <span className="bt-stat-k">vs base</span>
          </div>
          <div className="bt-stat">
            <span className="bt-stat-v mono">{res.hits}/{res.n.toLocaleString()}</span>
            <span className="bt-stat-k">sample</span>
          </div>
          {(grades.size || signals.size) > 0 && (
            <button className="bt-reset" onClick={reset}>
              <Icon name="X" size={13} /> Reset
            </button>
          )}
        </div>
      )}
      {small && <div className="bt-warn">⚠ Small sample ({res.n}) — read with caution.</div>}
    </div>
  )
}
