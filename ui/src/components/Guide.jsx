import Icon from './Icon.jsx'
import { BADGES, gradeColor, GRADE_ORDER } from '../lib/badges.js'
import { hexA } from './atoms.jsx'

const VIEWS = [
  ['List', 'Board', 'Every hitter ranked by the model’s HR probability. Sort and filter to find tonight’s best power spots.'],
  ['LayoutGrid', 'Games', 'The slate as game cards — team colors, starters, live score, and each lineup split into two silos.'],
  ['Crosshair', 'Pitchers', 'One card per starter: a 0–100 vulnerability score, the lineup ranked as HR targets, pitch mix, and splits.'],
  ['Wind', 'Weather', 'One card per game ranked by the air — real wind OUT/IN verdict, temp, park factor, and who it helps.'],
  ['Layers', 'Parlay Combos', 'Auto-built cross-game parlays — one bat per game across 7 strategies and 2–4 legs. The betting workhorse.'],
  ['Layers', 'Same-Game Parlays', 'Multi-leg parlays within a single game (2–4 legs), with the correlation caveat spelled out.'],
  ['Activity', 'Results', 'The model’s track record — AUC, top-decile hit rate, calibration — plus the exact graded combos per day.'],
]

// The 7 parlay-combo strategies (server/parlay-combos.mjs · ui/lib/groups.js).
const STRATEGIES = [
  ['Top Picks', 'The single highest-graded bat in each game — pure chalk.'],
  ['Best Mix', 'Blends grade + barrel + heat so an elite-overall bat and an elite-barrel bat can share a combo. Usually the sharpest single board.'],
  ['Signal Stack', 'Bats lighting up the SAME proven HR signals (hot, barrel king, home/road edge, pen edge).'],
  ['Hot Hand', 'Riding current form — heat index × the recent-form multiplier.'],
  ['Power Bats', 'Raw thump — season barrel + recent barrel + blast rate (bat tracking).'],
  ['Soft Matchup', 'A quality bat × a homer-prone starter (high HR/9).'],
  ['Park & Air', 'A quality bat × a hitter-friendly park and wind.'],
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

export default function Guide({ onClose }) {
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="modal guide-modal" role="dialog" aria-modal="true" aria-label="Guide">
        <button className="drawer-close icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="X" size={18} />
        </button>
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
            <Icon name="Clock" size={14} /> Bet after lineups, not before
          </span>
          <span className="dim">
            Lineups post ~2–3 hours before each game. Until then the board is <b>provisional</b> — its bats shift as
            lineups and probable pitchers confirm, so combos locked in the morning are usually <i>not</i> the ones that
            grade. Wait for the <b>green “Lineups in”</b> stamp on the Combos page (or the lineup watcher) before you bet.
            A parlay also <b>locks at its earliest leg’s first pitch</b>, so keep a combo’s legs in the same start window —
            or the late leg goes in before its lineup is even posted.
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
          Seven strategies each pick <b>one bat per game</b> and build 2-, 3-, and 4-leg parlays (4-leg is the lottery
          tier). Combos cash only when <i>every</i> leg homers, so the glows tell you the risk at a glance:
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
          <Icon name="Zap" size={14} /> Blast rate
        </h3>
        <p className="guide-p dim">
          A <b>blast</b> is a swing that’s both fast and squared-up — the most HR-predictive slice of Statcast bat
          tracking. The board shows a bat’s recent blast rate, and on a leg you’ll see cuts <b>vs the pitcher’s hand</b>
          and <b>vs his exact pitch mix</b>. Blast drives the Power Bats combo and the BLAST badge. (It’s an advisory
          signal — it doesn’t move the calibrated HR probability unless it earns it in forward testing.)
        </p>

        <h3 className="section-title" style={{ marginTop: 18 }}>
          <Icon name="SlidersHorizontal" size={14} /> Signals
        </h3>
        <div className="guide-badges">
          {BADGES.map((b) => (
            <div className="guide-badge" key={b.key}>
              <span className="badge" style={{ color: b.color, borderColor: 'color-mix(in srgb,' + b.color + ' 40%, transparent)' }}>
                <Icon name={b.lucide} size={11} />
                {b.label}
              </span>
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
