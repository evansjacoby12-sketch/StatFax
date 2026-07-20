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
  ...(definition.readiness ? {
    readiness: Object.freeze({
      ...definition.readiness,
      features: Object.freeze([...(definition.readiness.features || [])]),
    }),
  } : {}),
})

export const LIST_BUILDER_PRESETS = Object.freeze([
  preset({
    id: 'best',
    tier: 'primary',
    icon: 'Crown',
    title: 'Best available',
    description: 'Score 70+ with a 12%+ HR projection, regardless of projected or confirmed lineup state.',
    criteria: { minScore: 70, minHrProb: 12 },
    evidence: { hits: 20, sample: 71, hitRate: 28.17, lift: 2.14 },
  }),
  preset({
    id: 'hot-model',
    tier: 'primary',
    icon: 'Flame',
    title: 'Hot model',
    description: 'Score 70+ with the model hot-bat signal.',
    criteria: { minScore: 70, signals: ['hot'], signalMode: 'all' },
    evidence: { hits: 130, sample: 484, hitRate: 26.86, lift: 2.04 },
  }),
  preset({
    id: 'elite-model',
    tier: 'primary',
    icon: 'Gauge',
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
    icon: 'Swords',
    title: 'Three-way edge',
    description: 'Score 70+, barrels 10%+ and opponent HR/9 of 1.30+.',
    criteria: { minScore: 70, minBarrel: 10, minOppHr9: 1.3 },
    evidence: { hits: 42, sample: 180, hitRate: 23.33, lift: 1.77 },
  }),
  preset({
    id: 'power',
    tier: 'primary',
    icon: 'CircleDotDashed',
    title: 'Power surge',
    description: '12%+ season and recent barrels inside an 8–32° launch window.',
    criteria: { minBarrel: 12, minRecBarrel: 12, minLaunchAngle: 8, maxLaunchAngle: 32 },
    evidence: { hits: 61, sample: 279, hitRate: 21.86, lift: 1.66 },
  }),
  preset({
    id: 'model-statcast',
    tier: 'more',
    icon: 'ChartSpline',
    title: 'Model + Statcast',
    description: 'Score 70+ supported by a 10%+ barrel rate.',
    criteria: { minScore: 70, minBarrel: 10 },
    evidence: { hits: 88, sample: 398, hitRate: 22.11, lift: 1.68 },
  }),
  preset({
    id: 'pitcher-target',
    tier: 'more',
    icon: 'Radar',
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
    icon: 'Radar',
    title: 'Soft matchup',
    description: 'Opponent HR/9 of 1.30+ with pitch-mix score of 6.5+.',
    criteria: { minOppHr9: 1.3, minPitchMix: 6.5 },
    evidence: { hits: 92, sample: 550, hitRate: 16.73, lift: 1.27 },
  }),
  preset({
    id: 'pitch-type-punish',
    tier: 'advanced',
    icon: 'ChartSpline',
    title: 'Pitch-Type Punish',
    description: 'A .200+ ISO bat whose weighted SLG clears the starter’s actual pitch mix.',
    criteria: { minISO: 0.2, minPitchMix: 6.5 },
    evidence: { hits: null, sample: null, hitRate: null, lift: null },
    readiness: {
      fallbackStatus: 'limited-coverage',
      features: ['season ISO', 'weighted pitch-type matchup'],
    },
  }),
  preset({
    id: 'recent-pitcher-leak',
    tier: 'advanced',
    icon: 'Radar',
    title: 'Recent Pitcher Leak',
    description: 'A .200+ ISO bat against a starter allowing at least 1.50 HR/9 recently.',
    criteria: { minISO: 0.2, minRecentPitcherHr9: 1.5 },
    evidence: { hits: null, sample: null, hitRate: null, lift: null },
    readiness: {
      fallbackStatus: 'collecting',
      features: ['season ISO', 'last-five-start HR/9'],
    },
  }),
  preset({
    id: 'contact-collision',
    tier: 'advanced',
    icon: 'Orbit',
    title: 'Contact Collision',
    description: 'A 10%+ barrel bat meeting a starter with a positive hard-contact allowance edge.',
    criteria: { minBarrel: 10, minContactCollision: 0.5 },
    evidence: { hits: null, sample: null, hitRate: null, lift: null },
    readiness: {
      fallbackStatus: 'collecting',
      features: ['barrel rate', 'contact-collision factor'],
    },
  }),
  preset({
    id: 'zone-contact-focus',
    tier: 'advanced',
    icon: 'Grid3x3',
    title: 'Zone Contact Focus',
    description: 'Three verified strike-zone attacks backed by 40%+ hard-hit contact and an 8–32° launch window.',
    criteria: { minZoneAttacks: 3, minHardHit: 40, minLaunchAngle: 8, maxLaunchAngle: 32 },
    evidence: { hits: null, sample: null, hitRate: null, lift: null },
    readiness: {
      fallbackStatus: 'limited-coverage',
      features: ['verified zone attack count', 'zone reliability', 'hard-hit rate', 'launch angle'],
    },
  }),
  preset({
    id: 'pitcher-contact-leak',
    tier: 'advanced',
    icon: 'Gauge',
    title: 'Pitcher Contact Leak',
    description: 'Score 52+ bats with 40%+ hard-hit contact, two verified attack zones and an 8–32° launch window against a 55+ starter leak.',
    criteria: { minScore: 52, minHardHit: 40, minLaunchAngle: 8, maxLaunchAngle: 32, minPitcherContactLeak: 55, minZoneAttacks: 2 },
    evidence: { hits: null, sample: null, hitRate: null, lift: null },
    readiness: {
      fallbackStatus: 'collecting',
      features: ['starter Contact Leak score', 'verified zone attacks', 'hard-hit rate', 'launch angle', 'model score'],
    },
  }),
  preset({
    id: 'low-k-power',
    tier: 'advanced',
    icon: 'TrendingDown',
    title: 'Low-K Power',
    description: 'A .200+ ISO bat facing a starter at 8.0 K/9 or lower.',
    criteria: { minISO: 0.2, maxPitcherK9: 8 },
    evidence: { hits: null, sample: null, hitRate: null, lift: null },
    readiness: {
      fallbackStatus: 'evaluated',
      features: ['season ISO', 'starter K/9'],
    },
  }),
  preset({
    id: 'top-four-power',
    tier: 'advanced',
    icon: 'Crown',
    title: 'Top-Four Power',
    description: 'A .200+ ISO bat projected or confirmed in lineup spots 1–4.',
    criteria: { minISO: 0.2, maxBattingOrder: 4 },
    evidence: { hits: null, sample: null, hitRate: null, lift: null },
    readiness: {
      fallbackStatus: 'evaluated',
      features: ['season ISO', 'frozen batting order'],
    },
  }),
])

export const PRIMARY_LIST_BUILDER_PRESETS = Object.freeze(
  LIST_BUILDER_PRESETS.filter((item) => item.tier === 'primary'),
)

export const MORE_LIST_BUILDER_PRESETS = Object.freeze(
  LIST_BUILDER_PRESETS.filter((item) => item.tier === 'more'),
)

export const ADVANCED_LIST_BUILDER_PRESETS = Object.freeze(
  LIST_BUILDER_PRESETS.filter((item) => item.tier === 'advanced'),
)
