import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { pct } from '../lib/format.js'
import {
  LIST_BUILDER_PARLAY_SIZES,
  buildListBuilderParlays,
  createSeededRandom,
  randomizeListBuilderParlays,
} from '../lib/list-builder-parlays.js'

const CARD_LABELS = ['Top probability', 'Balanced build', 'Diversified build']

function randomSeed(previous) {
  let seed = Date.now() >>> 0
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1)
    globalThis.crypto.getRandomValues(value)
    seed = value[0]
  }
  return seed === previous ? (seed + 1) >>> 0 : seed
}

function allHitLabel(value) {
  return pct(value, value < 0.01 ? 2 : 1)
}

function opponentLabel(batter) {
  return batter?.opponent?.abbr || batter?.opponent?.name || '—'
}

function ParlayCard({ combo, index, onUse }) {
  return (
    <article className={`lbv-parlay-card${index === 0 ? ' featured' : ''}`}>
      <div className="lbv-parlay-card-head">
        <span>{CARD_LABELS[index] || `Option ${index + 1}`}</span>
        <b className="mono">#{index + 1}</b>
      </div>

      <div className="lbv-parlay-legs">
        {combo.legs.map((leg) => {
          const batter = leg.batter
          const weakest = combo.weakest.rowKey === leg.rowKey
          return (
            <div className={`lbv-parlay-leg${weakest ? ' weakest' : ''}`} key={leg.rowKey}>
              <GradeChip grade={batter.grade} size="sm" />
              <span className="lbv-parlay-leg-copy">
                <strong>{batter.name}</strong>
                <small>{batter.team} vs {opponentLabel(batter)}{weakest ? ' · weakest leg' : ''}</small>
              </span>
              <b className="mono">{pct(leg.probability, 1)}</b>
            </div>
          )
        })}
      </div>

      <div className="lbv-parlay-model">
        <span>
          <small>All-hit model chance</small>
          <strong className="mono">{allHitLabel(combo.allHit)}</strong>
        </span>
        <span>
          <small>Weakest leg</small>
          <strong className="mono">{pct(combo.weakest.probability, 1)}</strong>
        </span>
      </div>
      <p className="lbv-parlay-reason"><Icon name="Gauge" size={12} /> {combo.rationale}</p>
      <p className="lbv-parlay-math">Independent product · not historical hit rate</p>
      <button type="button" className="lbv-parlay-use" onClick={() => onUse?.(combo)} disabled={!onUse}>
        <Icon name="ArrowRight" size={14} /> Use parlay
      </button>
    </article>
  )
}

export default function ListBuilderParlayEngine({ items = [], evidence, onUseParlay }) {
  const [size, setSize] = useState(2)
  const [shuffleSeed, setShuffleSeed] = useState(null)
  const engine = useMemo(() => buildListBuilderParlays(items, { size }), [items, size])
  const engineSignature = engine.curated.map((combo) => combo.signature).join('::')

  useEffect(() => {
    if (engine.supportedSizes.includes(size)) return
    setSize(engine.supportedSizes[0] || 2)
  }, [engine.supportedSizes, size])

  useEffect(() => {
    setShuffleSeed(null)
  }, [size, engineSignature])

  const cards = useMemo(() => (
    shuffleSeed == null
      ? engine.curated
      : randomizeListBuilderParlays(engine, createSeededRandom(shuffleSeed))
  ), [engine, shuffleSeed])

  const useParlay = (combo) => {
    const ids = combo.legs.map((leg) => leg.batter.id).filter((id) => id != null)
    onUseParlay?.(ids, combo)
  }

  return (
    <section className="lbv-parlay-engine" aria-labelledby="lbv-parlay-title">
      <div className="lbv-parlay-head">
        <span className="lbv-parlay-icon"><Icon name="Layers" size={18} /></span>
        <div className="lbv-parlay-title">
          <span className="lbv-eyebrow">Curated combinations</span>
          <h4 id="lbv-parlay-title">Build a parlay from this exact list</h4>
          <p>PRIME and STRONG only · one hitter per game · no unmodeled correlation boost.</p>
        </div>
        <span className="lbv-parlay-eligible mono">
          {engine.eligibleCount} eligible · {engine.uniqueGames} games
        </span>
      </div>

      <div className="lbv-parlay-controls">
        <div className="lbv-parlay-sizes" aria-label="Parlay leg count">
          {LIST_BUILDER_PARLAY_SIZES.map((option) => {
            const supported = engine.supportedSizes.includes(option)
            return (
              <button
                type="button"
                key={option}
                className={size === option ? 'on' : ''}
                disabled={!supported}
                aria-pressed={size === option}
                title={supported ? `${option}-leg parlays` : `Needs ${option} eligible hitters from separate games`}
                onClick={() => { setSize(option); setShuffleSeed(null) }}
              >{option} legs</button>
            )
          })}
        </div>
        <div className="lbv-parlay-actions">
          <button type="button" className={shuffleSeed == null ? 'on' : ''} onClick={() => setShuffleSeed(null)} disabled={!engine.curated.length}>
            <Icon name="CircleCheck" size={14} /> Best curated
          </button>
          <button
            type="button"
            className={shuffleSeed != null ? 'on' : ''}
            disabled={!engine.randomPool.length}
            title={`Rotates only among ${engine.randomPool.length} top-qualified combinations`}
            onClick={() => setShuffleSeed((current) => randomSeed(current))}
          >
            <Icon name="Dice5" size={14} /> Random curated
          </button>
        </div>
      </div>

      <div className={`lbv-parlay-evidence${evidence?.valid ? ' valid' : ' collecting'}`}>
        <Icon name={evidence?.valid ? 'Shield' : 'Info'} size={13} />
        {evidence?.valid ? (
          <span>
            <b>{evidence.label}</b> tracked HR rate <strong className="mono">{evidence.hitRate.toFixed(1)}%</strong>
            {' · '}n=<strong className="mono">{evidence.sample}</strong>
            {' · '}95% CI <strong className="mono">{evidence.confidence95.low.toFixed(1)}–{evidence.confidence95.high.toFixed(1)}%</strong>
            {' · '}individual settled picks, not parlay performance
          </span>
        ) : (
          <span><b>Historical evidence collecting.</b> No tracked recipe hit rate is claimed for this list; ticket chances still use valid player projections.</span>
        )}
      </div>

      {cards.length ? (
        <div className="lbv-parlay-cards" aria-live="polite">
          {cards.map((combo, index) => <ParlayCard key={combo.signature} combo={combo} index={index} onUse={onUseParlay ? useParlay : null} />)}
        </div>
      ) : (
        <div className="lbv-parlay-empty">
          <Icon name="ShieldAlert" size={20} />
          <div>
            <strong>Not enough qualified separate-game legs</strong>
            <p>This engine will not fill a ticket with LEAN/SKIP, live, warned, invalid-projection, benched, duplicate-player, or same-game legs.</p>
          </div>
        </div>
      )}

      {engine.constructionCount < engine.eligibleCount && (
        <p className="lbv-parlay-cap"><Icon name="Info" size={12} /> Curated combinations use the top {engine.constructionCount} of {engine.eligibleCount} eligible hitters to keep Random curated inside the strongest pool.</p>
      )}
    </section>
  )
}
