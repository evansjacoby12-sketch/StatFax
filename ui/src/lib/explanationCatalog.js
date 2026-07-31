// Canonical user-facing vocabulary for MLB decisions. Keep scope explicit:
// grades rank HR candidates, calls describe a market, and slate conditions
// describe the day. Components should import these definitions instead of
// maintaining their own copies.

export const GRADE_DEFINITIONS = [
  {
    key: 'PRIME',
    threshold: '72+ and clears the slate cap',
    short: 'Top HR research tier',
    description: 'The strongest overall HR evidence on this slate. PRIME is a ranking tier, not a prediction or lock.',
  },
  {
    key: 'STRONG',
    threshold: '52+ or PRIME-cap overflow',
    short: 'Model-approved HR candidate',
    description: 'A solid HR case with enough supporting evidence to research further. It can also contain high scores held below the daily PRIME cap.',
  },
  {
    key: 'LEAN',
    threshold: '36–51',
    short: 'Mixed HR case',
    description: 'Some positive evidence, but not enough agreement for the engine’s preferred HR pool.',
  },
  {
    key: 'SKIP',
    threshold: 'Below 36',
    short: 'Weak HR case',
    description: 'The current inputs do not support an HR play. SKIP is not a claim that the hitter cannot homer.',
  },
]

export const GRADE_BY_KEY = Object.fromEntries(GRADE_DEFINITIONS.map((item) => [item.key, item]))

export function gradeExplanation(label) {
  return GRADE_BY_KEY[String(label || 'SKIP').toUpperCase()] || GRADE_BY_KEY.SKIP
}

export const GAME_CALLS = [
  {
    tier: 'PLAY',
    icon: 'CircleCheck',
    tone: 'actionable',
    short: 'Actionable model edge',
    description: 'The moneyline or total clears the model’s probability, separation, coverage and price gates.',
  },
  {
    tier: 'LEAN',
    icon: 'TrendingUp',
    tone: 'lean',
    short: 'Direction with a smaller edge',
    description: 'The model favors this side, but at least one PLAY requirement is still short.',
  },
  {
    tier: 'PASS',
    icon: 'Minus',
    tone: 'diagnostic',
    short: 'No recommended wager',
    description: 'The forecast has a direction, but the market setup does not clear the action gates.',
  },
]

export const FIRST_INNING_CALLS = [
  {
    tier: 'STRONG',
    icon: 'Shield',
    tone: 'actionable',
    short: 'Fully qualified first-inning setup',
    description: 'The NRFI or YRFI side clears the probability, matchup, sample and separation gates.',
  },
  {
    tier: 'LEAN',
    icon: 'TrendingUp',
    tone: 'lean',
    short: 'Qualified direction',
    description: 'The NRFI or YRFI side has support, but the separation or evidence is below STRONG.',
  },
  {
    tier: 'WATCH',
    icon: 'Eye',
    tone: 'diagnostic',
    short: 'Track, do not force',
    description: 'The matchup is informative, but it is not actionable under the current first-inning gates.',
  },
]

export const SLATE_CONDITIONS = [
  { tier: 'FAVORABLE', description: 'The slate has strong pitching, environment and qualified-power support.' },
  { tier: 'MIXED', description: 'The slate has usable spots, but the supporting conditions are uneven.' },
  { tier: 'QUIET', description: 'The engine is reducing exposure because the slate-level support is weak.' },
]

export function slateConditionForStars(stars) {
  if (stars >= 4) return 'FAVORABLE'
  if (stars === 3) return 'MIXED'
  return 'QUIET'
}

export const LABEL_SCOPES = [
  ['HR grade', 'PRIME · STRONG · LEAN · SKIP', 'Ranks a hitter’s home-run case. It does not include sportsbook price.'],
  ['Game-market call', 'PLAY · LEAN · PASS', 'Rates the actionability of a moneyline or over/under at the shown market.'],
  ['First-inning call', 'STRONG · LEAN · WATCH', 'Rates NRFI/YRFI evidence for inning one only.'],
  ['Slate condition', 'FAVORABLE · MIXED · QUIET', 'Describes the day’s overall HR environment, not an individual bet.'],
]

export const DATA_STATES = [
  ['Projection', 'An estimate from the current model inputs—not a predicted outcome.'],
  ['Projected lineup', 'The hitter is expected to start, but the official batting order is not posted.'],
  ['Action ready', 'The posted lineup confirms the hitter and batting spot. This verifies availability; it does not improve the projection.'],
  ['Advisory', 'Visible research context that has not earned permission to change the production projection.'],
  ['Validated', 'A rule or model component that cleared its required historical or forward-testing gate.'],
]

export const WORKSPACE_DEFINITIONS = [
  ['Board', 'Scan the ranked HR slate and open a player for the full case versus caution.'],
  ['Games', 'Review moneyline and total forecasts by matchup, then expand only the games you need.'],
  ['Pitchers', 'Find vulnerable arms and inspect pitch mix, contact and location evidence.'],
  ['Weather', 'See which park, roof and air conditions materially change the run or HR environment.'],
  ['Find Plays', 'Translate a research idea into filters and build a qualified hitter list.'],
  ['Bet Lab', 'Explore curated HR combinations and the NRFI/YRFI first-inning model.'],
  ['Results', 'Audit settled model calls and your saved tickets for the latest seven-day window.'],
]

export const STAT_TERMS = [
  ['HR probability', 'The calibrated estimate that a hitter records at least one home run in this game. It is not a predicted outcome.'],
  ['Model score', 'A 0–100 evidence score used to rank the HR board. It is not the same as HR probability and is not sportsbook value.'],
  ['xHR', 'Expected home runs for this game: the sum of the hitter’s plate-appearance HR probabilities.'],
  ['Rating', 'A compact 0–10 view of an underlying model score or matchup component.'],
  ['All-hit', 'The estimated chance every parlay leg homers. Leg probabilities multiply, so this drops quickly as legs are added.'],
  ['SGP probability', 'The independent product of the calibrated leg rates. No same-game correlation uplift is applied.'],
  ['Edge', 'The difference between the model probability and the market’s no-vig probability. Positive edge alone does not guarantee a PLAY.'],
  ['Brier score', 'Probability error: lower is better. Use it with ranking lift, AUC and top-tier hit rate—not by itself.'],
  ['Barrel%', 'The share of batted balls with the exit velocity and launch angle combination most associated with extra-base damage.'],
  ['xSLG / xISO', 'Expected slugging and isolated power derived from contact quality rather than results alone.'],
]
