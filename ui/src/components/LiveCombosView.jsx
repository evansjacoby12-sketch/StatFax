import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { hexA } from './atoms.jsx'
import { pct, num } from '../lib/format.js'
import Select from './Select.jsx'
import { buildGroups, lastFirst } from '../lib/groups.js'
import { comboStatus, legStatus, VERDICT_META, LEG_META } from '../lib/live.js'

const GRADE_COLOR = { S: '#f5a623', A: '#32d74b', B: '#3b82f6', C: '#9aa6b6', D: '#6b7787' }
const STATUS_OPTS = [
  { value: 'all', label: 'All live' },
  { value: 'cashed', label: 'Cashed' },
  { value: 'live', label: 'Still alive' },
]
const SIZE_OPTS = [
  { value: 0, label: 'All sizes' },
  { value: 2, label: '2-leg' },
  { value: 3, label: '3-leg' },
  { value: 4, label: '4-leg' },
]

function Tag({ code, text, meta }) {
  const m = meta[code]
  if (!m) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', flexShrink: 0, fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.03em', color: m.color, background: hexA(m.color, 0.12), border: `1px solid ${hexA(m.color, 0.32)}`, borderRadius: '5px', padding: '1px 6px' }}>
      <Icon name={m.icon} size={10} className={code === 'live' ? 'spin-pulse' : ''} /> {text ?? m.label}
    </span>
  )
}

function LiveCombo({ g, onSelect }) {
  const v = comboStatus(g.legs)
  const vm = VERDICT_META[v.code]
  const gc = GRADE_COLOR[g.grade] || '#6b7787'
  return (
    <section className="lc-card" style={{ borderRadius: '12px', border: `1px solid ${hexA(vm.color, 0.3)}`, background: v.code === 'cashed' ? hexA('#10b981', 0.06) : 'rgba(16,24,48,0.4)', padding: '12px 14px', borderLeft: `3px solid ${vm.color}` }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
        <Icon name={g.icon || 'Layers'} size={13} style={{ color: 'var(--accent)' }} />
        <span style={{ fontSize: '12.5px', fontWeight: '700', color: '#fff' }}>{g.label}</span>
        <span className="dim" style={{ fontSize: '10px' }}>{g.size}-leg</span>
        <Tag code={v.code} text={`${vm.label} ${v.hits}/${v.n}`} meta={VERDICT_META} />
        <span style={{ marginLeft: 'auto', color: gc, border: `1px solid ${gc}`, borderRadius: '5px', padding: '0 6px', fontSize: '10px', fontWeight: '800' }}>{g.grade}</span>
      </header>
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {g.legs.map((b, i) => {
          const st = legStatus(b)
          const lm = LEG_META[st.code]
          return (
            <li key={b.id} onClick={() => onSelect(b)} role="button" tabIndex={0} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '4px 2px', opacity: st.code === 'dead' ? 0.55 : 1 }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: lm.color, flexShrink: 0 }} />
              <span style={{ fontSize: '12.5px', fontWeight: '600', color: '#fff', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lastFirst(b.name)}</span>
              <span className="dim" style={{ fontSize: '10px', flexShrink: 0 }}>{b.team}</span>
              <Tag code={st.code === 'hit' ? 'hit' : st.code} text={st.code === 'hit' ? 'HR' : st.code === 'dead' ? 'no HR' : st.code === 'live' ? st.label : 'pre'} meta={LEG_META} />
              <GradeChip grade={b.grade} size="sm" score={b.score} />
            </li>
          )
        })}
      </ul>
      <div className="dim" style={{ fontSize: '10px', marginTop: '6px' }}>all-hit (pregame) {pct(g.allHit, g.allHit < 0.01 ? 2 : 1)}</div>
    </section>
  )
}

export default function LiveCombosView({ batters, onSelect, favorConsistency = false }) {
  const [filter, setFilter] = useState('all')
  const [size, setSize] = useState(0)
  const [strat, setStrat] = useState('all')
  const [gamePks, setGamePks] = useState(() => new Set())

  // Build combos across the FULL slate (finals included) so a combo is tracked
  // all day, then grade each against live HRs.
  const combos = useMemo(() => {
    const bySize = buildGroups(batters, { favorConsistency, includeFinals: true })
    const all = [2, 3, 4].flatMap((k) => bySize[k] || [])
    // Dedupe identical leg sets that recur across strategies/sizes.
    const seen = new Set()
    const out = []
    for (const g of all) {
      const sig = g.legs.map((b) => b.id).slice().sort().join('|')
      if (seen.has(sig)) continue
      seen.add(sig)
      out.push({ g, v: comboStatus(g.legs) })
    }
    return out
  }, [batters, favorConsistency])

  const started = combos.filter((c) => c.v.started)
  const cashed = started.filter((c) => c.v.code === 'cashed')
  const alive = started.filter((c) => c.v.code === 'live')

  // Filter option pools, derived from the combos actually in play.
  const stratOpts = useMemo(() => {
    const m = new Map()
    for (const c of started) if (!m.has(c.g.strategy)) m.set(c.g.strategy, c.g.label)
    return [{ value: 'all', label: 'All strategies' }, ...[...m].map(([value, label]) => ({ value, label }))]
  }, [started])
  const gameOpts = useMemo(() => {
    const m = new Map()
    for (const c of started) for (const b of c.g.legs) {
      if (b.gamePk != null && !m.has(b.gamePk)) m.set(b.gamePk, b.game ? `${b.game.awayTeam?.abbr}@${b.game.homeTeam?.abbr}` : `#${b.gamePk}`)
    }
    return [{ value: '', label: 'All games' }, ...[...m].map(([value, label]) => ({ value, label }))]
  }, [started])

  const shown = started
    .filter((c) => (filter === 'cashed' ? c.v.code === 'cashed' : filter === 'live' ? c.v.code === 'live' : c.v.code === 'cashed' || c.v.code === 'live'))
    .filter((c) => !size || c.g.size === size)
    .filter((c) => strat === 'all' || c.g.strategy === strat)
    .filter((c) => !gamePks.size || c.g.legs.some((b) => gamePks.has(String(b.gamePk))))
    .sort((a, b) =>
      (b.v.code === 'cashed') - (a.v.code === 'cashed') ||
      (b.v.hits / b.v.n) - (a.v.hits / a.v.n) ||
      (b.g.allHit ?? 0) - (a.g.allHit ?? 0),
    )

  return (
    <>
      <p className="lc-intro dim" style={{ fontSize: '12px', marginBottom: '12px', lineHeight: 1.4 }}>
        Model combos in <b>in-progress games</b>, graded live against home runs. <b>Cashed</b> = all legs homered; <b>alive</b> = still going with no dead leg. Dead combos are hidden. Once every leg's game is final the combo drops off here — the settled day-by-day record lives in <b>Results → Combo results</b>.
      </p>

      <div className="lc-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '14px' }}>
        <Kpi label="Cashed" value={cashed.length} color="var(--strong)" />
        <Kpi label="Still alive" value={alive.length} color="var(--accent)" />
        <Kpi label="Tracked" value={started.length} color="var(--text-dim)" />
      </div>

      <div className="lc-filters" style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <Select icon="Activity" title="Status" ariaLabel="Filter by status" value={filter} onChange={setFilter} options={STATUS_OPTS} />
        <Select icon="Layers" title="Legs" ariaLabel="Filter by size" value={size} onChange={setSize} options={SIZE_OPTS} />
        <Select icon="Sparkles" title="Strategy" ariaLabel="Filter by strategy" value={strat} onChange={setStrat} options={stratOpts} />
        {gameOpts.length > 1 && (
          <Select multi icon="List" title="Games" ariaLabel="Filter by game" value={gamePks} onChange={setGamePks} options={gameOpts} />
        )}
      </div>

      {shown.length ? (
        <div className="lc-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {shown.map(({ g }) => <LiveCombo key={g.id} g={g} onSelect={onSelect} />)}
        </div>
      ) : (
        <div className="empty-note" style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-faint)' }}>
          <Icon name="Activity" size={26} />
          <p style={{ marginTop: '8px' }}>
            {started.length === 0 ? 'No games have started yet — combos will light up here as they play.' : 'No combos match this filter right now.'}
          </p>
        </div>
      )}
    </>
  )
}

function Kpi({ label, value, color }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
      <div className="mono" style={{ fontSize: '22px', fontWeight: '800', color }}>{value}</div>
      <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginTop: '2px' }}>{label}</div>
    </div>
  )
}
