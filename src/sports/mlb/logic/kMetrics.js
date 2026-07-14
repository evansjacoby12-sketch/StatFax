import { K_LINES, kOverProb } from './kBrain.js'

export function flattenKResults(kProps, { fromDate = null } = {}) {
  return Object.entries(kProps?.resultsByDate || {})
    .flatMap(([date, rows]) => (rows || []).map((row) => ({ ...row, date })))
    .filter((row) => (
      (!fromDate || row.date >= fromDate)
      && Number.isFinite(row.estK)
      && Number.isFinite(row.actualK)
    ))
}

export function summarizeKRows(rows, { scale = 1 } = {}) {
  const usable = (rows || []).filter((row) => Number.isFinite(row.estK) && Number.isFinite(row.actualK))
  if (!usable.length) return { n: 0, scale }

  let predicted = 0
  let actual = 0
  let absoluteError = 0
  let squaredError = 0
  let brier = 0
  let probabilityBias = 0
  let probabilityN = 0
  const byLine = Object.fromEntries(K_LINES.map((line) => [line, { predicted: 0, actual: 0, n: 0 }]))

  for (const row of usable) {
    const estimate = row.estK * scale
    const error = estimate - row.actualK
    predicted += estimate
    actual += row.actualK
    absoluteError += Math.abs(error)
    squaredError += error ** 2

    for (const line of K_LINES) {
      const probability = kOverProb(estimate, line)
      const outcome = row.actualK > line ? 1 : 0
      if (!Number.isFinite(probability)) continue
      brier += (probability - outcome) ** 2
      probabilityBias += probability - outcome
      probabilityN++
      byLine[line].predicted += probability
      byLine[line].actual += outcome
      byLine[line].n++
    }
  }

  const ipRows = usable.filter((row) => Number.isFinite(row.expIP) && Number.isFinite(row.actualIP))
  const bfRows = usable.filter((row) => Number.isFinite(row.expBF) && Number.isFinite(row.actualBF))
  const summarizeVolumeBias = (values, predictedKey, actualKey) => values.length
    ? values.reduce((sum, row) => sum + row[predictedKey] - row[actualKey], 0) / values.length
    : null

  for (const line of K_LINES) {
    const values = byLine[line]
    values.predicted = values.n ? values.predicted / values.n : null
    values.actual = values.n ? values.actual / values.n : null
  }

  return {
    n: usable.length,
    scale,
    predictedMean: predicted / usable.length,
    actualMean: actual / usable.length,
    bias: (predicted - actual) / usable.length,
    mae: absoluteError / usable.length,
    rmse: Math.sqrt(squaredError / usable.length),
    brier: probabilityN ? brier / probabilityN : null,
    probabilityBias: probabilityN ? probabilityBias / probabilityN : null,
    ipN: ipRows.length,
    ipBias: summarizeVolumeBias(ipRows, 'expIP', 'actualIP'),
    bfN: bfRows.length,
    bfBias: summarizeVolumeBias(bfRows, 'expBF', 'actualBF'),
    byLine,
  }
}

export function findBestKScale(rows, {
  min = 0.75,
  max = 1.05,
  step = 0.005,
  objective = 'brier',
} = {}) {
  let best = null
  for (let scale = min; scale <= max + step / 2; scale += step) {
    const roundedScale = +scale.toFixed(6)
    const metrics = summarizeKRows(rows, { scale: roundedScale })
    const value = metrics[objective]
    if (!Number.isFinite(value)) continue
    if (!best || value < best.value) best = { scale: roundedScale, value, metrics }
  }
  return best
}
