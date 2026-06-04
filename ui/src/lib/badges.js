// Grade + badge vocabulary. Colors mirror the engine (daily.json grade.color).

export const GRADE_ORDER = ['PRIME', 'STRONG', 'LEAN', 'SKIP']

export const GRADE_COLORS = {
  PRIME: '#f5a623',
  STRONG: '#32d74b',
  LEAN: '#ffd60a',
  SKIP: '#6b7787',
}

export function gradeColor(label) {
  return GRADE_COLORS[label] || '#6b7787'
}

// Boolean flags on a scored batter → display chips.
// `lucide` field is the lucide-react icon name; tone drives color.
export const BADGES = [
  { key: 'hot', label: 'Hot', lucide: 'Flame', color: 'var(--b-hot)', tone: 'good', desc: 'On a hot streak — recent power surge' },
  { key: 'due', label: 'Due', lucide: 'Hourglass', color: 'var(--b-due)', tone: 'good', desc: 'HR drought vs. expected — regression candidate' },
  { key: 'cold', label: 'Cold', lucide: 'Snowflake', color: 'var(--b-cold)', tone: 'bad', desc: 'Cold stretch at the plate' },
  { key: 'bullpenLegend', label: 'Pen Edge', lucide: 'Shield', color: 'var(--b-bullpen)', tone: 'good', desc: 'Opposing bullpen is HR-prone late' },
  { key: 'pitchEdge', label: 'Pitch Edge', lucide: 'Crosshair', color: 'var(--b-pitch)', tone: 'good', desc: "Mashes the pitcher's most-used pitch (SLG well above his season norm)" },
  { key: 'wxEdge', label: 'WX Edge', lucide: 'Wind', color: 'var(--b-wx)', tone: 'good', desc: 'Park & weather conditions boost HR tonight (favorable air)' },
  { key: 'barrelKing', label: 'Barrel King', lucide: 'Award', color: 'var(--b-barrel)', tone: 'good', desc: 'Elite barrel rate — top ~10% of MLB (≥13% of batted balls)' },
  { key: 'homeEdge', label: 'Home Edge', lucide: 'House', color: 'var(--b-home)', tone: 'good', desc: 'Strong home/park split advantage' },
  { key: 'awayEdge', label: 'Road Edge', lucide: 'Plane', color: 'var(--b-away)', tone: 'good', desc: 'Strong road split advantage' },
  { key: 'homeBad', label: 'Home Drag', lucide: 'House', color: 'var(--b-neg)', tone: 'bad', desc: 'Weak home/park split' },
  { key: 'awayBad', label: 'Road Drag', lucide: 'Plane', color: 'var(--b-neg)', tone: 'bad', desc: 'Weak road split' },
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
