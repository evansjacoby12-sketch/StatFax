import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { hexA } from './atoms.jsx'
import { pct, num, american, signedPct } from '../lib/format.js'
import { gradeColor } from '../lib/badges.js'
import { buildParlay } from '../lib/parlayMath.js'
import { buildGroups, lastFirst } from '../lib/groups.js'
import { comboStatus, legStatus, VERDICT_META, LEG_META } from '../lib/live.js'
import * as store from '../lib/storage.js'

const GRADE_COLOR = { S: '#f5a623', A: '#10b981', B: '#3b82f6', C: '#94a3b8', D: '#64748b' }
const SIZES = [2, 3, 4]

// Compact American odds, "—" when unpriced.
const od = (a) => (Number.isFinite(a) ? american(a) : '—')

// k-combinations of a small array (used to enumerate fill-in sets).
function kCombos(arr, k) {
  if (k <= 0) return [[]]
  if (k > arr.length) return []
  const res = []
  const rec = (start, combo) => {
    if (combo.length === k) { res.push(combo.slice()); return }
    for (let i = start; i < arr.length; i++) { combo.push(arr[i]); rec(i + 1, combo); combo.pop() }
  }
  rec(0, [])
  return res
}

// A small live-status pill for a leg / combo verdict.
function LiveTag({ code, text, meta, size = 'sm' }) {
  const m = meta[code]
  if (!m) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', flexShrink: 0, fontSize: size === 'lg' ? '11px' : '9px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.03em', color: m.color, background: hexA(m.color, 0.1), border: `1px solid ${hexA(m.color, 0.3)}`, borderRadius: '5px', padding: size === 'lg' ? '2px 8px' : '1px 5px' }}>
      <Icon name={m.icon} size={size === 'lg' ? 11 : 9} className={code === 'live' ? 'spin-pulse' : ''} /> {text ?? m.label}
    </span>
  )
}

// ── Live summary header ───────────────────────────────────────────────────────
function Summary({ p, live, correlate, onToggleCorr, wager, onWager }) {
  const gColor = p.grade ? GRADE_COLOR[p.grade.letter] : 'var(--text-faint)'
  const payDecimal = p.allPriced ? p.decimal : p.fairDecimal
  const wagerNum = parseFloat(wager)
  const payout = Number.isFinite(wagerNum) && wagerNum > 0 && payDecimal ? wagerNum * payDecimal : null
  const evColor = p.ev == null ? 'var(--text-faint)' : p.ev >= 0 ? 'var(--strong)' : 'var(--bad)'
  return (
    <div className="pb-summary" style={{ background: 'rgba(16,24,48,0.55)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', padding: '16px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent)' }}>{p.n}-leg parlay</span>
          {p.grade && (
            <span style={{ color: gColor, borderColor: hexA(gColor, 0.4), borderWidth: '1px', borderStyle: 'solid', borderRadius: '6px', padding: '2px 8px', fontSize: '11px', fontWeight: '800', background: hexA(gColor, 0.08) }} title={`Avg leg score ${Math.round(p.grade.avgScore)}`}>
              Grade {p.grade.letter}
            </span>
          )}
          {live?.started && (
            <LiveTag code={live.code} text={`${VERDICT_META[live.code].label} ${live.hits}/${live.n}`} meta={VERDICT_META} size="lg" />
          )}
        </span>
        {p.sameGame && (
          <button
            className="pb-corr-toggle"
            onClick={onToggleCorr}
            title="Same-game legs are correlated — toggle between the correlation-adjusted all-hit and the plain independent product."
            style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', color: correlate ? 'var(--accent)' : 'var(--text-dim)', border: `1px solid ${correlate ? 'var(--accent)' : 'var(--border)'}`, background: correlate ? hexA('#00d8f6', 0.08) : 'transparent', borderRadius: '6px', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            <Icon name="GitBranch" size={11} /> {correlate ? 'Correlated' : 'Independent'}
          </button>
        )}
      </div>

      <div className="pb-metrics" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))', gap: '10px' }}>
        <Metric k="All-hit" v={p.n ? pct(p.modelAllHit, p.modelAllHit < 0.01 ? 2 : 1) : '—'} color="var(--accent)" sub={p.sameGame && correlate ? `indep ${pct(p.independent, p.independent < 0.01 ? 2 : 1)}` : null} />
        <Metric k={p.allPriced ? 'Parlay odds' : 'Fair odds'} v={p.allPriced ? od(p.american) : od(p.fairAmerican)} color="#fff" sub={!p.allPriced && p.n ? `${p.priced}/${p.n} priced` : null} />
        <Metric k="EV / $1" v={p.ev != null ? signedPct(p.ev, 0) : '—'} color={evColor} sub={p.ev != null ? (p.ev >= 0 ? 'value' : 'overpriced') : 'need odds'} />
        <Metric k="Edge vs fair" v={p.edge != null ? signedPct(p.edge, 1) : '—'} color={p.edge == null ? 'var(--text-faint)' : p.edge >= 0 ? 'var(--strong)' : 'var(--bad)'} />
      </div>

      <div className="pb-wager" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '14px', background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '10px', padding: '8px 12px' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)' }}>Wager $</span>
          <input type="number" inputMode="decimal" min="0" step="1" value={wager} onChange={(e) => onWager(e.target.value)} aria-label="Wager" style={{ border: 'none', background: 'transparent', color: '#fff', fontSize: '16px', fontWeight: '700', outline: 'none', width: '90px' }} />
        </label>
        <Icon name="ChevronRight" size={14} style={{ color: 'var(--text-faint)' }} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end', marginLeft: 'auto' }}>
          <span style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)' }}>Payout{p.allPriced ? '' : ' (fair)'}</span>
          <span className="mono" style={{ fontSize: '16px', fontWeight: '800', color: 'var(--strong)' }}>{payout != null ? `$${payout >= 100 ? Math.round(payout) : payout.toFixed(2)}` : '—'}</span>
        </span>
      </div>
    </div>
  )
}

function Metric({ k, v, color, sub }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '10px', padding: '8px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-faint)', marginBottom: '2px' }}>{k}</div>
      <div className="mono" style={{ fontSize: '16px', fontWeight: '800', color }}>{v}</div>
      {sub && <div className="dim" style={{ fontSize: '9px', color: 'var(--text-faint)', marginTop: '1px' }}>{sub}</div>}
    </div>
  )
}

// ── A leg row in the built slip ───────────────────────────────────────────────
function LegRow({ b, perLeg, weak, onSelect, onRemove }) {
  const isWeak = weak?.id === b.id
  const edge = perLeg?.edge
  const st = legStatus(b)
  const lm = LEG_META[st.code]
  // A homered leg gets a green wash; a dead one dims.
  const bg = st.code === 'hit' ? hexA('#10b981', 0.08) : st.code === 'dead' ? 'rgba(255,255,255,0.01)' : 'rgba(255,255,255,0.015)'
  return (
    <div className={`pb-leg ${isWeak ? 'weak' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: bg, border: `1px solid ${st.code === 'hit' ? 'rgba(16,185,129,0.25)' : isWeak ? 'rgba(249,115,22,0.18)' : 'rgba(255,255,255,0.05)'}`, borderRadius: '9px', opacity: st.code === 'dead' ? 0.6 : 1 }}>
      <button onClick={() => onSelect(b)} title="Open detail" style={{ display: 'flex', alignItems: 'center', gap: '7px', flex: '1', textAlign: 'left', minWidth: 0 }}>
        <span style={{ background: st.code !== 'pending' ? lm.color : gradeColor(b.grade?.label), width: '6px', height: '6px', borderRadius: '50%', flex: 'none' }} />
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: '12.5px', fontWeight: '600', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
          <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>{b.team} {b.opponent?.abbr ? `vs ${b.opponent.abbr}` : ''}{isWeak ? ' · weak link' : ''}</span>
        </span>
      </button>
      {st.code !== 'pending' && <LiveTag code={st.code} text={st.code === 'hit' ? 'HR' : st.label} meta={LEG_META} />}
      <GradeChip grade={b.grade} size="sm" score={b.score} />
      <span className="mono" style={{ fontSize: '11px', color: 'var(--text-dim)', width: '42px', textAlign: 'right' }}>{pct(b.hrProbability, 1)}</span>
      <span className="mono" style={{ fontSize: '11px', color: '#fff', fontWeight: '600', width: '46px', textAlign: 'right' }}>{od(perLeg?.american)}</span>
      <span className="mono" title="Model edge vs the de-vigged fair line" style={{ fontSize: '10px', width: '40px', textAlign: 'right', color: edge == null ? 'var(--text-faint)' : edge >= 0 ? 'var(--strong)' : 'var(--bad)' }}>{edge == null ? '—' : signedPct(edge, 0)}</span>
      <button onClick={() => onRemove(b.id)} aria-label={`Remove ${b.name}`} style={{ color: 'var(--text-faint)', display: 'grid', placeItems: 'center' }}>
        <Icon name="X" size={14} />
      </button>
    </div>
  )
}

export default function ParlayBuilder({ batters, legs, slipSet, onToggle, onRemove, onClear, onReplace, onSelect, onClose, favorConsistency = false }) {
  const [correlate, setCorrelate] = useState(true)
  const [wager, setWager] = useState('10')
  const [tab, setTab] = useState('legs') // legs | build | saved
  const [autoSize, setAutoSize] = useState(3)
  const [saved, setSaved] = useState(() => store.load('savedSlips', []))
  const [toast, setToast] = useState(null)

  const p = useMemo(() => buildParlay(legs, { correlate }), [legs, correlate])
  const perLegById = useMemo(() => new Map(p.perLeg.map((l) => [l.id, l])), [p])
  // Live tracking — grade the slip + resolve saved slips against in-progress HRs.
  const live = useMemo(() => comboStatus(legs), [legs])
  const byId = useMemo(() => new Map((batters || []).map((b) => [b.id, b])), [batters])

  // Same-game groups with ≥2 legs (the correlated subsets) for the badge note.
  const sgGroups = useMemo(() => p.byGame.filter((g) => g.legs.length >= 2), [p])

  // Auto-suggest single legs: strongest board bats not already in the slip and
  // not in a game the slip already uses (keeps one leg per game, like the engine).
  const usedGames = useMemo(() => new Set(legs.map((b) => b.gamePk)), [legs])
  const suggestions = useMemo(() => {
    return (batters || [])
      .filter((b) => !b.game?.isFinal && !slipSet.has(b.id) && !usedGames.has(b.gamePk) && (b.grade?.label || 'SKIP') !== 'SKIP' && Number.isFinite(b.hrProbability))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.hrProbability ?? 0) - (a.hrProbability ?? 0) || String(a.id).localeCompare(String(b.id)))
      .slice(0, 8)
  }, [batters, slipSet, usedGames])

  // Auto-build: suggest the best ways to COMPLETE the current slip to `autoSize`
  // legs, ranked by the resulting parlay's EV (then all-hit). Each fill-in is the
  // best bat in a game you're not already using (one per game). Empty slip →
  // fall back to starter combos (the model's top combos for that size).
  const autoSuggest = useMemo(() => {
    const need = autoSize - legs.length
    if (legs.length === 0) {
      const out = buildGroups(batters, { favorConsistency })
      const items = (out[autoSize] || [])
        .slice()
        .sort((a, b) => (b.ev ?? -Infinity) - (a.ev ?? -Infinity) || (b.allHit ?? 0) - (a.allHit ?? 0))
        .slice(0, 5)
      return { mode: 'starter', need: autoSize, items }
    }
    if (need <= 0) return { mode: 'full', need, items: [] }
    // Candidate fill-ins: best non-final, non-SKIP bat per unused game.
    const used = new Set(legs.map((b) => b.gamePk))
    const perGame = new Map()
    for (const b of batters || []) {
      if (b.game?.isFinal || slipSet.has(b.id) || used.has(b.gamePk)) continue
      if ((b.grade?.label || 'SKIP') === 'SKIP' || !Number.isFinite(b.hrProbability)) continue
      const cur = perGame.get(b.gamePk)
      if (!cur || (b.score ?? 0) > (cur.score ?? 0)) perGame.set(b.gamePk, b)
    }
    const cands = [...perGame.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 8)
    const items = kCombos(cands, need)
      .map((fills) => ({ fills, p: buildParlay([...legs, ...fills], { correlate }) }))
      .sort((a, b) => (b.p.ev ?? -Infinity) - (a.p.ev ?? -Infinity) || (b.p.modelAllHit ?? 0) - (a.p.modelAllHit ?? 0))
      .slice(0, 6)
    return { mode: 'complete', need, items }
  }, [batters, autoSize, favorConsistency, legs, slipSet, correlate])

  const flash = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 1800)
  }

  const saveSlip = () => {
    if (!legs.length) return
    const name = legs.map((b) => b.name.split(' ').slice(-1)[0]).join(' · ')
    const entry = { id: `s${Date.now()}`, name, ids: legs.map((b) => b.id), savedAt: Date.now() }
    const next = [entry, ...saved.filter((s) => s.ids.join() !== entry.ids.join())].slice(0, 20)
    setSaved(next)
    store.save('savedSlips', next)
    flash('Saved')
  }
  const deleteSaved = (id) => {
    const next = saved.filter((s) => s.id !== id)
    setSaved(next)
    store.save('savedSlips', next)
  }
  const shareSlip = async () => {
    if (!legs.length) return
    const lines = legs.map((b) => `• ${b.name} (${b.team}) — HR ${pct(b.hrProbability, 1)} ${od(perLegById.get(b.id)?.american)}`)
    const head = `StatFax ${p.n}-leg parlay${p.grade ? ` · Grade ${p.grade.letter}` : ''}\nAll-hit ${pct(p.modelAllHit, p.modelAllHit < 0.01 ? 2 : 1)}${p.allPriced ? ` · ${od(p.american)}` : ''}${p.ev != null ? ` · EV ${signedPct(p.ev, 0)}` : ''}`
    const text = `${head}\n${lines.join('\n')}`
    try {
      if (navigator.share) await navigator.share({ title: 'StatFax parlay', text })
      else {
        await navigator.clipboard.writeText(text)
        flash('Copied to clipboard')
      }
    } catch {
      /* user dismissed share sheet */
    }
  }

  return (
    <div className="pb" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {toast && (
        <div className="pb-toast" style={{ position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)', zIndex: 10, background: 'var(--strong)', color: '#06251a', fontWeight: '800', fontSize: '12px', padding: '6px 14px', borderRadius: '999px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>{toast}</div>
      )}

      <Summary p={p} live={live} correlate={correlate} onToggleCorr={() => setCorrelate((c) => !c)} wager={wager} onWager={setWager} />

      {sgGroups.length > 0 && correlate && (
        <div className="pb-sg-note" style={{ fontSize: '11px', color: 'var(--b-plat)', background: hexA('#8b5cf6', 0.08), border: `1px solid ${hexA('#8b5cf6', 0.25)}`, borderRadius: '8px', padding: '7px 10px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Icon name="GitBranch" size={12} />
          <span>{sgGroups.length === 1 ? 'One same-game group' : `${sgGroups.length} same-game groups`} — all-hit lifted for shared HR conditions. Books discount SGP payouts, so treat the price as directional.</span>
        </div>
      )}

      <div className="pb-tabs" style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
        {[['legs', 'Legs', 'Layers'], ['build', 'Auto-build', 'Sparkles'], ['saved', `Saved${saved.length ? ` (${saved.length})` : ''}`, 'Bookmark']].map(([k, label, icon]) => (
          <button key={k} onClick={() => setTab(k)} style={{ flex: 1, fontSize: '12px', fontWeight: '700', padding: '8px', borderRadius: '8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px', color: tab === k ? '#fff' : 'var(--text-dim)', background: tab === k ? 'var(--hover)' : 'transparent', border: `1px solid ${tab === k ? 'var(--accent)' : 'var(--border)'}` }}>
            <Icon name={icon} size={13} /> {label}
          </button>
        ))}
      </div>

      <div className="pb-body" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {tab === 'legs' && (
          <>
            {legs.length > 0 ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-faint)' }}>Your legs</span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={shareSlip} style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Icon name="Share2" size={12} /> Share</button>
                    <button onClick={saveSlip} style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Icon name="Bookmark" size={12} /> Save</button>
                    <button onClick={onClear} style={{ fontSize: '11px', color: 'var(--text-faint)', fontWeight: '600' }}>Clear</button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '18px' }}>
                  {legs.map((b) => (
                    <LegRow key={b.id} b={b} perLeg={perLegById.get(b.id)} weak={p.weak} onSelect={onSelect} onRemove={onRemove} />
                  ))}
                </div>
              </>
            ) : (
              <div className="pb-empty" style={{ textAlign: 'center', color: 'var(--text-faint)', padding: '28px 16px', fontSize: '13px' }}>
                <Icon name="Layers" size={26} />
                <p style={{ marginTop: '8px' }}>No legs yet. Add suggestions below, or use <b>Auto-build</b>.</p>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-faint)' }}>Suggested adds</span>
              <span className="dim" style={{ fontSize: '10px' }}>top bats in unused games</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {suggestions.length ? suggestions.map((b) => (
                <button key={b.id} onClick={() => onToggle(b)} className="pb-sugg" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '9px', textAlign: 'left' }}>
                  <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: hexA('#00d8f6', 0.12), color: 'var(--accent)', display: 'grid', placeItems: 'center', flex: 'none' }}><Icon name="Plus" size={13} /></span>
                  <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '12.5px', fontWeight: '600', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-faint)' }}>{b.team} {b.opponent?.abbr ? `vs ${b.opponent.abbr}` : ''}</span>
                  </span>
                  <GradeChip grade={b.grade} size="sm" score={b.score} />
                  <span className="mono" style={{ fontSize: '11px', color: 'var(--text-dim)', width: '42px', textAlign: 'right' }}>{pct(b.hrProbability, 1)}</span>
                  <span className="mono" style={{ fontSize: '11px', color: '#fff', fontWeight: '600', width: '46px', textAlign: 'right' }}>{od(b.odds?.best?.american)}</span>
                </button>
              )) : <div className="dim" style={{ fontSize: '12px', padding: '12px', textAlign: 'center' }}>No more eligible bats in unused games.</div>}
            </div>
          </>
        )}

        {tab === 'build' && (
          <>
            <div className="pb-build-sizes" style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
              {SIZES.map((s) => (
                <button key={s} onClick={() => setAutoSize(s)} style={{ flex: 1, fontSize: '12px', fontWeight: '700', padding: '7px', borderRadius: '8px', color: autoSize === s ? '#fff' : 'var(--text-dim)', background: autoSize === s ? 'var(--hover)' : 'transparent', border: `1px solid ${autoSize === s ? 'var(--accent)' : 'var(--border)'}` }}>{s}-leg</button>
              ))}
            </div>
            <p className="dim" style={{ fontSize: '11px', marginBottom: '12px' }}>
              {autoSuggest.mode === 'starter'
                ? <>No legs yet — top model combos for {autoSize} legs to start from. <b>Load</b> adds them to your slip.</>
                : autoSuggest.mode === 'full'
                  ? <>Your slip already has {legs.length} legs. Pick a larger size to get fill-in suggestions.</>
                  : <>Best <b>{autoSuggest.need}</b> {autoSuggest.need === 1 ? 'leg' : 'legs'} to add to your {legs.length}-leg slip, ranked by the finished parlay's EV. <b>Add</b> drops them in.</>}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {autoSuggest.mode === 'starter' && (autoSuggest.items.length ? autoSuggest.items.map((c) => {
                const cColor = GRADE_COLOR[c.grade] || 'var(--text-faint)'
                return (
                  <div key={c.id} style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <Icon name={c.icon || 'Layers'} size={13} style={{ color: 'var(--accent)' }} />
                      <span style={{ fontSize: '12.5px', fontWeight: '700', color: '#fff' }}>{c.label}</span>
                      <span style={{ color: cColor, borderColor: hexA(cColor, 0.4), borderWidth: '1px', borderStyle: 'solid', borderRadius: '5px', padding: '0 6px', fontSize: '10px', fontWeight: '800' }}>{c.grade}</span>
                      <button onClick={() => onReplace(c.legs.map((b) => b.id))} style={{ marginLeft: 'auto', fontSize: '11px', fontWeight: '700', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: '6px', padding: '2px 11px' }}>Load</button>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                      {c.legs.map((b) => lastFirst(b.name).split(',')[0]).join(' · ')}
                    </div>
                    <div style={{ display: 'flex', gap: '14px', marginTop: '6px', fontSize: '10px' }}>
                      <span className="dim">all-hit <b className="mono" style={{ color: 'var(--accent)' }}>{pct(c.allHit, c.allHit < 0.01 ? 2 : 1)}</b></span>
                      {c.american != null && <span className="dim">odds <b className="mono" style={{ color: '#fff' }}>{od(c.american)}</b></span>}
                      {c.ev != null && <span className="dim">EV <b className="mono" style={{ color: c.ev >= 0 ? 'var(--strong)' : 'var(--bad)' }}>{signedPct(c.ev, 0)}</b></span>}
                    </div>
                  </div>
                )
              }) : <div className="dim" style={{ fontSize: '12px', padding: '16px', textAlign: 'center' }}>Not enough eligible bats to build {autoSize}-leg combos.</div>)}

              {autoSuggest.mode === 'complete' && (autoSuggest.items.length ? autoSuggest.items.map(({ fills, p }, i) => {
                const cColor = p.grade ? GRADE_COLOR[p.grade.letter] : 'var(--text-faint)'
                return (
                  <div key={i} style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <Icon name="Plus" size={13} style={{ color: 'var(--accent)' }} />
                      <span style={{ fontSize: '12.5px', fontWeight: '700', color: '#fff', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {fills.map((b) => lastFirst(b.name).split(',')[0]).join(' + ')}
                      </span>
                      {p.grade && <span style={{ color: cColor, borderColor: hexA(cColor, 0.4), borderWidth: '1px', borderStyle: 'solid', borderRadius: '5px', padding: '0 6px', fontSize: '10px', fontWeight: '800' }}>{p.grade.letter}</span>}
                      <button onClick={() => fills.forEach((b) => { if (!slipSet.has(b.id)) onToggle(b) })} style={{ fontSize: '11px', fontWeight: '700', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: '6px', padding: '2px 11px' }}>Add</button>
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-faint)', marginBottom: '6px' }}>
                      makes a {p.n}-leg with {legs.map((b) => lastFirst(b.name).split(',')[0]).join(' · ')}
                    </div>
                    <div style={{ display: 'flex', gap: '14px', fontSize: '10px' }}>
                      <span className="dim">all-hit <b className="mono" style={{ color: 'var(--accent)' }}>{pct(p.modelAllHit, p.modelAllHit < 0.01 ? 2 : 1)}</b></span>
                      {p.american != null && <span className="dim">odds <b className="mono" style={{ color: '#fff' }}>{od(p.american)}</b></span>}
                      {p.ev != null && <span className="dim">EV <b className="mono" style={{ color: p.ev >= 0 ? 'var(--strong)' : 'var(--bad)' }}>{signedPct(p.ev, 0)}</b></span>}
                    </div>
                  </div>
                )
              }) : <div className="dim" style={{ fontSize: '12px', padding: '16px', textAlign: 'center' }}>No eligible bats in unused games to complete this parlay.</div>)}

              {autoSuggest.mode === 'full' && (
                <div className="dim" style={{ fontSize: '12px', padding: '16px', textAlign: 'center' }}>Your slip already has {legs.length} legs — pick a larger size above.</div>
              )}
            </div>
          </>
        )}

        {tab === 'saved' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {saved.length ? saved.map((s) => {
              const resolved = s.ids.map((id) => byId.get(id)).filter(Boolean)
              const v = comboStatus(resolved)
              return (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 11px', background: v.code === 'cashed' ? hexA('#10b981', 0.07) : 'rgba(255,255,255,0.015)', border: `1px solid ${v.code === 'cashed' ? 'rgba(16,185,129,0.25)' : 'rgba(255,255,255,0.05)'}`, borderRadius: '9px' }}>
                  <button onClick={() => { onReplace(s.ids); setTab('legs') }} style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: '12.5px', fontWeight: '600', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                    <span className="dim" style={{ fontSize: '10px' }}>{s.ids.length} legs · saved {new Date(s.savedAt).toLocaleDateString()}</span>
                  </button>
                  {v.started && resolved.length > 0 && <LiveTag code={v.code} text={`${VERDICT_META[v.code].label} ${v.hits}/${v.n}`} meta={VERDICT_META} />}
                  <button onClick={() => { onReplace(s.ids); setTab('legs') }} style={{ fontSize: '11px', fontWeight: '700', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: '6px', padding: '2px 9px' }}>Load</button>
                  <button onClick={() => deleteSaved(s.id)} aria-label="Delete saved slip" style={{ color: 'var(--text-faint)', display: 'grid', placeItems: 'center' }}><Icon name="Trash2" size={14} /></button>
                </div>
              )
            }) : <div className="pb-empty" style={{ textAlign: 'center', color: 'var(--text-faint)', padding: '28px 16px', fontSize: '13px' }}><Icon name="Bookmark" size={24} /><p style={{ marginTop: '8px' }}>No saved slips yet. Build one and tap <b>Save</b>.</p></div>}
          </div>
        )}
      </div>
    </div>
  )
}
