const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value))
const round = (value, digits = 3) => {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function number(value) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function innings(value) {
  const parsed = number(value)
  if (!Number.isFinite(parsed)) return 0
  const whole = Math.floor(parsed)
  const decimal = Number((parsed - whole).toFixed(1))
  if (decimal === 0.1) return whole + 1 / 3
  if (decimal === 0.2) return whole + 2 / 3
  return parsed
}

function shrink(value, sample, prior, priorSample) {
  if (!Number.isFinite(value) || !(sample > 0)) return prior
  return (value * sample + prior * priorSample) / (sample + priorSample)
}

export function buildBullpenRunProfile(stat = {}) {
  const ip = innings(stat.inningsPitched)
  if (ip < 30) return null
  const era = number(stat.era)
  const runsPer9 = number(stat.runsScoredPer9)
  const whip = number(stat.whip)
  const hr = number(stat.homeRuns) || 0
  const strikeouts = number(stat.strikeOuts) || 0
  const walks = number(stat.baseOnBalls) || 0
  const hitBatters = number(stat.hitByPitch ?? stat.hitBatsmen) || 0
  const hr9 = ip > 0 ? hr * 9 / ip : null
  const k9 = ip > 0 ? strikeouts * 9 / ip : null
  const bb9 = ip > 0 ? walks * 9 / ip : null
  const fip = ip > 0
    ? (13 * hr + 3 * (walks + hitBatters) - 2 * strikeouts) / ip + 3.15
    : null
  const eraAdjusted = shrink(era, ip, 4.25, 60)
  const runsAdjusted = shrink(runsPer9, ip, 4.35, 60)
  const fipAdjusted = shrink(fip, ip, 4.20, 60)
  const whipRuns = Number.isFinite(whip)
    ? 4.25 * clamp(whip / 1.30, 0.75, 1.35)
    : 4.25
  const estimatedRunsAllowed9 = (
    0.35 * eraAdjusted
    + 0.25 * runsAdjusted
    + 0.25 * fipAdjusted
    + 0.15 * whipRuns
  )

  return {
    ip: round(ip, 1),
    era: Number.isFinite(era) ? round(era, 2) : null,
    runsPer9: Number.isFinite(runsPer9) ? round(runsPer9, 2) : null,
    whip: Number.isFinite(whip) ? round(whip, 3) : null,
    fip: Number.isFinite(fip) ? round(fip, 2) : null,
    hr9: Number.isFinite(hr9) ? round(hr9, 3) : null,
    k9: Number.isFinite(k9) ? round(k9, 2) : null,
    bb9: Number.isFinite(bb9) ? round(bb9, 2) : null,
    inheritedRunners: Number(stat.inheritedRunners) || 0,
    inheritedRunnersScored: Number(stat.inheritedRunnersScored) || 0,
    estimatedRunsAllowed9: round(estimatedRunsAllowed9, 3),
    qualityFactor: round(clamp(estimatedRunsAllowed9 / 4.25, 0.78, 1.28), 4),
    coverage: round(clamp(ip / 150, 0, 1), 4),
  }
}

function daysBefore(targetDate, appearanceDate) {
  const target = Date.parse(`${targetDate}T12:00:00.000Z`)
  const appearance = Date.parse(`${appearanceDate}T12:00:00.000Z`)
  if (!Number.isFinite(target) || !Number.isFinite(appearance)) return null
  return Math.round((target - appearance) / 86_400_000)
}

export function buildBullpenAvailability(roster = [], {
  targetDate,
  excludedPitcherIds = [],
} = {}) {
  const excluded = new Set(excludedPitcherIds.map(Number))
  const relievers = []
  for (const entry of roster || []) {
    const id = Number(entry?.person?.id)
    if (!Number.isFinite(id) || excluded.has(id) || entry?.position?.type !== 'Pitcher') continue
    const logs = (entry.person?.stats || []).flatMap((group) => group?.splits || [])
    const appearances = logs.filter((row) => innings(row?.stat?.inningsPitched) > 0)
    const starts = appearances.reduce((sum, row) => sum + (Number(row?.stat?.gamesStarted) || 0), 0)
    if (appearances.length < 3 || starts / appearances.length > 0.35) continue

    const leverageEvents = appearances.reduce((sum, row) => (
      sum + (Number(row?.stat?.saves) || 0) + (Number(row?.stat?.holds) || 0)
    ), 0)
    const roleWeight = 1 + Math.min(1, leverageEvents / 8)
    let pitchesLast1 = 0
    let pitchesLast2 = 0
    let pitchesLast3 = 0
    const appearanceDays = new Set()
    for (const row of appearances) {
      const days = daysBefore(targetDate, row?.date)
      if (!Number.isInteger(days) || days < 1 || days > 3) continue
      const pitches = Number(row?.stat?.numberOfPitches) || 0
      appearanceDays.add(days)
      pitchesLast3 += pitches
      if (days <= 2) pitchesLast2 += pitches
      if (days === 1) pitchesLast1 += pitches
    }
    const unavailable = (
      pitchesLast1 >= 25
      || pitchesLast2 >= 40
      || (appearanceDays.has(1) && appearanceDays.has(2))
    )
    const taxed = unavailable || pitchesLast1 >= 15 || pitchesLast3 >= 45
    relievers.push({
      id,
      name: entry.person?.fullName || '',
      roleWeight,
      pitchesLast1,
      pitchesLast3,
      unavailable,
      taxed,
    })
  }

  const totalWeight = relievers.reduce((sum, row) => sum + row.roleWeight, 0)
  const unavailableWeight = relievers
    .filter((row) => row.unavailable)
    .reduce((sum, row) => sum + row.roleWeight, 0)
  const taxedOnlyWeight = relievers
    .filter((row) => row.taxed && !row.unavailable)
    .reduce((sum, row) => sum + row.roleWeight, 0)
  const unavailableShare = totalWeight ? unavailableWeight / totalWeight : 0
  const taxedShare = totalWeight ? taxedOnlyWeight / totalWeight : 0
  const coverage = clamp(relievers.length / 7, 0, 1)
  const factor = clamp(
    1 + coverage * (0.06 * unavailableShare + 0.025 * taxedShare),
    1,
    1.07,
  )

  return {
    targetDate,
    relievers: relievers.length,
    unavailable: relievers.filter((row) => row.unavailable).length,
    taxed: relievers.filter((row) => row.taxed).length,
    unavailableShare: round(unavailableShare, 4),
    taxedShare: round(taxedShare, 4),
    factor: round(factor, 4),
    coverage: round(coverage, 4),
    unavailableNames: relievers
      .filter((row) => row.unavailable)
      .sort((a, b) => b.roleWeight - a.roleWeight || b.pitchesLast3 - a.pitchesLast3)
      .slice(0, 3)
      .map((row) => row.name),
  }
}
