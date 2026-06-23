import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import Select from './Select.jsx'
import { pct } from '../lib/format.js'
import { legStatus } from '../lib/live.js'
import LiveCombosView from './LiveCombosView.jsx'

// Dedicated Combos page: live combo tracking (today, in progress) + the settled
// day-by-day combo scorecard graded off the backtest log. Split out of the
// Results view so the model track record and the combo record each get their
// own full page.

const RECENT_DAYS = 7
const STRAT_LABEL = { top: 'Top Picks', mix: 'Best Mix', stack: 'Signal Stack', hot: 'Hot Hand', power: 'Power Bats', matchup: 'Soft Matchup', park: 'Park & Air' }
const CARD = { background: 'rgba(16, 24, 48, 0.45)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '20px', marginBottom: '24px' }
const H3 = { fontSize: '13px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '8px' }

export default function CombosView({ batters, onSelect, favorConsistency = false }) {
  const [log, setLog] = useState(null)
  const [err, setErr] = useState(null)
  const [comboDay, setComboDay] = useState(null)
  const [comboBoard, setComboBoard] = useState('full')
  const [comboSize, setComboSize] = useState(0)

  useEffect(() => {
    let alive = true
    fetch(`${import.meta.env.BASE_URL}data/backtest-log.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((d) => alive && setLog(d))
      .catch((e) => alive && setErr(String(e)))
    return () => { alive = false }
  }, [])

  // Settled (reconciled) combo record — built only when the log is present.
  const settled = (() => {
    if (!log) return null
    const comboByDate = { ...(log.combos?.fullByDate || {}), ...(log.combos?.byDate || {}) }
    const comboLateByDate = log.combos?.lateByDate || {}
    const comboWindowsByDate = log.combos?.windowsByDate || {}
    const comboDates = [...new Set([
      ...Object.keys(comboByDate).filter((d) => (comboByDate[d] || []).length),
      ...Object.keys(comboWindowsByDate).filter((d) => (comboWindowsByDate[d] || []).length),
    ])].sort().reverse().slice(0, RECENT_DAYS)
    if (!comboDates.length) return { comboDates: [] }
    const activeComboDay = comboDay && comboDates.includes(comboDay) ? comboDay : comboDates[0] || null
    const windows = (activeComboDay && comboWindowsByDate[activeComboDay]) || []
    const hasFull = activeComboDay && (comboByDate[activeComboDay] || []).length > 0
    const hasLate = activeComboDay && (comboLateByDate[activeComboDay] || []).length > 0
    const wIdx = /^w(\d+)$/.test(comboBoard) ? Number(comboBoard.slice(1)) : -1
    const board = windows[wIdx] ? comboBoard : comboBoard === 'late' && hasLate ? 'late' : hasFull ? 'full' : windows.length ? 'w0' : 'full'
    const effWIdx = board === 'full' || board === 'late' ? -1 : (wIdx >= 0 ? wIdx : 0)
    const boardOptions = [
      ...(hasFull ? [{ value: 'full', label: 'Full Board' }] : []),
      ...windows.map((w, i) => ({ value: `w${i}`, label: `${w.label} (${w.games}g)` })),
      ...(!windows.length && hasLate ? [{ value: 'late', label: 'Evening Board' }] : []),
    ]
    const recByDay = (d) => { const map = new Map(); for (const r of log.records?.[d] || []) map.set(Number(r.playerId), r); return map }
    // Live fallback for today's un-reconciled day (no records yet → read HR
    // status from the live slate instead of showing #playerId / all misses).
    const liveById = new Map((batters || []).map((b) => [Number(b.playerId), { name: b.name, st: legStatus(b) }]))
    const dayCombos = (() => {
      if (!activeComboDay) return []
      const recs = recByDay(activeComboDay)
      const src = windows[effWIdx] ? windows[effWIdx].combos : board === 'late' ? comboLateByDate[activeComboDay] : comboByDate[activeComboDay]
      return (src || [])
        .filter((c) => c.size <= 3 && (!comboSize || c.size === comboSize))
        .map((c) => {
          const legs = (c.legs || []).map((pid) => {
            const r = recs.get(Number(pid))
            const lb = liveById.get(Number(pid))
            const name = r?.name || lb?.name || `#${pid}`
            let status
            if (r) status = r.homered === true ? 'hit' : 'dead'
            else if (lb) status = lb.st.code === 'hit' ? 'hit' : lb.st.code === 'dead' ? 'dead' : 'live'
            else status = 'dead'
            return { name: name.split(' ').slice(-1)[0], homered: status === 'hit', status }
          })
          const nHit = legs.filter((l) => l.homered).length
          return { strategy: c.strategy, size: c.size, nHit, allHit: legs.length > 0 && nHit === legs.length, legs }
        })
        .sort((a, b) => Number(b.allHit) - Number(a.allHit) || a.size - b.size)
    })()
    // Per-day cashes split by board (main full board + every window board, ≤3).
    const boardTally = (d) => {
      const recs = recByDay(d)
      const count = (combos) => {
        let hit = 0, tot = 0
        for (const c of combos || []) {
          if (c.size > 3) continue
          const legs = (c.legs || []).map((pid) => recs.get(Number(pid)))
          if (!legs.length || legs.some((r) => !r)) continue
          tot++
          if (legs.every((r) => r.homered === true)) hit++
        }
        return { hit, tot }
      }
      const full = count(comboByDate[d])
      let wHit = 0, wTot = 0
      for (const w of comboWindowsByDate[d] || []) { const x = count(w.combos); wHit += x.hit; wTot += x.tot }
      return { full, windows: { hit: wHit, tot: wTot } }
    }
    const comboWeek = comboDates.reduce((acc, d) => { const t = boardTally(d); acc.cashed += t.full.hit + t.windows.hit; acc.total += t.full.tot + t.windows.tot; return acc }, { cashed: 0, total: 0 })
    const dayTally = activeComboDay ? boardTally(activeComboDay) : null

    // Same-game parlays — one frozen SGP per game per size (server sgpByDate),
    // graded the same way (records, with the live fallback for today).
    const sgpRaw = (activeComboDay && (log.combos?.sgpByDate?.[activeComboDay] || [])) || []
    const recsForSgp = activeComboDay ? recByDay(activeComboDay) : new Map()
    const sgpDay = sgpRaw
      .filter((s) => !comboSize || s.size === comboSize)
      .map((s) => {
        const legs = (s.legs || []).map((pid) => {
          const r = recsForSgp.get(Number(pid))
          const lb = liveById.get(Number(pid))
          const name = r?.name || lb?.name || `#${pid}`
          let status
          if (r) status = r.homered === true ? 'hit' : 'dead'
          else if (lb) status = lb.st.code === 'hit' ? 'hit' : lb.st.code === 'dead' ? 'dead' : 'live'
          else status = 'dead'
          return { name: name.split(' ').slice(-1)[0], status }
        })
        const nHit = legs.filter((l) => l.status === 'hit').length
        return { gamePk: s.gamePk, size: s.size, legs, nHit, allHit: legs.length > 0 && nHit === legs.length }
      })
      .sort((a, b) => Number(b.allHit) - Number(a.allHit) || b.nHit - a.nHit || a.size - b.size)
    const sgpCashed = sgpDay.filter((s) => s.allHit).length
    return { comboDates, activeComboDay, board, boardOptions, dayCombos, comboWeek, dayTally, sgpDay, sgpCashed }
  })()

  return (
    <div className="results">
      {batters && (
        <section className="results-card" style={CARD}>
          <h3 className="section-title" style={H3}>
            <Icon name="Activity" size={14} style={{ color: 'var(--accent)' }} /> Live combos
            <span style={{ fontWeight: '400', textTransform: 'none', marginLeft: '6px', fontSize: '12px', color: 'var(--text-faint)' }}>· today, in progress</span>
          </h3>
          <LiveCombosView batters={batters} onSelect={onSelect} favorConsistency={favorConsistency} />
        </section>
      )}

      {err ? (
        <div className="empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px', color: 'var(--text-faint)', gap: '12px' }}>
          <Icon name="TriangleAlert" size={28} />
          <p>No combo log yet — run a few days of slate + reconcile to build a record.</p>
        </div>
      ) : !log ? (
        <div className="results-loading" style={{ display: 'flex', justifyContent: 'center', padding: '48px', color: 'var(--text-dim)', fontWeight: '600' }}>Loading combo record…</div>
      ) : settled && settled.comboDates.length > 0 ? (
        <section className="results-card" style={{ ...CARD, marginBottom: 0 }}>
          <h3 className="section-title" style={H3}>
            <Icon name="Layers" size={14} style={{ color: 'var(--accent)' }} /> Combo results
            <span style={{ fontWeight: '400', textTransform: 'none', marginLeft: '6px', fontSize: '12px', color: 'var(--text-faint)' }}>
              · last 7d <b style={{ color: 'var(--strong)' }}>{settled.comboWeek.cashed}</b>/{settled.comboWeek.total} cashed
              {settled.activeComboDay && settled.dayTally ? (
                <> · {settled.activeComboDay.slice(5)}: <b style={{ color: 'var(--strong)' }}>{settled.dayTally.full.hit + settled.dayTally.windows.hit}</b> hit <span style={{ opacity: 0.8 }}>(main {settled.dayTally.full.hit} · windows {settled.dayTally.windows.hit})</span></>
              ) : ''}
            </span>
          </h3>
          <div className="combo-res-controls" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
            {settled.boardOptions.length > 1 && (
              <Select icon="LayoutGrid" title="Board" ariaLabel="Board" value={settled.board} onChange={setComboBoard} options={settled.boardOptions} />
            )}
            {settled.comboDates.length > 1 && (
              <Select icon="Clock" title="Day" ariaLabel="Results day" value={settled.activeComboDay} onChange={setComboDay} options={settled.comboDates.map((d) => ({ value: d, label: d.slice(5) }))} />
            )}
            <Select icon="Layers" title="Legs" ariaLabel="Combo size" value={comboSize} onChange={setComboSize} options={[{ value: 0, label: 'All sizes' }, { value: 2, label: '2-leg' }, { value: 3, label: '3-leg' }]} />
          </div>
          <ul className="combo-res" style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {settled.dayCombos.map((c, i) => (
              <li className={`combo-res-row ${c.allHit ? 'hit' : 'miss'}`} key={`${c.strategy}-${c.size}-${i}`} style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                background: c.allHit ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${c.allHit ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.04)'}`,
                padding: '10px 14px', borderRadius: '8px'
              }}>
                <span className="combo-res-badge" style={{ fontSize: '16px' }}>{c.allHit ? '🎯' : `${c.nHit}/${c.size}`}</span>
                <span className="combo-res-strat" style={{ fontWeight: '700', fontSize: '13px', color: '#fff', width: '100px' }}>{STRAT_LABEL[c.strategy] || c.strategy}</span>
                <span className="combo-res-size dim" style={{ fontSize: '11px', width: '50px' }}>{c.size}-leg</span>
                <span className="combo-res-legs" style={{ fontSize: '12px', flex: '1' }}>
                  {c.legs.map((l, j) => (
                    <span key={j} style={{ color: l.status === 'hit' ? 'var(--strong)' : l.status === 'live' ? 'var(--accent)' : 'var(--text-dim)', fontWeight: l.status === 'hit' ? '700' : '400' }}>
                      {l.name} {l.status === 'hit' ? '✅' : l.status === 'live' ? '⏳' : '❌'}{j < c.legs.length - 1 ? ' · ' : ''}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>

          {settled.sgpDay.length > 0 && (
            <>
              <h3 className="section-title" style={{ ...H3, marginTop: '22px' }}>
                <Icon name="Zap" size={14} style={{ color: 'var(--accent)' }} /> Same-game parlays
                <span style={{ fontWeight: '400', textTransform: 'none', marginLeft: '6px', fontSize: '12px', color: 'var(--text-faint)' }}>
                  · <b style={{ color: 'var(--strong)' }}>{settled.sgpCashed}</b>/{settled.sgpDay.length} cashed {settled.activeComboDay ? `on ${settled.activeComboDay.slice(5)}` : ''} · best bats per game
                </span>
              </h3>
              <ul className="combo-res" style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {settled.sgpDay.map((s, i) => (
                  <li className={`combo-res-row ${s.allHit ? 'hit' : 'miss'}`} key={`sgp-${s.gamePk}-${s.size}-${i}`} style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    background: s.allHit ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${s.allHit ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.04)'}`,
                    padding: '10px 14px', borderRadius: '8px'
                  }}>
                    <span className="combo-res-badge" style={{ fontSize: '16px' }}>{s.allHit ? '🎯' : `${s.nHit}/${s.size}`}</span>
                    <span className="combo-res-size dim" style={{ fontSize: '11px', width: '74px' }}>{s.size}-leg SGP</span>
                    <span className="combo-res-legs" style={{ fontSize: '12px', flex: '1' }}>
                      {s.legs.map((l, j) => (
                        <span key={j} style={{ color: l.status === 'hit' ? 'var(--strong)' : l.status === 'live' ? 'var(--accent)' : 'var(--text-dim)', fontWeight: l.status === 'hit' ? '700' : '400' }}>
                          {l.name} {l.status === 'hit' ? '✅' : l.status === 'live' ? '⏳' : '❌'}{j < s.legs.length - 1 ? ' · ' : ''}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ) : (
        <div className="empty-note" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-faint)' }}>No graded combo days yet.</div>
      )}
    </div>
  )
}
