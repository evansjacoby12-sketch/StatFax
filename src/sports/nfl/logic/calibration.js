const clamp = (value, min = 0.002, max = 0.98) => Math.max(min, Math.min(max, value))

export function calibrateNFLProbability(probability, calibration) {
  const value = Number(probability)
  const buckets = calibration?.buckets || []
  if (!Number.isFinite(value) || !buckets.length) return clamp(value)
  const points = buckets
    .filter((bucket) => bucket.samples >= 25 && Number.isFinite(bucket.predicted) && Number.isFinite(bucket.observed))
    .map((bucket) => ({ x: bucket.predicted, y: bucket.observed }))
    .sort((a, b) => a.x - b.x)
  if (!points.length) return clamp(value)
  if (value <= points[0].x) return clamp(points[0].y * (value / Math.max(points[0].x, .01)))
  if (value >= points.at(-1).x) return clamp(points.at(-1).y + (value - points.at(-1).x) * .35)
  const upperIndex = points.findIndex((point) => point.x >= value)
  const lower = points[upperIndex - 1]
  const upper = points[upperIndex]
  const ratio = (value - lower.x) / Math.max(.001, upper.x - lower.x)
  return clamp(lower.y + (upper.y - lower.y) * ratio)
}

export function correctedNFLProjection(value, calibration) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return numeric
  const correction = Number(calibration?.correction)
  return Math.max(0, numeric + (Number.isFinite(correction) ? correction : 0))
}

