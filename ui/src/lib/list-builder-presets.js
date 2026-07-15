export const LIST_BUILDER_EVIDENCE = Object.freeze({
  startDate: '2026-07-01',
  endDate: '2026-07-12',
  settledSlates: 12,
  hitterGames: 2934,
  baselineRate: 13.19,
})

const preset = (definition) => Object.freeze({
  ...definition,
  criteria: Object.freeze({ ...definition.criteria }),
  evidence: Object.freeze({ ...definition.evidence }),
})

export const LIST_BUILDER_PRESETS = Object.freeze([
  preset({
    id: 'best',
    tier: 'primary',
    icon: 'Crown',
    title: 'Best available',
    description: 'Score 70+, HR projection 12%+, confirmed lineup and clean data.',
    criteria: { minScore: 70, minHrProb: 12, confirmedOnly: true, trustedOnly: true },
    evidence: { hits: 20, sample: 71, hitRate: 28.17, lift: 2.14 },
  }),
  preset({
    id: 'hot-model',
    tier: 'primary',
    icon: 'TrendingUp',
    title: 'Hot model',
    description: 'Score 70+ with the model hot-bat signal.',
    criteria: { minScore: 70, signals: ['hot'], signalMode: 'all' },
    evidence: { hits: 130, sample: 484, hitRate: 26.86, lift: 2.04 },
  }),
  preset({
    id: 'elite-model',
    tier: 'primary',
    icon: 'Zap',
    title: 'Elite model',
    description: 'Top-end model cases with a score of 80 or higher.',
    criteria: { minScore: 80 },
    evidence: { hits: 80, sample: 313, hitRate: 25.56, lift: 1.94 },
  }),
  preset({
    id: 'hot-power',
    tier: 'primary',
    icon: 'Flame',
    title: 'Hot power',
    description: 'Hot-bat signal backed by a 10%+ season barrel rate.',
    criteria: { minBarrel: 10, signals: ['hot'], signalMode: 'all' },
    evidence: { hits: 78, sample: 314, hitRate: 24.84, lift: 1.88 },
  }),
  preset({
    id: 'three-way',
    tier: 'primary',
    icon: 'Target',
    title: 'Three-way edge',
    description: 'Score 70+, barrels 10%+ and opponent HR/9 of 1.30+.',
    criteria: { minScore: 70, minBarrel: 10, minOppHr9: 1.3 },
    evidence: { hits: 42, sample: 180, hitRate: 23.33, lift: 1.77 },
  }),
  preset({
    id: 'power',
    tier: 'primary',
    icon: 'Activity',
    title: 'Power surge',
    description: '12%+ season and recent barrels inside an 8–32° launch window.',
    criteria: { minBarrel: 12, minRecBarrel: 12, minLaunchAngle: 8, maxLaunchAngle: 32 },
    evidence: { hits: 61, sample: 279, hitRate: 21.86, lift: 1.66 },
  }),
  preset({
    id: 'model-statcast',
    tier: 'more',
    icon: 'Layers',
    title: 'Model + Statcast',
    description: 'Score 70+ supported by a 10%+ barrel rate.',
    criteria: { minScore: 70, minBarrel: 10 },
    evidence: { hits: 88, sample: 398, hitRate: 22.11, lift: 1.68 },
  }),
  preset({
    id: 'pitcher-target',
    tier: 'more',
    icon: 'Crosshair',
    title: 'Pitcher target',
    description: '10%+ barrels against an opponent HR/9 of 1.30+.',
    criteria: { minBarrel: 10, minOppHr9: 1.3 },
    evidence: { hits: 57, sample: 284, hitRate: 20.07, lift: 1.52 },
  }),
  preset({
    id: 'barrel-king',
    tier: 'more',
    icon: 'Crown',
    title: 'Barrel king',
    description: 'Players carrying the engine barrel-king signal.',
    criteria: { signals: ['barrelKing'], signalMode: 'all' },
    evidence: { hits: 74, sample: 366, hitRate: 20.22, lift: 1.53 },
  }),
  preset({
    id: 'matchup',
    tier: 'more',
    icon: 'Gauge',
    title: 'Soft matchup',
    description: 'Opponent HR/9 of 1.30+ with pitch-mix score of 6.5+.',
    criteria: { minOppHr9: 1.3, minPitchMix: 6.5 },
    evidence: { hits: 92, sample: 550, hitRate: 16.73, lift: 1.27 },
  }),
])

export const PRIMARY_LIST_BUILDER_PRESETS = Object.freeze(
  LIST_BUILDER_PRESETS.filter((item) => item.tier === 'primary'),
)

export const MORE_LIST_BUILDER_PRESETS = Object.freeze(
  LIST_BUILDER_PRESETS.filter((item) => item.tier === 'more'),
)
