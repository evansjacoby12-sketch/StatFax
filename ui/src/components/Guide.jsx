import Icon from './Icon.jsx'
import { BADGES, gradeColor, GRADE_ORDER } from '../lib/badges.js'
import { hexA, Badge } from './atoms.jsx'

const VIEWS = [
  ['List', 'Board', 'Every hitter ranked by the model’s HR probability. Sort and filter to find tonight’s best power spots.'],
  ['LayoutGrid', 'Games', 'The slate as game cards — team colors, starters, live score, and each lineup split into two silos.'],
  ['Crosshair', 'Pitchers', 'One card per starter: a 0–100 vulnerability score, the lineup ranked as HR targets, pitch mix, and splits.'],
  ['Wind', 'Weather', 'One card per game ranked by the air — real wind OUT/IN verdict, temp, park factor, and who it helps.'],
  ['Layers', 'Parlay Combos', 'Auto-built cross-game parlays — one bat per game across six live strategies and 2–4 legs.'],
  ['GitBranch', 'Same-Game Parlays', 'Confirmed-lineup 2–4 leg tickets from one game. All-hit uses the independent product with no correlation uplift.'],
  ['Activity', 'Results', 'The model’s track record — AUC, top-decile hit rate, calibration — plus the exact graded combos per day.'],
]

// Current parlay-combo strategies (server/parlay-combos.mjs · ui/lib/groups.js).
const STRATEGIES = [
  ['Hot Hand', 'Riding current form — heat index × the recent-form multiplier.'],
  ['Best Mix', 'Blends grade + barrel + heat so overall quality and live power both matter.'],
  ['Park & Air', 'A quality bat × a hitter-friendly park and wind.'],
  ['Soft Matchup', 'A quality bat × a homer-prone starter (high HR/9).'],
  ['Precision', 'Hot bats with elite barrel contact; ranks the qualified pool by barrel rate.'],
  ['Value', 'Live-only combinations where model HR probability beats the available fair market price.'],
]

// Glows + guards on each combo card.
const GUARDS = [
  ['Check', 'Tail (green)', 'Every leg is clean — PRIME, healthy barrel, no HR-stingy arm. The combos to lean on.'],
  ['TriangleAlert', 'Caution (yellow)', 'A leg trips a minor flag — sub-PRIME grade, low barrel (<13%), or a stingy arm (<0.85 HR/9).'],
  ['TriangleAlert', 'Weak leg (red)', 'A leg likely to sink the parlay — long-shot HR%, a tiny barrel under a weak grade, or 2+ flags. That leg gets a WEAK badge; the weakest is tagged WEAKEST.'],
  ['Clock', 'Provisional / NO LINEUP', 'A leg’s lineup isn’t posted yet, so the combo can still reshuffle. The card is dimmed + dashed — not safe to bet.'],
  ['Clock', 'Spread warning', 'Legs >2.5h apart: the ticket locks at the EARLIEST first pitch, before the later game’s lineup is set — so you’d bet the late leg blind.'],
  ['Zap', 'BLAST', 'Elite blast rate — fast, squared-up contact (bat tracking). A live power signal.'],
]

const TOOLS = [
  ['Search', 'Search', 'Filter by batter, team, or pitcher name.'],
  ['Trophy', 'Grade chips', 'Toggle PRIME / STRONG / LEAN / SKIP to focus the board.'],
  ['SlidersHorizontal', 'Filters (chevron)', 'Game, confirmed-lineup-only, watchlist-only, heating-up (Heat ≥ 58), and the signal chips.'],
  ['Activity', 'Live / Pregame', 'Flip the whole board between live scores + innings and a clean pregame projection look.'],
  ['Radio', 'Auto', 'Soft-refresh the slate every 60s for live games — filters and selection survive.'],
  ['Star', 'Watchlist', 'Star any batter (row or drawer), then filter to just your list.'],
  ['Plus', 'Parlay slip', 'Add legs with the + on a row; the slip shows combined model probability and model-fair price.'],
]

export default function Guide({ onClose, embedded = false }) {
  return (
    <>
      {!embedded && <div className="drawer-scrim" onClick={onClose} />}
      <div className={embedded ? 'learn-embedded' : 'modal guide-modal'} role={embedded ? 'tabpanel' : 'dialog'} aria-modal={embedded ? undefined : 'true'} aria-label="Guide">
        {!embedded && <button className="drawer-close icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="X" size={18} />
        </button>}
        <div className="model-head">
          <h2>
            <Icon name="Info" size={18} /> Guide
          </h2>
          <div className="model-sub dim">
            StatFax ranks every hitter by the model’s own home-run probability — a pure model board, no market odds — then
            auto-builds the best parlays from it.
          </div>
        </div>

        {/* The single most important habit — earned the hard way. */}
        <div className="guide-callout">
          <span className="guide-callout-h">
            <Icon name="Lock" size={14} /> Scores lock in the morning
          </span>
          <span className="dim">
            The board's scores, grades and cross-game combos <b>freeze at the morning lock</b> (look for the lock chip in the
            header) — they won't drift during the day. The only things that
            update after the lock are <b>lineup confirmations</b> (green dot) and <b>scratched players</b>; if a
            starting pitcher changes, that bat is re-scored and tagged <b>NEW ARM</b>. A parlay still{' '}
            <b>locks at its earliest leg's first pitch</b>, so keep a combo's legs in the same start window.
            Same-game benchmarks freeze separately after the complete game lineup is confirmed.
          </span>
        </div>

        <h3 className="section-title">
          <Icon name="LayoutGrid" size={14} /> The views
        </h3>
        <div className="guide-list">
          {VIEWS.map(([icon, name, desc]) => (
            <div className="guide-row" key={name}>
              <span className="guide-ico"><Icon name={icon} size={15} /></span>
              <span className="guide-txt"><b>{name}</b><span className="dim">{desc}</span></span>
            </div>
          ))}
        </div>

        <h3 className="section-title" style={{ marginTop: 18 }}>
          <Icon name="Trophy" size={14} /> Reading a pick
        </h3>
        <p className="guide-p dim">
          Each row leads with the engine’s <b>grade</b> and its <b>HR probability</b> (calibrated chance of ≥1 HR today),
          plus the top reason. Tap any row for the full drawer — score breakdown, Statcast, the opposing pitcher,
          weather, career H2H, and recent starts.
        </p>
        <div className="guide-grades">
          {GRADE_ORDER.map((g) => {
            const c = gradeColor(g)
            return (
              <span key={g} className="grade-chip grade-md" style={{ color: c, borderColor: hexA(c, 0.45), background: hexA(c, 0.12) }}>
                {g}
              </span>
            )
          })}
        </div>

        <h3 className="section-title" style={{ marginTop: 18 }}>
          <Icon name="Layers" size={14} /> Parlay Combos
        </h3>
        <p className="guide-p dim">
          Six live strategies each pick <b>one bat per game</b> and build 2-, 3-, and 4-leg parlays (4-leg is the lottery
          tier). Five are tracked in the frozen scorecard; Value is live-only because it needs market prices. Combos
          cash only when <i>every</i> leg homers, so the glows tell you the risk at a glance:
        </p>
        <div className="guide-list">
          {STRATEGIES.map(([name, desc]) => (
            <div className="guide-row" key={name}>
              <span className="guide-ico"><Icon name="ChevronRight" size={15} /></span>
              <span className="guide-txt"><b>{name}</b><span className="dim">{desc}</span></span>
            </div>
          ))}
        </div>
        <h4 className="guide-subhead dim">Glows &amp; guards</h4>
        <div className="guide-list">
          {GUARDS.map(([icon, name, desc]) => (
            <div className="guide-row" key={name}>
              <span className="guide-ico"><Icon name={icon} size={15} /></span>
              <span className="guide-txt"><b>{name}</b><span className="dim">{desc}</span></span>
            </div>
          ))}
        </div>
        <p className="guide-p dim">
          The <b>scorecard</b> at the top tracks how the canonical combos have actually hit, with an estimated
          <b> ROI/P&amp;L</b> at your stake. The <b>Results → Combo results</b> view lists the exact graded combos per
          day (legs + which homered), with <b>Full board</b> vs <b>Evening board</b> (what you could realistically bet
          late) and a size filter.
        </p>

        <h3 className="section-title" style={{ marginTop: 18 }}>
          <Icon name="GitBranch" size={14} /> Same-Game Parlays
        </h3>
        <p className="guide-p dim">
          SGPs stack 2–4 hitters from one game. StatFax defaults to <b>confirmed lineups</b>; projected tickets are
          available only as an early preview. The shown all-hit chance is the <b>independent product</b> of the
          calibrated leg rates—there is no unvalidated same-game uplift. Start with two legs; three and four legs
          are lottery plays. The rolling SGP record settles from official player-and-game box-score outcomes.
        </p>

        <h3 className="section-title" style={{ marginTop: 18 }}>
          <Icon name="Zap" size={14} /> Blast rate
        </h3>
        <p className="guide-p dim">
          A <b>blast</b> is a swing that’s both fast and squared-up — the most HR-predictive slice of Statcast bat
          tracking. The board shows a bat’s recent blast rate, and on a leg you’ll see cuts <b>vs the pitcher’s hand</b>
          and <b>vs his exact pitch mix</b>. Blast supports the player profile and BLAST badge. (It’s an advisory
          signal — it doesn’t move the calibrated HR probability unless it earns it in forward testing.)
        </p>

        <h3 className="section-title" style={{ marginTop: 18 }}>
          <Icon name="SlidersHorizontal" size={14} /> Signals
        </h3>
        <div className="guide-badges">
          {BADGES.map((b) => (
            <div className="guide-badge" key={b.key}>
              <Badge badge={b} />
              <span className="dim">{b.desc}</span>
            </div>
          ))}
        </div>

        <h3 className="section-title" style={{ marginTop: 18 }}>
          <Icon name="Gauge" size={14} /> Filters &amp; tools
        </h3>
        <div className="guide-list">
          {TOOLS.map(([icon, name, desc]) => (
            <div className="guide-row" key={name}>
              <span className="guide-ico"><Icon name={icon} size={15} /></span>
              <span className="guide-txt"><b>{name}</b><span className="dim">{desc}</span></span>
            </div>
          ))}
        </div>

        <p className="guide-foot dim">
          Tap the <Icon name="Info" size={12} /> in the header for the full legend of grades, signals, and stat
          definitions.
        </p>
      </div>
    </>
  )
}
