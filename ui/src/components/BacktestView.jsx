import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { GRADE_ORDER, BADGES, gradeColor } from '../lib/badges.js'
import * as store from '../lib/storage.js'

const BASE_URL = import.meta.env?.BASE_URL ?? '/'
// Worker endpoint that turns plain English into filters. Unset → NL box hidden.
const PARSE_URL = import.meta.env?.VITE_PARSE_URL || ''
// Signals the BOARD can filter on (so a saved system applies to tonight exactly).
const BOARD_SIGNALS = new Set(BADGES.map((b) => b.key))

// Prettify a camelCase badge key → "Bullpen Legend".
const pretty = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
const pctOf = (x) => (x * 100).toFixed(1) + '%'

// Signal Backtest — a structured "system builder" over the reconciled log:
// stack a grade and/or signal conditions and see the historical HR hit rate vs
// the base rate. (Not natural language — that needs an LLM backend; this is the
// same evidence `npm run lab:audit` produces, made interactive.)
export default function BacktestView({ batters = [], onApply }) {
  const [log, setLog] = useState(null)
  const [err, setErr] = useState(null)
  const [grades, setGrades] = useState(new Set())
  const [signals, setSignals] = useState(new Set())
  const [q, setQ] = useState('')
  const [asking, setAsking] = useState(false)
  const [askErr, setAskErr] = useState(null)
  const [systems, setSystems] = useState(() => store.load('systems', []))
  const [sysName, setSysName] = useState('')

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
    // How many of TONIGHT's bats fit the same selection (board signals only).
    const gArr = [...grades]
    const sArr = [...signals]
    const tonight = (batters || []).filter(
      (b) => (gArr.length === 0 || gArr.includes(b.grade?.label || 'SKIP')) && sArr.every((s) => b[s] === true),
    ).length
    return { base, n: matched.length, hits, hr, lift: base ? hr / base : 0, tonight, days: log.dates?.length || 0, total: rows.length }
  }, [rows, grades, signals, log, batters])

  // History + tonight counts for a saved system spec.
  const sysMetrics = (sys) => {
    const g = sys.grades || []
    const s = sys.signals || []
    const m = rows.filter((r) => (g.length === 0 || g.includes(r.grade)) && s.every((x) => (r.badges || []).includes(x)))
    const tonight = (batters || []).filter(
      (b) => (g.length === 0 || g.includes(b.grade?.label || 'SKIP')) && s.every((x) => b[x] === true),
    ).length
    return { histHr: m.length ? m.filter((r) => r.homered).length / m.length : null, tonight }
  }
  // Can only save/apply when every chosen signal is one the board can filter on.
  const canSave = (grades.size > 0 || signals.size > 0) && [...signals].every((s) => BOARD_SIGNALS.has(s))
  const autoName = () => [...grades, ...[...signals].map(pretty)].join(' · ') || 'System'
  const saveSystem = () => {
    if (!canSave) return
    const sys = { id: String(Date.now()), name: sysName.trim() || autoName(), grades: [...grades], signals: [...signals] }
    const next = [sys, ...systems].slice(0, 24)
    setSystems(next)
    store.save('systems', next)
    setSysName('')
  }
  const removeSystem = (id) => {
    const next = systems.filter((s) => s.id !== id)
    setSystems(next)
    store.save('systems', next)
  }
  const applySystem = (sys) => onApply?.(sys.grades || [], (sys.signals || []).filter((s) => BOARD_SIGNALS.has(s)))

  const toggle = (set, setSet) => (key) => {
    const next = new Set(set)
    next.has(key) ? next.delete(key) : next.add(key)
    setSet(next)
  }
  const reset = () => {
    setGrades(new Set())
    setSignals(new Set())
  }
  const ask = async (text) => {
    const query = (text ?? q).trim()
    if (!query || asking) return
    setQ(query)
    setAsking(true)
    setAskErr(null)
    try {
      const r = await fetch(PARSE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, grades: GRADE_ORDER, signals: signalKeys }),
      })
      const j = await r.json()
      if (j.error) throw new Error(j.error)
      setGrades(new Set(j.grades || []))
      setSignals(new Set(j.signals || []))
    } catch (e) {
      setAskErr(e.message || 'failed')
    } finally {
      setAsking(false)
    }
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

      {PARSE_URL && (
        <form
          className="bt-ask"
          onSubmit={(e) => {
            e.preventDefault()
            ask()
          }}
        >
          <Icon name="Search" size={15} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask in plain English — e.g. hot due power bats"
            aria-label="Describe a backtest"
          />
          <button type="submit" disabled={asking || !q.trim()}>
            {asking ? '…' : 'Ask'}
          </button>
        </form>
      )}
      {PARSE_URL && (
        <div className="bt-examples">
          {['hot due power bats', 'elite home sluggers', 'strong or better hot bats'].map((ex) => (
            <button key={ex} className="bt-ex" onClick={() => ask(ex)} disabled={asking}>
              {ex}
            </button>
          ))}
        </div>
      )}
      {askErr && <div className="bt-warn">Couldn’t parse: {askErr}</div>}

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
            <span key={res.hr} className="bt-stat-v mono slip-legs-bump">{pctOf(res.hr)}</span>
            <span className="bt-stat-k">homered</span>
          </div>
          <div className="bt-stat">
            <span key={res.lift} className="bt-stat-v mono slip-legs-bump">{res.lift.toFixed(2)}×</span>
            <span className="bt-stat-k">vs base</span>
          </div>
          <div className="bt-stat">
            <span key={res.n} className="bt-stat-v mono slip-legs-bump">{res.hits}/{res.n.toLocaleString()}</span>
            <span className="bt-stat-k">sample</span>
          </div>
          {onApply && (
            <div className="bt-stat">
              <span key={res.tonight} className="bt-stat-v mono slip-legs-bump">{res.tonight}</span>
              <span className="bt-stat-k">tonight</span>
            </div>
          )}
          {(grades.size || signals.size) > 0 && (
            <button className="bt-reset" onClick={reset}>
              <Icon name="X" size={13} /> Reset
            </button>
          )}
        </div>
      )}
      {small && <div className="bt-warn">⚠ Small sample ({res.n}) — read with caution.</div>}

      <div className="bt-systems">
        <span className="bt-glabel">Systems — save a pattern, one-tap it onto tonight’s board</span>
        <div className="bt-sys-save">
          <input
            value={sysName}
            onChange={(e) => setSysName(e.target.value)}
            placeholder={canSave ? 'Name this system…' : 'Pick a grade / board signal first'}
            aria-label="System name"
            onKeyDown={(e) => e.key === 'Enter' && saveSystem()}
          />
          <button onClick={saveSystem} disabled={!canSave} title={canSave ? 'Save current filters as a system' : 'Select a grade and/or board-filterable signal'}>
            <Icon name="Plus" size={13} /> Save
          </button>
        </div>
        {!signalsAreBoardOk(signals) && (
          <div className="bt-warn">Some selected signals aren’t board filters, so this can’t be saved as a tonight system.</div>
        )}
        {systems.length > 0 && (
          <ul className="bt-sys-list">
            {systems.map((sys) => {
              const m = sysMetrics(sys)
              return (
                <li key={sys.id} className="bt-sys">
                  <button className="bt-sys-main" onClick={() => applySystem(sys)} title="Apply to the board" disabled={!onApply}>
                    <span className="bt-sys-name">{sys.name}</span>
                    <span className="bt-sys-meta dim">
                      {m.histHr != null ? `${pctOf(m.histHr)} hist` : '— hist'} · <b className="bt-sys-tonight">{m.tonight} tonight</b>
                    </span>
                  </button>
                  <button className="bt-sys-x" onClick={() => removeSystem(sys.id)} aria-label="Delete system">
                    <Icon name="X" size={13} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function signalsAreBoardOk(signals) {
  return [...signals].every((s) => BOARD_SIGNALS.has(s))
}
