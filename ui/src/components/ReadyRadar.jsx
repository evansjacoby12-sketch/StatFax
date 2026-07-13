import { useMemo } from 'react'
import Icon from './Icon.jsx'
import { pct } from '../lib/format.js'

const READY_KEYS = new Set(['powerReady', 'barrelReady'])

function lensFromBadges(badges) {
  const power = badges.has('powerReady')
  const barrel = badges.has('barrelReady')
  if (power && barrel) return 'both'
  if (power) return 'power'
  if (barrel) return 'barrel'
  return null
}

function matchesLens(batter, lens) {
  if (lens === 'both') return batter.powerReady && batter.barrelReady
  if (lens === 'power') return batter.powerReady
  if (lens === 'barrel') return batter.barrelReady
  return batter.powerReady || batter.barrelReady
}

export default function ReadyRadar({ batters, badges, onChangeBadges, onSelect }) {
  const activeLens = lensFromBadges(badges)
  const stats = useMemo(() => {
    const power = batters.filter((b) => b.powerReady)
    const barrel = batters.filter((b) => b.barrelReady)
    const both = batters.filter((b) => b.powerReady && b.barrelReady)
    const lens = activeLens || (both.length ? 'both' : power.length ? 'power' : 'barrel')
    const pool = batters.filter((b) => matchesLens(b, lens))
    const top = pool.slice().sort((a, b) =>
      (b.hrProbability ?? 0) - (a.hrProbability ?? 0) ||
      (b.score ?? 0) - (a.score ?? 0) ||
      String(a.id).localeCompare(String(b.id)),
    )[0] || null
    return { power: power.length, barrel: barrel.length, both: both.length, lens, top }
  }, [batters, activeLens])

  const pickLens = (lens) => {
    const next = new Set([...badges].filter((key) => !READY_KEYS.has(key)))
    if (activeLens !== lens) {
      if (lens === 'power' || lens === 'both') next.add('powerReady')
      if (lens === 'barrel' || lens === 'both') next.add('barrelReady')
    }
    onChangeBadges(next)
  }

  const lenses = [
    { key: 'power', label: 'Power', count: stats.power, icon: 'Gauge' },
    { key: 'barrel', label: 'Barrel', count: stats.barrel, icon: 'Flame' },
    { key: 'both', label: 'Both', count: stats.both, icon: 'GitMerge' },
  ]

  return (
    <section className="ready-radar" aria-label="Ready Radar beta signals">
      <div className="ready-radar-head">
        <span className="ready-radar-title"><Icon name="Radio" size={12} /> Ready Radar</span>
        <span className="ready-radar-beta">advisory beta</span>
      </div>
      <div className="ready-radar-body">
        <div className="ready-radar-lenses" role="group" aria-label="Filter by ready signal">
          {lenses.map((lens) => {
            const active = activeLens === lens.key
            return (
              <button
                key={lens.key}
                type="button"
                className={`ready-radar-lens ready-radar-${lens.key} ${active ? 'on' : ''}`}
                onClick={() => pickLens(lens.key)}
                aria-pressed={active}
                title={`${lens.count} ${lens.label} Ready batter${lens.count === 1 ? '' : 's'}${active ? ' · tap to clear' : ''}`}
              >
                <Icon name={lens.icon} size={12} />
                <span>{lens.label}</span>
                <b className="mono">{lens.count}</b>
              </button>
            )
          })}
        </div>
        {stats.top ? (
          <button className="ready-radar-top" type="button" onClick={() => onSelect(stats.top)}>
            <span>
              <small>Top {stats.lens}</small>
              <strong>{stats.top.name}</strong>
            </span>
            <b className="mono">{pct(stats.top.hrProbability, 1)}</b>
            <Icon name="ChevronRight" size={15} />
          </button>
        ) : (
          <div className="ready-radar-empty">No qualifying bats on this slate</div>
        )}
      </div>
    </section>
  )
}
