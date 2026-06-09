// Scout report — reframe the engine's outputs as classic 20–80 scouting tool
// grades, plus a "Heat Index" (how locked-in the bat is RIGHT NOW) and a
// one-line verdict. All derived from data already on the scored batter.

import { clamp, rate } from './format.js'

// 0–100 → 20–80 scouting scale, rounded to the usual 5-point increments.
export function toGrade(x100) {
  return Math.round((20 + (clamp(x100 ?? 0, 0, 100) / 100) * 60) / 5) * 5
}

export function gradeLabel(g) {
  if (g >= 75) return 'elite'
  if (g >= 65) return 'plus-plus'
  if (g >= 58) return 'plus'
  if (g >= 45) return 'average'
  if (g >= 38) return 'below avg'
  return 'well below'
}

const HEAT_BASE = 45
const iso = (s) => (s ? Math.max(0, (s.slg ?? 0) - (s.avg ?? 0)) : null)

/**
 * Heat Index breakdown: the baseline + each recency factor that moved it, with
 * the supporting numbers — so the UI can show WHY a bat reads hot or cold.
 * Returns { total (0–100), base, parts: [{ label, detail, delta }] }.
 */
export function heatBreakdown(b) {
  const parts = []
  const sIso = iso(b.season)
  const rIso = iso(b.recent)
  if (sIso != null && rIso != null && (b.recent?.ab ?? 0) >= 12) {
    const delta = Math.round(clamp((rIso - sIso) * 250, -25, 30))
    const hr = b.recent?.hr != null && b.recent?.ab != null ? ` · ${b.recent.hr} HR / ${b.recent.ab} AB` : ''
    parts.push({ label: 'Recent power', detail: `L30 ISO ${rate(rIso)} vs season ${rate(sIso)}${hr}`, delta })
  }
  const seasonBarrel = Number.isFinite(b.barrelPctBBE) ? b.barrelPctBBE : b.barrelPct
  if (Number.isFinite(b.recentBarrel?.recentBarrelPct) && Number.isFinite(seasonBarrel) && (b.recentBarrel?.recentBBE ?? 0) >= 6) {
    const delta = Math.round(clamp((b.recentBarrel.recentBarrelPct - seasonBarrel) * 1.5, -15, 22))
    parts.push({
      label: 'Recent contact',
      detail: `L14d barrel ${b.recentBarrel.recentBarrelPct.toFixed(0)}% vs ${seasonBarrel.toFixed(0)}% (${b.recentBarrel.recentBBE} BBE)`,
      delta,
    })
  }
  if (b.recent7 && (b.recent7.ab ?? 0) >= 8) {
    parts.push({ label: 'Last 7 games', detail: `${rate(b.recent7.avg)} avg · ${rate(b.recent7.slg)} slg`, delta: 0 })
  }
  if (b.hot) parts.push({ label: 'Hot streak', detail: 'Flagged hot by the engine', delta: 13 })
  if (b.cold) parts.push({ label: 'Cold slump', detail: 'Flagged cold by the engine', delta: -20 })
  if (b.hrStreak) parts.push({ label: 'HR streak', detail: 'Gone deep recently', delta: 10 })
  // No "Due" term — the overdue/drought signal is the gambler's fallacy (due bats
  // homer LESS, proven on 11d/2.6k bats); removed from the model, so the heat
  // index must not credit it either.
  const total = Math.round(clamp(HEAT_BASE + parts.reduce((s, p) => s + p.delta, 0), 0, 100))
  return { total, base: HEAT_BASE, parts }
}

/**
 * Heat Index (0–100): current form. 50 ≈ neutral. See heatBreakdown for the why.
 */
export function heatIndex(b) {
  return heatBreakdown(b).total
}

// The 6-box HR setup checklist — the signals that actually predict homers
// (form + matchup + park). Shared by the drawer's Heat Index section and the
// board's Pick of the Day so they never drift. Deliberately NO "due/drought"
// box: that's the gambler's fallacy we falsified and removed from the model.
export function hrSetup(b) {
  const rb = b.recentBarrel
  const seasonBarrel = Number.isFinite(b.barrelPctBBE) ? b.barrelPctBBE : b.barrelPct
  // Grade the model's BLENDED pitcher exposure (starter HR/9 weighted by how
  // long he's expected to last for this lineup spot + the opposing pen), not
  // the listed starter's raw line — on opener days the opener may face this
  // bat once while the bulk arm takes the rest, and the raw line lies.
  const starterHr9 = b.pitcher?.season?.hrPer9
  const hr9 = Number.isFinite(b.effectiveHR9) ? b.effectiveHR9 : starterHr9
  const blended = Number.isFinite(b.effectiveHR9) && Number.isFinite(starterHr9) && Math.abs(b.effectiveHR9 - starterHr9) >= 0.05
  const park = b.gameParkHRFactor
  const la = b.launchAngle
  const checks = [
    {
      key: 'barrel',
      label: 'Barreling lately',
      pass: rb?.recentBarrelPct >= 10 && (rb?.recentBBE ?? 0) >= 5,
      detail: Number.isFinite(rb?.recentBarrelPct) ? `${rb.recentBarrelPct.toFixed(1)}% barrels · last ~14d` : 'no recent sample',
    },
    {
      key: 'elite',
      label: 'Elite barrel rate',
      pass: Number.isFinite(seasonBarrel) && seasonBarrel >= 9,
      detail: Number.isFinite(seasonBarrel) ? `${seasonBarrel.toFixed(1)}% season · MLB median ~7%` : 'no data',
    },
    {
      key: 'hot',
      label: 'Hot bat',
      pass: b.hot === true,
      detail: b.hot ? 'recent ISO above season — power surge' : 'not on a heater',
    },
    {
      key: 'la',
      label: 'Launch angle in HR window',
      pass: Number.isFinite(la) && la >= 8 && la <= 32,
      detail: Number.isFinite(la) ? `${la.toFixed(1)}° average` : 'no LA data',
    },
    {
      key: 'pitcher',
      label: 'HR-friendly pitcher',
      pass: Number.isFinite(hr9) && hr9 >= 1.3,
      detail: Number.isFinite(hr9)
        ? blended
          ? `exposure HR/9 ${hr9.toFixed(2)} (starter ${starterHr9.toFixed(2)} + pen) · MLB ~1.30`
          : `opp HR/9 ${hr9.toFixed(2)} · MLB ~1.30`
        : 'no pitcher data',
    },
    {
      key: 'park',
      label: 'HR park',
      pass: Number.isFinite(park) && park >= 1.05,
      detail: Number.isFinite(park) ? `${park >= 1 ? '+' : ''}${Math.round((park - 1) * 100)}% HRs today` : 'no park data',
    },
  ]
  return { checks, n: checks.filter((c) => c.pass).length }
}

export function toolGrades(b) {
  return {
    power: toGrade(b.batterScore),
    heat: toGrade(heatIndex(b)),
    matchup: toGrade(b.matchupScore),
    environment: toGrade(b.envScore),
  }
}

const TOOL_NAMES = { power: 'Power', heat: 'Heat', matchup: 'Matchup', environment: 'Park/Air' }

export function scoutVerdict(b) {
  const g = toolGrades(b)
  const strong = Object.keys(g).filter((k) => g[k] >= 60).map((k) => TOOL_NAMES[k])
  const weak = Object.keys(g).filter((k) => g[k] <= 40).map((k) => TOOL_NAMES[k])
  const label = b.grade?.label
  let take =
    label === 'PRIME' ? 'Strong HR play.' :
    label === 'STRONG' ? 'Solid HR lean.' :
    label === 'LEAN' ? 'Marginal — situational.' :
    'Low HR upside.'
  if (strong.length) take += ` Carried by ${joinList(strong)}.`
  if (weak.length) take += ` Held back by ${joinList(weak)}.`
  return take
}

function joinList(a) {
  if (a.length <= 1) return a[0] || ''
  return a.slice(0, -1).join(', ') + ' & ' + a[a.length - 1]
}
