export const GRADE_FORM_WINDOWS = [7, 14, 30]
export const GRADE_FORM_MIN_SAMPLE = 80

const GRADES = ['PRIME', 'STRONG']

function clamp(value, low = 0, high = 1) {
  return Math.min(high, Math.max(low, value))
}

function wilsonInterval(hits, total) {
  if (!total) return { low: null, high: null }
  const z = 1.96
  const z2 = z * z
  const rate = hits / total
  const denominator = 1 + z2 / total
  const center = (rate + z2 / (2 * total)) / denominator
  const spread = (z * Math.sqrt((rate * (1 - rate) + z2 / (4 * total)) / total)) / denominator
  return { low: clamp(center - spread), high: clamp(center + spread) }
}

// Abramowitz-Stegun approximation, accurate enough for the two-proportion
// monitoring check used here without adding a statistics dependency.
function erf(value) {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value)
  const t = 1 / (1 + 0.3275911 * x)
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
  return sign * (1 - polynomial * Math.exp(-x * x))
}

function normalCdf(value) {
  return 0.5 * (1 + erf(value / Math.SQRT2))
}

function twoProportionPValue(first, second) {
  if (!first.n || !second.n) return null
  const pooled = (first.hits + second.hits) / (first.n + second.n)
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / first.n + 1 / second.n))
  if (!standardError) return first.rate === second.rate ? 1 : 0
  const z = Math.abs(first.rate - second.rate) / standardError
  return clamp(2 * (1 - normalCdf(z)))
}

function summarizeGrade(rows, grade) {
  const eligible = rows.filter((row) => row.grade === grade)
  const hits = eligible.filter((row) => row.homered).length
  const n = eligible.length
  const interval = wilsonInterval(hits, n)
  return {
    grade,
    hits,
    n,
    rate: n ? hits / n : null,
    ciLow: interval.low,
    ciHigh: interval.high,
  }
}

function buildVerdict(prime, strong, pValue) {
  const sampleReady = prime.n >= GRADE_FORM_MIN_SAMPLE && strong.n >= GRADE_FORM_MIN_SAMPLE
  if (!sampleReady) {
    return {
      key: 'low-sample',
      label: 'Low sample',
      tone: 'neutral',
      detail: `At least one grade is below ${GRADE_FORM_MIN_SAMPLE} eligible picks. Treat the current ordering as noise.`,
    }
  }

  const gap = (prime.rate ?? 0) - (strong.rate ?? 0)
  const clear = pValue != null && pValue < 0.05
  if (Math.abs(gap) < 0.0005) {
    return {
      key: 'even',
      label: 'Even',
      tone: 'neutral',
      detail: 'The grades are effectively tied in this window. Keep monitoring; do not retune from a tie.',
    }
  }
  if (gap > 0) {
    return {
      key: 'order-holds',
      label: 'Order holds',
      tone: clear ? 'positive' : 'neutral',
      detail: clear
        ? 'PRIME leads STRONG with statistically clear separation in this window.'
        : 'PRIME leads STRONG, but the gap is not statistically clear yet.',
    }
  }
  if (clear) {
    return {
      key: 'drift-signal',
      label: 'Drift signal',
      tone: 'warning',
      detail: 'STRONG leads PRIME with statistically clear separation. Review the grade inputs before changing thresholds.',
    }
  }
  return {
    key: 'watch-only',
    label: 'Watch only',
    tone: 'neutral',
    detail: 'STRONG leads in this window, but the reversal is not statistically clear. Keep thresholds unchanged.',
  }
}

export function summarizeGradeForm(records = {}, requestedWindow = 14) {
  const window = GRADE_FORM_WINDOWS.includes(Number(requestedWindow)) ? Number(requestedWindow) : 14
  const settledDates = Object.keys(records)
    .filter((date) => (records[date] || []).some((row) => row.actuallyPlayed === true && typeof row.homered === 'boolean'))
    .sort()
    .reverse()
    .slice(0, window)

  const rows = settledDates.flatMap((date) => (records[date] || [])
    .filter((row) => row.actuallyPlayed === true && typeof row.homered === 'boolean' && GRADES.includes(row.grade))
    .map((row) => ({ ...row, date })))

  const prime = summarizeGrade(rows, 'PRIME')
  const strong = summarizeGrade(rows, 'STRONG')
  const pValue = twoProportionPValue(prime, strong)
  const signedGap = prime.rate != null && strong.rate != null ? prime.rate - strong.rate : null

  return {
    window,
    settledDates,
    dateCount: settledDates.length,
    newestDate: settledDates[0] || null,
    oldestDate: settledDates.at(-1) || null,
    grades: { PRIME: prime, STRONG: strong },
    signedGap,
    gapPoints: signedGap == null ? null : Math.abs(signedGap * 100),
    leader: signedGap == null || Math.abs(signedGap) < 0.0005 ? 'EVEN' : signedGap > 0 ? 'PRIME' : 'STRONG',
    pValue,
    sampleReady: prime.n >= GRADE_FORM_MIN_SAMPLE && strong.n >= GRADE_FORM_MIN_SAMPLE,
    verdict: buildVerdict(prime, strong, pValue),
  }
}
