// Pitcher Contact Leak is a transparent, advisory matchup layer. It does not
// alter the HR score or probability. The score answers one narrow question:
// how likely is the listed opposing starter to permit useful batted-ball
// contact to this batter's side?

export const PITCHER_CONTACT_LEAK_VERSION = 1;
export const PITCHER_CONTACT_LEAK_THRESHOLD = 55;

const LEAGUE_AVG_HARD_HIT = 37.5;
const LEAGUE_AVG_BARREL = 7.5;
const LEAGUE_AVG_EV = 88.0;
const LEAGUE_AVG_GO_AO = 1.15;
const LEAGUE_AVG_K9 = 8.5;
const LEAGUE_AVG_ISO = 0.155;
const LEAGUE_AVG_HR9 = 1.15;
const MIN_PITCHER_IP = 30;
const MIN_SPLIT_BF = 40;
const SPLIT_PRIOR_BF = 120;

const COMPONENT_WEIGHTS = Object.freeze({
  contactAllowed: 0.35,
  handedDamage: 0.25,
  airBall: 0.20,
  contactOpportunity: 0.20,
});

const COMPONENT_KEYS = Object.freeze(Object.keys(COMPONENT_WEIGHTS));
const STATUS_KEYS = new Set(['high-leak', 'leak', 'neutral', 'suppressed']);

const finite = (value) => Number.isFinite(value);
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round = (value, digits = 1) => finite(value) ? Number(value.toFixed(digits)) : null;

// This is the exact contact-quality formula already used inside the HR engine.
// Keeping it here prevents the advisory signal and the production matchup
// score from silently assigning different meaning to the same Statcast inputs.
export function pitcherContactQualityScore(pitcherSavant) {
  if (!pitcherSavant) return 50;
  const hhFactor = finite(pitcherSavant.hardHitPctAllowed)
    ? (pitcherSavant.hardHitPctAllowed - LEAGUE_AVG_HARD_HIT) * 1.2
    : 0;
  const brlFactor = finite(pitcherSavant.barrelPctAllowed)
    ? (pitcherSavant.barrelPctAllowed - LEAGUE_AVG_BARREL) * 3.0
    : 0;
  const evFactor = finite(pitcherSavant.exitVeloAgainst)
    ? (pitcherSavant.exitVeloAgainst - LEAGUE_AVG_EV) * 0.8
    : 0;
  return clamp(50 + hhFactor + brlFactor + evFactor);
}

export function effectiveContactSide(batSide, pitcherHand) {
  if (batSide === 'L' || batSide === 'R') return batSide;
  if (batSide === 'S' && (pitcherHand === 'L' || pitcherHand === 'R')) {
    return pitcherHand === 'L' ? 'R' : 'L';
  }
  return null;
}

function leakStatus(score) {
  if (score >= 62) return 'high-leak';
  if (score >= PITCHER_CONTACT_LEAK_THRESHOLD) return 'leak';
  if (score >= 45) return 'neutral';
  return 'suppressed';
}

function handedDamageScore(split) {
  if (!split || !finite(split.bf) || split.bf < MIN_SPLIT_BF) return null;
  if (!finite(split.iso) && !finite(split.hrPer9)) return null;
  const weight = split.bf / (split.bf + SPLIT_PRIOR_BF);
  const iso = finite(split.iso) ? split.iso * weight + LEAGUE_AVG_ISO * (1 - weight) : LEAGUE_AVG_ISO;
  const hr9 = finite(split.hrPer9) ? split.hrPer9 * weight + LEAGUE_AVG_HR9 * (1 - weight) : LEAGUE_AVG_HR9;
  return clamp(50 + (iso - LEAGUE_AVG_ISO) * 150 + (hr9 - LEAGUE_AVG_HR9) * 8);
}

export function buildPitcherContactLeak(batter) {
  const pitcher = batter?.pitcher;
  if (!pitcher) return null;
  const savant = pitcher.savant || {};
  const season = pitcher.season || {};
  const contactMetricCount = [savant.hardHitPctAllowed, savant.barrelPctAllowed, savant.exitVeloAgainst]
    .filter(finite).length;
  const side = effectiveContactSide(batter?.batSide, pitcher?.hand);
  const split = side ? pitcher?.splits?.[side === 'L' ? 'vl' : 'vr'] : null;

  const components = {
    contactAllowed: contactMetricCount >= 2 ? pitcherContactQualityScore(savant) : null,
    handedDamage: handedDamageScore(split),
    airBall: finite(season.ip) && season.ip >= MIN_PITCHER_IP && finite(season.goAo)
      ? clamp(50 + (LEAGUE_AVG_GO_AO - season.goAo) * 40)
      : null,
    contactOpportunity: finite(season.ip) && season.ip >= MIN_PITCHER_IP && finite(season.kPer9 ?? season.k9)
      ? clamp(50 + (LEAGUE_AVG_K9 - (season.kPer9 ?? season.k9)) * 5)
      : null,
  };
  const available = COMPONENT_KEYS.filter((key) => finite(components[key]));
  if (available.length < 3) return null;
  const weightTotal = available.reduce((sum, key) => sum + COMPONENT_WEIGHTS[key], 0);
  const score = round(available.reduce((sum, key) => sum + components[key] * COMPONENT_WEIGHTS[key], 0) / weightTotal);
  const roundedComponents = Object.fromEntries(COMPONENT_KEYS.map((key) => [key, round(components[key])]));
  const qualifies = score >= PITCHER_CONTACT_LEAK_THRESHOLD;

  return {
    version: PITCHER_CONTACT_LEAK_VERSION,
    advisoryOnly: true,
    score,
    threshold: PITCHER_CONTACT_LEAK_THRESHOLD,
    qualifies,
    status: leakStatus(score),
    reliability: available.length === COMPONENT_KEYS.length ? 'full' : 'partial',
    componentCount: available.length,
    effectiveBatterSide: side,
    components: roundedComponents,
    inputs: {
      hardHitPctAllowed: round(savant.hardHitPctAllowed),
      barrelPctAllowed: round(savant.barrelPctAllowed),
      exitVeloAgainst: round(savant.exitVeloAgainst),
      goAo: round(season.goAo, 3),
      kPer9: round(season.kPer9 ?? season.k9, 3),
      splitIso: round(split?.iso, 3),
      splitHrPer9: round(split?.hrPer9, 3),
      splitBattersFaced: round(split?.bf, 0),
    },
  };
}

export function pitcherContactLeakScore(batter) {
  const frozen = batter?.pitcherContactLeak;
  if (frozen?.version === PITCHER_CONTACT_LEAK_VERSION && finite(frozen.score)) return frozen.score;
  return buildPitcherContactLeak(batter)?.score ?? null;
}

export function isPitcherContactLeak(batter) {
  const score = pitcherContactLeakScore(batter);
  return finite(score) && score >= PITCHER_CONTACT_LEAK_THRESHOLD;
}

export function compactPitcherContactLeakEvidence(source) {
  if (!source || source.version !== PITCHER_CONTACT_LEAK_VERSION || !finite(source.score)) return null;
  return {
    version: PITCHER_CONTACT_LEAK_VERSION,
    advisoryOnly: true,
    score: round(clamp(source.score)),
    threshold: PITCHER_CONTACT_LEAK_THRESHOLD,
    qualifies: source.score >= PITCHER_CONTACT_LEAK_THRESHOLD,
    status: leakStatus(source.score),
    reliability: source.reliability === 'full' ? 'full' : 'partial',
    componentCount: COMPONENT_KEYS.filter((key) => finite(source.components?.[key])).length,
    effectiveBatterSide: ['L', 'R'].includes(source.effectiveBatterSide) ? source.effectiveBatterSide : null,
    components: Object.fromEntries(COMPONENT_KEYS.map((key) => [key, round(source.components?.[key])])),
    inputs: {
      hardHitPctAllowed: round(source.inputs?.hardHitPctAllowed),
      barrelPctAllowed: round(source.inputs?.barrelPctAllowed),
      exitVeloAgainst: round(source.inputs?.exitVeloAgainst),
      goAo: round(source.inputs?.goAo, 3),
      kPer9: round(source.inputs?.kPer9, 3),
      splitIso: round(source.inputs?.splitIso, 3),
      splitHrPer9: round(source.inputs?.splitHrPer9, 3),
      splitBattersFaced: round(source.inputs?.splitBattersFaced, 0),
    },
  };
}

export function validatePitcherContactLeakEvidence(evidence, at = 'pitcherContactLeak') {
  const errors = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return [`${at}: expected an object`];
  if (evidence.version !== PITCHER_CONTACT_LEAK_VERSION) errors.push(`${at}.version: expected ${PITCHER_CONTACT_LEAK_VERSION}`);
  if (evidence.advisoryOnly !== true) errors.push(`${at}.advisoryOnly: expected true`);
  if (!finite(evidence.score) || evidence.score < 0 || evidence.score > 100) errors.push(`${at}.score: expected [0,100]`);
  if (evidence.threshold !== PITCHER_CONTACT_LEAK_THRESHOLD) errors.push(`${at}.threshold: expected ${PITCHER_CONTACT_LEAK_THRESHOLD}`);
  if (typeof evidence.qualifies !== 'boolean' || (finite(evidence.score) && evidence.qualifies !== (evidence.score >= PITCHER_CONTACT_LEAK_THRESHOLD))) {
    errors.push(`${at}.qualifies: inconsistent with score`);
  }
  if (!STATUS_KEYS.has(evidence.status) || (finite(evidence.score) && evidence.status !== leakStatus(evidence.score))) errors.push(`${at}.status: inconsistent with score`);
  if (!['full', 'partial'].includes(evidence.reliability)) errors.push(`${at}.reliability: unsupported value`);
  const componentCount = COMPONENT_KEYS.filter((key) => finite(evidence.components?.[key])).length;
  for (const key of COMPONENT_KEYS) {
    const value = evidence.components?.[key];
    if (value != null && (!finite(value) || value < 0 || value > 100)) errors.push(`${at}.components.${key}: expected null or [0,100]`);
  }
  if (componentCount < 3 || evidence.componentCount !== componentCount) errors.push(`${at}.componentCount: expected ${componentCount}`);
  if (evidence.reliability === 'full' && componentCount !== 4) errors.push(`${at}.reliability: full requires four components`);
  if (evidence.effectiveBatterSide != null && !['L', 'R'].includes(evidence.effectiveBatterSide)) errors.push(`${at}.effectiveBatterSide: expected L, R, or null`);
  return errors;
}
