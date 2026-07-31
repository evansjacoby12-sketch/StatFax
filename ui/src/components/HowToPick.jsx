import Icon from './Icon.jsx'

const STEPS = [
  {
    icon: 'Trophy',
    title: '1 · Choose the decision you are making',
    points: [
      'Use the Board for home-run candidates, Games for moneyline and total calls, and Bet Lab for NRFI/YRFI or curated combinations.',
      'Do not compare labels across those tools as if they share one scale. PRIME is an HR grade; PLAY is a game-market call; STRONG can be either an HR grade or a first-inning call depending on the section.',
    ],
  },
  {
    icon: 'Crosshair',
    title: '2 · Start with the engine’s preferred pool',
    points: [
      'For HR research, start with PRIME and STRONG. The grade ranks the total evidence; HR probability is the estimated chance of at least one homer.',
      'For game markets, PLAY is actionable, LEAN has direction but misses a gate, and PASS is not a recommended wager.',
      'For first innings, STRONG is fully qualified, LEAN has a smaller edge, and WATCH is a matchup to track rather than force.',
    ],
  },
  {
    icon: 'Scale3d',
    title: '3 · Read case versus caution',
    points: [
      'Open the player or game. The headline tells you the model direction; the details show what supports it and what can break it.',
      'Badges are evidence labels, not extra picks. Several independent signals are more useful than several badges describing the same underlying contact trend.',
      'A projection is an estimate, not a predicted outcome. A hitter with a 24% HR probability still misses roughly three out of four games.',
    ],
  },
  {
    icon: 'ClipboardList',
    title: '4 · Check whether it is ready to act on',
    points: [
      'Projected lineups are valid for research. Action ready means the posted order confirms the hitter and batting spot; it does not raise the model score.',
      'Verify the opposing starter, game number for doubleheaders, roof/weather status, and current sportsbook line before placing anything.',
      'Advisory signals are visible context. They do not change production projections unless they pass the required validation gate.',
    ],
  },
  {
    icon: 'GitBranch',
    title: '5 · Build combinations last',
    points: [
      'Start with the strongest individual decisions, then combine only legs that still make sense on their own.',
      'Every parlay leg must win. The all-hit estimate multiplies leg probabilities, so longer tickets increase payout faster than reliability.',
      'Use settled Results to judge a rule across a sample. One cash or one loss does not validate or invalidate the engine.',
    ],
  },
]

const CHECKLIST = [
  'Right workspace and label scope',
  'Preferred grade or actionable call',
  'Case is stronger than the listed caution',
  'Starter, game number, lineup and conditions verified',
  'Current market still matches the displayed decision',
  'Stake and leg count fit the actual probability',
]

export default function HowToPick({ onClose, embedded = false }) {
  return (
    <>
      {!embedded && <div className="drawer-scrim" onClick={onClose} />}
      <div className={embedded ? 'learn-embedded' : 'modal guide-modal'} role={embedded ? 'tabpanel' : 'dialog'} aria-modal={embedded ? undefined : 'true'} aria-label="How to use StatFax">
        {!embedded && <button className="drawer-close icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="X" size={18} />
        </button>}
        <div className="model-head">
          <h2>
            <Icon name="Target" size={18} /> Start here
          </h2>
          <div className="model-sub dim">
            A five-step workflow for turning the engine’s evidence into a clear decision.
          </div>
        </div>

        <div className="guide-callout">
          <span className="guide-callout-h">
            <Icon name="Info" size={14} /> Grade ≠ probability ≠ market call
          </span>
          <span className="dim">
            A <b>grade</b> ranks evidence, a <b>probability</b> estimates an outcome, and a <b>call</b> says whether the current market setup cleared its gates.
          </span>
        </div>

        {STEPS.map((step) => (
          <section className="htp-step" key={step.title}>
            <h3 className="section-title">
              <Icon name={step.icon} size={14} /> {step.title}
            </h3>
            <ul className="htp-list">
              {step.points.map((point) => <li key={point}>{point}</li>)}
            </ul>
          </section>
        ))}

        <section className="htp-step">
          <h3 className="section-title">
            <Icon name="Check" size={14} /> The 60-second check
          </h3>
          <ul className="htp-check">
            {CHECKLIST.map((item) => (
              <li key={item}><Icon name="Check" size={13} /> {item}</li>
            ))}
          </ul>
          <p className="guide-foot dim">
            No label means “will happen.” The engine is most useful when the same rule is applied consistently and judged over settled samples.
          </p>
        </section>
      </div>
    </>
  )
}
