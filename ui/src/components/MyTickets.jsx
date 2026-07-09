import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { pct, american, surname } from '../lib/format.js'
import { legStatus } from '../lib/live.js'
import { useTickets, makeTicket } from '../lib/tickets.js'

// My Tickets — the combos YOU tracked, graded as your own bets. Independent of
// the model's current picks: a ticket you Track keeps its exact legs even after
// the board re-ranks. Grades live against today's batters; freezes the result
// once every leg's game is final so it survives into later days.

const STATUS_META = {
  cashed:  { label: 'CASHED', color: 'var(--strong)', icon: 'Check' },
  lost:    { label: 'LOST',   color: 'var(--bad)',    icon: 'X' },
  live:    { label: 'LIVE',   color: 'var(--accent)', icon: 'Activity' },
  pending: { label: 'PREGAME',color: 'var(--text-faint)', icon: 'Clock' },
  unknown: { label: '—',      color: 'var(--text-faint)', icon: 'HelpCircle' },
}
const LEG_ICON = { hit: 'Check', dead: 'X', live: 'Activity', pending: 'Clock', unknown: 'Minus' }
const LEG_COLOR = { hit: 'var(--strong)', dead: 'var(--bad)', live: 'var(--accent)', pending: 'var(--text-faint)', unknown: 'var(--text-faint)' }

export default function MyTickets({ batters = [], slateDate = null, onSelect }) {
  const { tickets, toggle, remove, settle } = useTickets()
  const [adding, setAdding] = useState(false)

  const liveById = useMemo(() => new Map((batters || []).map((b) => [Number(b.playerId), b])), [batters])

  // Grade every ticket against the current batters.
  const graded = useMemo(() => tickets.map((t) => {
    const legs = t.legs.map((l) => {
      const b = liveById.get(Number(l.playerId))
      const st = b ? legStatus(b) : null
      return { ...l, code: b ? st.code : 'unknown', final: b?.game?.isFinal === true }
    })
    const found = legs.every((l) => l.code !== 'unknown')
    const hits = legs.filter((l) => l.code === 'hit').length
    const allFinal = found && legs.every((l) => l.final || l.code === 'hit')
    let status
    if (t.settled) status = t.settled.cashed ? 'cashed' : 'lost'
    else if (!found) status = 'unknown'
    else if (hits === legs.length) status = 'cashed'
    else if (legs.some((l) => l.code === 'dead')) status = 'lost'
    else if (legs.some((l) => l.code !== 'pending')) status = 'live'
    else status = 'pending'
    return { t, legs, hits, n: legs.length, status, allFinal }
  }), [tickets, liveById])

  // Freeze the outcome once a today-ticket's games are all final, so it persists
  // after the batter data rolls to the next slate.
  useEffect(() => {
    for (const g of graded) {
      if (!g.t.settled && g.status !== 'unknown' && g.status !== 'live' && g.status !== 'pending' && g.allFinal) {
        settle(g.t.id, g.status === 'cashed')
      }
    }
  }, [graded, settle])

  if (!tickets.length && !adding) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <p className="dim" style={{ fontSize: '12px', margin: 0, lineHeight: 1.4 }}>
          No tracked tickets yet. Tap <b>Track</b> on any combo — even before the lock — to pin that exact ticket and grade it here, live + settled, no matter how the board re-ranks.
        </p>
        <button onClick={() => setAdding(true)} className="mt-add-btn" style={addBtnStyle}>
          <Icon name="Plus" size={13} /> Log a ticket
        </button>
      </div>
    )
  }

  const settled = graded.filter((g) => g.status === 'cashed' || g.status === 'lost')
  const wins = settled.filter((g) => g.status === 'cashed').length
  const liveCount = graded.filter((g) => g.status === 'live').length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <span className="dim" style={{ fontSize: '12px' }}>
          {settled.length > 0 && <><b style={{ color: 'var(--strong)' }}>{wins}</b>/{settled.length} cashed</>}
          {liveCount > 0 && <>{settled.length > 0 ? ' · ' : ''}<b style={{ color: 'var(--accent)' }}>{liveCount}</b> live</>}
          {settled.length === 0 && liveCount === 0 && `${tickets.length} tracked`}
        </span>
        <button onClick={() => setAdding((v) => !v)} className="mt-add-btn" style={{ ...addBtnStyle, marginLeft: 'auto' }}>
          <Icon name={adding ? 'X' : 'Plus'} size={13} /> {adding ? 'Close' : 'Log a ticket'}
        </button>
      </div>

      {adding && <AddTicket batters={batters} slateDate={slateDate} onDone={() => setAdding(false)} onAdd={toggle} />}

      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {graded.map((g) => {
          const sm = STATUS_META[g.status]
          return (
            <li key={g.t.id} style={{
              display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '10px',
              background: g.status === 'cashed' ? 'rgba(16,185,129,0.08)' : g.status === 'lost' ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.02)',
              border: `1px solid ${g.status === 'cashed' ? 'rgba(16,185,129,0.22)' : g.status === 'lost' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)'}`,
            }}>
              <span title={sm.label} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0, fontSize: '10px', fontWeight: '800', color: sm.color, minWidth: '58px' }}>
                <Icon name={sm.icon} size={11} className={g.status === 'live' ? 'spin-pulse' : ''} /> {sm.label}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12.5px', display: 'flex', gap: '2px', flexWrap: 'wrap' }}>
                  {g.legs.map((l, i) => (
                    <span key={l.playerId} onClick={() => onSelect?.(l)} style={{ color: LEG_COLOR[l.code], fontWeight: l.code === 'hit' ? '700' : '500', cursor: onSelect ? 'pointer' : 'default' }}>
                      {surname(l.name)}<Icon name={LEG_ICON[l.code]} size={9} style={{ verticalAlign: 'middle', margin: '0 2px', color: LEG_COLOR[l.code] }} />{i < g.legs.length - 1 ? '· ' : ''}
                    </span>
                  ))}
                </div>
                <div className="dim" style={{ fontSize: '10px', marginTop: '2px' }}>
                  {g.t.label || g.t.strategy} · {g.n}-leg{g.t.date ? ` · ${String(g.t.date).slice(5)}` : ''}
                  {Number.isFinite(g.t.allHitPct) ? ` · all-hit ${pct(g.t.allHitPct, g.t.allHitPct < 0.01 ? 2 : 1)}` : ''}
                  {Number.isFinite(g.t.american) ? ` · ${american(g.t.american)}` : ''}
                </div>
              </div>
              <button onClick={() => remove(g.t.id)} title="Remove ticket" aria-label="Remove ticket" style={{ flexShrink: 0, background: 'transparent', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: '4px' }}>
                <Icon name="Trash2" size={13} />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// Compact picker to log a ticket by hand (e.g. a bet placed off-app, or one the
// board no longer surfaces). Pick 2–4 of today's graded bats.
function AddTicket({ batters, slateDate, onDone, onAdd }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState([]) // batter objects

  const pool = useMemo(() => (batters || [])
    .filter((b) => b.grade?.label === 'PRIME' || b.grade?.label === 'STRONG' || (b.grade && b.grade !== 'SKIP'))
    .filter((b) => !q || b.name.toLowerCase().includes(q.toLowerCase()) || (b.team || '').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 40), [batters, q])

  const pickedIds = new Set(picked.map((b) => b.playerId))
  const toggle = (b) => setPicked((cur) => cur.some((x) => x.playerId === b.playerId) ? cur.filter((x) => x.playerId !== b.playerId) : cur.length >= 4 ? cur : [...cur, b])

  const save = () => {
    if (picked.length < 2) return
    onAdd(makeTicket({ legs: picked, date: slateDate, strategy: 'custom', label: 'My ticket', size: picked.length }))
    setPicked([]); setQ(''); onDone()
  }

  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '12px', marginBottom: '12px' }}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search a hitter to add…"
        style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '8px 10px', color: '#fff', fontSize: '13px', marginBottom: '8px' }}
      />
      {picked.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '8px' }}>
          {picked.map((b) => (
            <span key={b.playerId} onClick={() => toggle(b)} style={{ cursor: 'pointer', fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '6px', background: 'rgba(0,216,246,0.12)', color: 'var(--accent)', border: '1px solid rgba(0,216,246,0.3)' }}>
              {surname(b.name)} <Icon name="X" size={9} style={{ verticalAlign: 'middle' }} />
            </span>
          ))}
        </div>
      )}
      <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {pool.map((b) => (
          <button key={b.playerId} onClick={() => toggle(b)} disabled={!pickedIds.has(b.playerId) && picked.length >= 4} style={{
            display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left', padding: '6px 8px', borderRadius: '6px',
            background: pickedIds.has(b.playerId) ? 'rgba(0,216,246,0.1)' : 'transparent', border: '1px solid transparent', cursor: 'pointer',
          }}>
            <Icon name={pickedIds.has(b.playerId) ? 'CheckSquare' : 'Square'} size={13} style={{ color: pickedIds.has(b.playerId) ? 'var(--accent)' : 'var(--text-faint)', flexShrink: 0 }} />
            <span style={{ fontSize: '12.5px', color: '#fff', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
            <span className="dim" style={{ fontSize: '10px' }}>{b.team} · {b.grade?.label || b.grade}</span>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
        <button onClick={save} disabled={picked.length < 2} style={{ ...addBtnStyle, opacity: picked.length < 2 ? 0.5 : 1, cursor: picked.length < 2 ? 'default' : 'pointer' }}>
          <Icon name="Check" size={13} /> Track {picked.length >= 2 ? `${picked.length}-leg` : '(pick 2–4)'}
        </button>
      </div>
    </div>
  )
}

const addBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: '700',
  padding: '6px 12px', borderRadius: '8px', background: 'rgba(0,216,246,0.08)',
  border: '1px solid rgba(0,216,246,0.25)', color: 'var(--accent)', cursor: 'pointer',
}
