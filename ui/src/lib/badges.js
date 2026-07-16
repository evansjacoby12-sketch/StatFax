// Grade + badge vocabulary. Colors mirror the engine (daily.json grade.color).

export const GRADE_ORDER = ['PRIME', 'STRONG', 'LEAN', 'SKIP']

export const GRADE_COLORS = {
  PRIME: '#d6b56f',
  STRONG: '#69b99e',
  LEAN: '#c69a57',
  SKIP: '#676673',
}

export function gradeColor(label) {
  return GRADE_COLORS[label] || '#676673'
}

// Boolean flags on a scored batter → display chips.
// `lucide` field is the lucide-react icon name; tone drives color.
export const BADGES = [
  { key: 'precision', label: 'Precision', lucide: 'Focus', color: 'var(--accent)', tone: 'good', desc: 'Meets every precision gate: pitch mix ≥7, heat ≥48, HR due 5/6+, 8+ positive trends, ≤3 negatives' },
  { key: 'powerReady', label: 'Power Ready (beta)', lucide: 'Gauge', color: '#a8a9cf', tone: 'warn', desc: 'Beta advisory signal: ceiling ≥75, matchup ≥60 and form ≥35 with a real recent contact sample. Logged for forward validation; it does not add a probability bonus.' },
  { key: 'barrelReady', label: 'Barrel Ready (beta)', lucide: 'CircleDotDashed', color: '#c69a57', tone: 'warn', desc: 'Beta advisory signal: solid power (ceiling ≥70) AND genuinely hot form (form ≥60) with a real recent contact sample — no matchup gate. The hot-form complement to Power Ready. Logged for forward validation; it does not add a probability bonus.' },
  { key: 'sleeper', label: 'Sleeper', lucide: 'MoonStar', color: '#9085bd', tone: 'good', desc: 'Under-the-radar value: STRONG/LEAN grade but PRIME-adjacent form — heat ≥48, HR setup 3/6+, hot or rising power. Hit 21% over the 14-day validation window at non-chalk prices' },
  { key: 'hot', label: 'Hot', lucide: 'Flame', color: 'var(--b-hot)', tone: 'good', desc: 'On a hot streak — recent power surge' },
  { key: 'rising', label: 'Rising', lucide: 'TrendingUp', color: 'var(--good)', tone: 'good', desc: 'Recent ~14-day barrel rate surging above the season rate — heating up right now (the recency edge sharps ride)' },
  { key: 'due', label: 'Due', lucide: 'TimerReset', color: 'var(--b-due)', tone: 'good', desc: 'HR drought vs. expected — regression candidate' },
  { key: 'cold', label: 'Cold', lucide: 'Snowflake', color: 'var(--b-cold)', tone: 'bad', desc: 'Cold stretch at the plate' },
  { key: 'bullpenLegend', label: 'Pen Edge', lucide: 'Swords', color: 'var(--b-bullpen)', tone: 'good', desc: 'Opposing bullpen is HR-prone late' },
  { key: 'pitchEdge', label: 'Pitch Edge', lucide: 'Radar', color: 'var(--b-pitch)', tone: 'good', desc: "Mashes the pitcher's most-used pitch (SLG well above his season norm)" },
  { key: 'zoneEdge', label: 'Zone Edge', lucide: 'Grid3x3', color: 'var(--b-pitch)', tone: 'good', desc: "Strong zone matchup — above-average ISO in the pitcher's most-used zones (rating 7+/10)" },
  { key: 'pitchMixEdge', label: 'Pitch Mix', lucide: 'ChartSpline', color: 'var(--strong)', tone: 'good', desc: "Favorable pitch-type matchup — SLG advantage across the pitcher's arsenal (score 7.0+/10)" },
  { key: 'wxEdge', label: 'WX Edge', lucide: 'CloudSun', color: 'var(--b-wx)', tone: 'good', desc: 'Park & weather conditions boost HR tonight (favorable air)' },
  { key: 'barrelKing', label: 'Barrel King', lucide: 'Crown', color: 'var(--b-barrel)', tone: 'good', desc: 'Elite barrel rate — top ~10% of MLB (≥13% of batted balls)' },
  { key: 'blast', label: 'Blast', lucide: 'Bomb', color: 'var(--b-hot)', tone: 'good', desc: 'Elite blast rate (bat tracking) — fast, squared-up contact. Blasting ≥25% lately (per squared-up contact), a live power signal sharps watch.' },
  { key: 'flyBallMatchup', label: 'vs FB Arm', lucide: 'Orbit', color: 'var(--b-fly)', tone: 'good', desc: 'Facing a fly-ball-prone starter (low ground-out/air-out ratio) — more balls in the air, HR-friendly matchup' },
  { key: 'hrPlatoonEdge', label: 'HR Platoon', lucide: 'Split', color: 'var(--b-plat)', tone: 'good', desc: "Opposing starter gives up notably more HR to this batter's side (platoon HR split)" },
  { key: 'homeEdge', label: 'Home Edge', lucide: 'MapPinHouse', color: 'var(--b-home)', tone: 'good', desc: 'Strong home/park split advantage' },
  { key: 'awayEdge', label: 'Road Edge', lucide: 'Route', color: 'var(--b-away)', tone: 'good', desc: 'Strong road split advantage' },
  { key: 'homeBad', label: 'Home Drag', lucide: 'MapPinX', color: 'var(--b-neg)', tone: 'bad', desc: 'Weak home/park split' },
  { key: 'awayBad', label: 'Road Drag', lucide: 'RouteOff', color: 'var(--b-neg)', tone: 'bad', desc: 'Weak road split' },
]

export const BADGE_BY_KEY = Object.fromEntries(BADGES.map((b) => [b.key, b]))

export function activeBadges(batter) {
  return BADGES.filter((b) => batter[b.key] === true)
}

// eli5Reasons.icon strings → lucide-react component names.
export const ELI5_ICONS = {
  zap: 'Zap',
  flame: 'Flame',
  'trending-up': 'TrendingUp',
  'trending-down': 'TrendingDown',
  layers: 'Layers',
  crosshair: 'Crosshair',
  target: 'Target',
  shield: 'Shield',
  home: 'House',
  wind: 'Wind',
  thermometer: 'Thermometer',
  cloud: 'Cloud',
  sun: 'Sun',
  droplet: 'Droplet',
  activity: 'Activity',
  award: 'Award',
  alert: 'TriangleAlert',
  'alert-triangle': 'TriangleAlert',
  info: 'Info',
  check: 'Check',
  x: 'X',
}

export function eli5IconName(icon) {
  return ELI5_ICONS[icon] || 'Dot'
}

export function toneColor(tone) {
  if (tone === 'good') return 'var(--good)'
  if (tone === 'bad') return 'var(--bad)'
  if (tone === 'warn') return 'var(--warn)'
  return 'var(--text-dim)'
}
