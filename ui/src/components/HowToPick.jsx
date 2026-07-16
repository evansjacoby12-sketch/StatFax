import Icon from './Icon.jsx'

// A full-detail playbook for choosing home-run plays off the board.
const STEPS = [
  {
    icon: 'Trophy',
    title: '1 · Start with grade + HR%',
    points: [
      'Work top-down: the board is already ranked by the model’s calibrated HR probability. Your pool is PRIME and STRONG — these are where the signals stack.',
      'HR% is the calibrated chance of ≥1 HR today. Anything ~25%+ is a strong number for a single bat; the very top of a slate tops out around 30%.',
      'Model score (the number in the grade chip) is the 0–100 composite: ~45% batter, ~30% matchup, ~25% environment. Higher = more agreement across the engine.',
      'LEAN = marginal, SKIP = the model sees little upside. Don’t force these.',
    ],
  },
  {
    icon: 'Check',
    title: '2 · Separate projection from actionability',
    points: [
      'Projected and confirmed hitters compete on the same model ranking. A projected lineup does not make the baseball case weaker by itself.',
      '“Ready” means the posted starting lineup verifies the hitter and batting spot. Use the “Action ready” filter when you are finalizing a bet; projected picks remain valid research candidates but can still be scratched or rested.',
      'Lineup spot matters: top-of-order bats (1–4) get more plate appearances, so more swings at a homer. Check the #-pill and the xHR column (expected HRs = sum of per-PA odds).',
    ],
  },
  {
    icon: 'Crosshair',
    title: '3 · Attack a vulnerable pitcher (Pitchers tab)',
    points: [
      'Open the Pitchers tab and target arms graded VULNERABLE or SHAKY (high 0–100 score). These are the soft spots.',
      'What makes an arm hittable: high HR/9 (≥1.4), low strikeouts (K/9 ≤ 6.5 — fewer whiffs = more balls in play), high barrel% and exit-velo allowed, and a fastball-heavy mix.',
      'Check the “most hittable pitch” callout — if your batter mashes that pitch, that’s the Pitch Edge signal firing.',
      'Avoid TOUGH arms (low score, high K, low HR/9) — even good hitters get suppressed.',
    ],
  },
  {
    icon: 'Wind',
    title: '4 · Let the air help (Weather tab)',
    points: [
      'Open the Weather tab — games are ranked by how much tonight’s park + air boosts HR. Favor “Bandbox” / “Favorable”.',
      'Wind is the swing factor: look for the real OUT verdict (“12 mph out to LF”). Wind blowing OUT adds carry; wind IN kills it. Domes/closed roofs = neutral.',
      'Heat helps — warm, humid air carries the ball farther. Cold, heavy air suppresses.',
      'Park HR factor: >1.05 is a launching pad (Coors, GABP, Yankee Stadium short porch); <0.95 suppresses (Oracle, T-Mobile, Petco). The WX Edge signal flags batters this all adds up for.',
    ],
  },
  {
    icon: 'Zap',
    title: '5 · Read the power profile',
    points: [
      'ISO / xISO (isolated power) is the cleanest raw-power read — .200+ is real pop, .250+ is elite. The board’s top reason often calls this out.',
      'Barrel% is the HR-optimal contact rate — high barrel% bats turn good swings into homers.',
      'Hot bats (Hot signal / Heat index) are squaring the ball up right now; Due bats are in an HR drought vs. their expected rate (regression candidates). Both are positive — Cold is the one to fade.',
    ],
  },
  {
    icon: 'SlidersHorizontal',
    title: '6 · Stack the signals',
    points: [
      'One signal is a lean; stacked signals are conviction. The best plays light up several chips at once.',
      'HR-positive: Hot, Due, Pitch Edge, WX Edge, Pen Edge (HR-prone bullpen late), Home/Road Edge (strong split).',
      'Cautionary: Cold, Home/Road Drag (weak split). Use the Signals filter to surface, e.g., “Pitch Edge + WX Edge” bats.',
    ],
  },
  {
    icon: 'GitBranch',
    title: '7 · Build parlays last',
    points: [
      'Start with singles, then combine only the legs that survive the checklist. Every parlay leg must homer, so probabilities multiply instead of adding.',
      'For SGPs, keep the action-ready default on and begin with two legs. Projected tickets are previews, not finished bets.',
      'StatFax currently uses the independent product for same-game all-hit probability. No correlation boost is applied until settled results prove one.',
      'Treat three- and four-leg SGPs as lottery plays. More legs increase payout, not reliability.',
    ],
  },
]

const CHECKLIST = [
  'PRIME or STRONG, HR% in the top tier',
  'Projection ranks well; confirm the lineup before the final bet',
  'Facing a VULNERABLE / SHAKY pitcher',
  'Bandbox / favorable park + wind out or hot',
  'Real power (ISO / barrel%) and not Cold',
  'Two or more signals stacked',
  'For SGPs: every leg action ready, two legs, independent all-hit understood',
]

export default function HowToPick({ onClose, embedded = false }) {
  return (
    <>
      {!embedded && <div className="drawer-scrim" onClick={onClose} />}
      <div className={embedded ? 'learn-embedded' : 'modal guide-modal'} role={embedded ? 'tabpanel' : 'dialog'} aria-modal={embedded ? undefined : 'true'} aria-label="How to pick">
        {!embedded && <button className="drawer-close icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="X" size={18} />
        </button>}
        <div className="model-head">
          <h2>
            <Icon name="Target" size={18} /> How to Pick
          </h2>
          <div className="model-sub dim">
            A full-detail playbook for choosing home-run plays — work top-down and stack the edges.
          </div>
        </div>

        {STEPS.map((s) => (
          <section className="htp-step" key={s.title}>
            <h3 className="section-title">
              <Icon name={s.icon} size={14} /> {s.title}
            </h3>
            <ul className="htp-list">
              {s.points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </section>
        ))}

        <section className="htp-step">
          <h3 className="section-title">
            <Icon name="Check" size={14} /> The 60-second checklist
          </h3>
          <ul className="htp-check">
            {CHECKLIST.map((c, i) => (
              <li key={i}>
                <Icon name="Check" size={13} /> {c}
              </li>
            ))}
          </ul>
          <p className="guide-foot dim">
            The more boxes a bat ticks, the higher your conviction. No play is a lock — even a 30% HR bat misses ~70%
            of the time — so spread risk and let the edges compound over a season.
          </p>
        </section>
      </div>
    </>
  )
}
