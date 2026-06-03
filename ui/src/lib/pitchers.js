// Group the slate's batters by the opposing STARTER they face, producing one
// entry per pitcher with his vulnerability and the lineup ranked as HR targets.
// Takes the already-filtered batter list, so the board's filters (game, search,
// grade, …) narrow the pool naturally.

import { pitcherVulnerability } from './vulnerability.js'

export function groupPitchers(batters) {
  const map = new Map()
  for (const b of batters || []) {
    const p = b.pitcher
    if (!p || p.id == null) continue
    // Key on pitcher + game so a doubleheader (same arm, two gamePks) stays split.
    const key = `${p.id}-${b.gamePk}`
    let entry = map.get(key)
    if (!entry) {
      entry = {
        key,
        id: p.id,
        pitcher: p,
        gamePk: b.gamePk,
        game: b.game || null,
        // The pitcher plays for the team opposing the batters facing him.
        team: b.opponent || null,
        targets: [],
      }
      map.set(key, entry)
    }
    entry.targets.push(b)
  }

  const list = [...map.values()].map((e) => {
    e.vuln = pitcherVulnerability(e.pitcher)
    e.targets.sort(
      (a, b) =>
        (b.hrProbability ?? 0) - (a.hrProbability ?? 0) ||
        (b.score ?? 0) - (a.score ?? 0) ||
        (a.battingOrder ?? 99) - (b.battingOrder ?? 99),
    )
    e.topProb = e.targets[0]?.hrProbability ?? 0
    return e
  })

  // Most vulnerable first; tie-break by the single best target's HR probability.
  list.sort((a, b) => (b.vuln?.score ?? 0) - (a.vuln?.score ?? 0) || b.topProb - a.topProb)
  return list
}

// Pitch-type code → display label. Covers the Statcast families the slate emits.
export const PITCH_LABELS = {
  ff: '4-Seam',
  si: 'Sinker',
  fc: 'Cutter',
  sl: 'Slider',
  st: 'Sweeper',
  cu: 'Curve',
  kc: 'Knuckle-Curve',
  sv: 'Slurve',
  ch: 'Change',
  fs: 'Splitter',
  fo: 'Forkball',
}

// Build a sorted, display-ready pitch-usage list from pitcher.pitchMix. Handles
// both 0–1 fractions and 0–100 percentages by normalizing the whole set.
export function pitchUsage(pitchMix) {
  if (!pitchMix) return []
  const raw = Object.keys(PITCH_LABELS)
    .map((code) => ({ code, label: PITCH_LABELS[code], pct: Number(pitchMix[`${code}Pct`]) }))
    .filter((x) => Number.isFinite(x.pct) && x.pct > 0)
  const sum = raw.reduce((s, x) => s + x.pct, 0)
  const toPct = sum > 0 && sum <= 1.5 ? (x) => x * 100 : (x) => x // fractions → %
  return raw.map((x) => ({ ...x, pct: toPct(x.pct) })).sort((a, b) => b.pct - a.pct)
}
