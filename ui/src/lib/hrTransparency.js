const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value))

export function probabilityBandForScore(score, scoreToProb) {
  if (!finite(score)) return null
  const table = Array.isArray(scoreToProb) ? scoreToProb : scoreToProb?.table
  if (!Array.isArray(table) || !table.length) return null

  const value = Number(score)
  const lastIndex = table.length - 1
  const band = table.find((row, index) => {
    if (!finite(row?.scoreLo) || !finite(row?.scoreHi)) return false
    return value >= Number(row.scoreLo) && (value < Number(row.scoreHi) || (index === lastIndex && value <= Number(row.scoreHi)))
  })
  if (!band) return null

  return {
    scoreLo: Number(band.scoreLo),
    scoreHi: Number(band.scoreHi),
    observedProb: finite(band.observedProb) ? Number(band.observedProb) : null,
    n: finite(band.n) ? Number(band.n) : 0,
    label: `${Number(band.scoreLo)}–${Number(band.scoreHi)}`,
  }
}

export function calibrationBandVerdict(bin, tolerance = 0.02) {
  if (!finite(bin?.avgPredicted) || !finite(bin?.observedRate)) {
    return { key: 'unknown', label: 'Building', delta: null }
  }
  const delta = Number(bin.observedRate) - Number(bin.avgPredicted)
  if (Math.abs(delta) <= tolerance) return { key: 'aligned', label: 'On target', delta }
  return delta > 0
    ? { key: 'low', label: 'Model low', delta }
    : { key: 'high', label: 'Model high', delta }
}

function eligibleRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) =>
    row && typeof row.homered === 'boolean' && row.actuallyPlayed !== false && finite(row.score))
}

function rankRows(rows) {
  return eligibleRows(rows).slice().sort((a, b) =>
    Number(b.score) - Number(a.score)
    || Number(b.simHRProb || 0) - Number(a.simHRProb || 0)
    || Number(a.playerId || 0) - Number(b.playerId || 0))
}

export function summarizeRankPerformance(records, lookbackDays = 7, limits = [3, 10]) {
  const dates = Object.keys(records || {})
    .filter((date) => eligibleRows(records[date]).length > 0)
    .sort()
    .reverse()
    .slice(0, Math.max(1, Number(lookbackDays) || 7))
    .reverse()
  const rankLimits = [...new Set((limits || []).map(Number).filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => a - b)

  const daily = dates.map((date) => {
    const ranked = rankRows(records[date])
    const selections = Object.fromEntries(rankLimits.map((limit) => {
      const selected = ranked.slice(0, limit)
      const hits = selected.filter((row) => row.homered).length
      return [limit, {
        limit,
        n: selected.length,
        hits,
        hitRate: selected.length ? hits / selected.length : null,
        cashed: hits > 0,
      }]
    }))
    return {
      date,
      slateN: ranked.length,
      slateHits: ranked.filter((row) => row.homered).length,
      selections,
    }
  })

  const slateN = daily.reduce((sum, day) => sum + day.slateN, 0)
  const slateHits = daily.reduce((sum, day) => sum + day.slateHits, 0)
  const slateRate = slateN ? slateHits / slateN : null
  const summaries = Object.fromEntries(rankLimits.map((limit) => {
    const n = daily.reduce((sum, day) => sum + day.selections[limit].n, 0)
    const hits = daily.reduce((sum, day) => sum + day.selections[limit].hits, 0)
    const cashDays = daily.filter((day) => day.selections[limit].cashed).length
    const hitRate = n ? hits / n : null
    return [limit, {
      limit,
      n,
      hits,
      hitRate,
      days: daily.length,
      cashDays,
      cashRate: daily.length ? cashDays / daily.length : null,
      lift: hitRate != null && slateRate ? hitRate / slateRate : null,
    }]
  }))

  return {
    dateCount: daily.length,
    oldestDate: dates[0] || null,
    newestDate: dates[dates.length - 1] || null,
    slateN,
    slateHits,
    slateRate,
    daily,
    summaries,
  }
}
