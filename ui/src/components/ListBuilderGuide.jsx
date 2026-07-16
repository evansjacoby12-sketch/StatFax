import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'

const CHAPTERS = Object.freeze([
  { id: 'quick-start', label: 'Quick start', icon: 'Zap', group: 'Start here' },
  { id: 'recipes', label: 'Recipes & evidence', icon: 'Layers', group: 'Build the list' },
  { id: 'ai', label: 'AI criteria', icon: 'Sparkles', group: 'Build the list' },
  { id: 'gates', label: 'Gates & signals', icon: 'SlidersHorizontal', group: 'Build the list' },
  { id: 'results', label: 'Matches & Fit', icon: 'Target', group: 'Read the list' },
  { id: 'tracking', label: 'Save & track', icon: 'Bookmark', group: 'Read the list' },
  { id: 'scorecard', label: 'Tracking metrics', icon: 'Activity', group: 'Read the list' },
  { id: 'workflow', label: 'Worked example', icon: 'Beaker', group: 'Put it to work' },
  { id: 'limits', label: 'Limits & mistakes', icon: 'Shield', group: 'Put it to work' },
])

const QUICK_STEPS = [
  ['Choose D14, D30, or All', 'Use the evidence window that matches how much recency and sample depth you want.'],
  ['Apply one recipe', 'Start from a visible, evidence-backed setup before adding your own gates.'],
  ['Keep the list actionable', 'Pregame, confirmed-lineup, and clean-data gates remove avoidable uncertainty.'],
  ['Read exact matches first', 'Every exact result passes every active gate. Open a player to verify tonight’s context.'],
  ['Use near misses deliberately', 'A near miss fails exactly one gate. Relax it only when the displayed difference is acceptable.'],
  ['Save the finished recipe', 'Saving starts a new tracked version without rewriting older frozen picks.'],
]

function Note({ tone = 'info', icon = 'Info', title, children }) {
  return (
    <div className={`lbg-note ${tone}`}>
      <Icon name={icon} size={15} />
      <div><b>{title}</b><p>{children}</p></div>
    </div>
  )
}

function DefinitionGrid({ items }) {
  return (
    <div className="lbg-definition-grid">
      {items.map(([term, definition, meta]) => (
        <div key={term}><span><b>{term}</b>{meta && <em>{meta}</em>}</span><p>{definition}</p></div>
      ))}
    </div>
  )
}

function StepList({ items }) {
  return (
    <ol className="lbg-step-list">
      {items.map(([title, copy], index) => (
        <li key={title}><span>{index + 1}</span><div><b>{title}</b><p>{copy}</p></div></li>
      ))}
    </ol>
  )
}

function ChapterContent({ id }) {
  if (id === 'quick-start') return (
    <>
      <div className="lbg-chapter-head"><span>01</span><div><h3>Quick-start checklist</h3><p>Build a defensible list in about two minutes.</p></div></div>
      <div className="lbg-checklist">
        {QUICK_STEPS.map(([title, copy], index) => (
          <div key={title}><span><Icon name={index === 0 ? 'Check' : 'Circle'} size={13} /></span><div><b>{title}</b><p>{copy}</p></div></div>
        ))}
      </div>
      <Note tone="good" icon="CircleCheck" title="The core habit">Use List Builder to produce candidates, then open each player’s research workspace before adding a leg.</Note>
    </>
  )

  if (id === 'recipes') return (
    <>
      <div className="lbg-chapter-head"><span>02</span><div><h3>Recipes and rolling evidence</h3><p>Start from a known filter set and understand the evidence behind it.</p></div></div>
      <p className="lbg-lead">A recipe applies several gates at once. Primary recipes are the fastest starting points; secondary and advanced matchup recipes narrow the slate around a more specific batter or pitcher profile.</p>
      <DefinitionGrid items={[
        ['D14', 'The most recent 14-day settled window. More responsive, usually a smaller sample.', 'recent'],
        ['D30', 'A broader 30-day window that trades some recency for more observations.', 'balanced'],
        ['All', 'Every settled slate currently available to the evidence feed.', 'deepest'],
        ['HR rate', 'The observed home-run rate among historical hitter-games that matched the recipe.'],
        ['Lift vs slate', 'Recipe hit rate divided by the same window’s overall slate HR rate. 1.50× means 50% above that baseline, not a 50% chance to homer.'],
        ['n', 'The number of evaluable historical matches. Always read lift beside its sample size and coverage.'],
      ]} />
      <Note tone="warn" icon="TriangleAlert" title="Readiness matters">Collecting or limited-history recipes remain usable on the live slate, but StatFax does not invent a historical rate when exact feature coverage is missing.</Note>
    </>
  )

  if (id === 'ai') return (
    <>
      <div className="lbg-chapter-head"><span>03</span><div><h3>Describe your list with AI</h3><p>Turn plain language into visible, editable criteria.</p></div></div>
      <div className="lbg-example-prompt"><small>Example request</small><b>“Confirmed power bats with 12% barrels and launch angle between 8° and 32°.”</b></div>
      <StepList items={[
        ['Describe the profile', 'Use baseball language and include thresholds when you already know them.'],
        ['Translate', 'The assistant maps supported phrases to the same gates available in Advanced filters.'],
        ['Audit the proposal', 'Read every proposed criterion chip. Nothing is applied until you approve it.'],
        ['Apply and refine', 'After applying, remove chips or adjust any numeric field manually.'],
      ]} />
      <Note icon="Sparkles" title="Translation, not a second model">AI does not score or rerank players. It only helps configure visible List Builder criteria.</Note>
    </>
  )

  if (id === 'gates') return (
    <>
      <div className="lbg-chapter-head"><span>04</span><div><h3>Actionability, metric gates, and signals</h3><p>Control who is eligible before interpreting the result list.</p></div></div>
      <DefinitionGrid items={[
        ['Pregame', 'Excludes games that have started or finished.'],
        ['Confirmed lineup', 'Requires the hitter to be in a confirmed starting lineup.'],
        ['Clean data', 'Excludes rows carrying a model data-review warning.'],
        ['Pitcher & park', 'Opposing-starter HR exposure, pitch-mix score, and park factor.'],
        ['Advanced matchup', 'ISO, recent pitcher HR/9, pitcher K/9, contact collision, and lineup position.'],
        ['Contact quality', 'Exit velocity, barrel, hard-hit, blast, launch-angle window, and pull rate.'],
        ['Model & form', 'Model score, HR probability, heat, recent barrel quality, setup checks, and trend balance.'],
        ['Signals: ALL', 'A hitter must have every selected signal.'],
        ['Signals: ANY', 'A hitter needs at least one selected signal.'],
      ]} />
      <Note tone="warn" icon="Info" title="Missing is not failing">If an active metric is unavailable for a hitter, the row is excluded from exact and near-miss results instead of being treated as a zero.</Note>
    </>
  )

  if (id === 'results') return (
    <>
      <div className="lbg-chapter-head"><span>05</span><div><h3>Exact matches, near misses, and Fit</h3><p>Know what qualified—and what did not—before changing a gate.</p></div></div>
      <div className="lbg-result-compare">
        <div className="exact"><Icon name="CircleCheck" size={17} /><b>Exact match</b><p>Passes every active actionability, metric, and signal gate.</p></div>
        <div className="near"><Icon name="Target" size={17} /><b>Near miss</b><p>Fails exactly one gate and has data for the active criteria.</p></div>
      </div>
      <DefinitionGrid items={[
        ['Fit score', 'Measures closeness to your chosen criteria. It is not HR probability and should not replace the model projection.'],
        ['Passed gates', 'Shows how many active gates the hitter cleared. Exact results clear all of them.'],
        ['Failed gate', 'Near-miss cards show the actual value, required threshold, difference, and a safe one-tap relaxation.'],
        ['Relax gate', 'Changes only the displayed failed criterion, returns to Exact results, and immediately rebuilds the list.'],
      ]} />
      <Note tone="bad" icon="TriangleAlert" title="Do not relax until someone appears">Decide the threshold first. Repeatedly loosening gates to admit a favorite player turns the builder into confirmation bias.</Note>
    </>
  )

  if (id === 'tracking') return (
    <>
      <div className="lbg-chapter-head"><span>06</span><div><h3>Save, version, and track a recipe</h3><p>Preserve what the rule selected at the time instead of rewriting history.</p></div></div>
      <StepList items={[
        ['Name the current setup', 'Use a stable name that describes the logic, not a player or a one-day outcome.'],
        ['Save & track', 'A new name creates version 1 and starts historical replay plus forward tracking.'],
        ['Update intentionally', 'Saving again under the same name creates a new version. Older forward picks remain tied to the gates that produced them.'],
        ['Load or delete', 'Load restores a recipe’s gates. Delete removes the recipe and its locally stored forward-pick ledger.'],
      ]} />
      <div className="lbg-two-column">
        <div><Icon name="RefreshCw" size={16} /><b>Historical replay</b><p>Applies the saved version’s gates to frozen historical rows. Scratches and rows missing required features are excluded.</p></div>
        <div><Icon name="Lock" size={16} /><b>Forward picks</b><p>Freezes qualifying pregame matches from the save date forward. Later recipe edits do not rewrite those picks.</p></div>
      </div>
    </>
  )

  if (id === 'scorecard') return (
    <>
      <div className="lbg-chapter-head"><span>07</span><div><h3>Read the tracking scorecard</h3><p>Separate selection quality, calibration, and overlap from betting profit.</p></div></div>
      <DefinitionGrid items={[
        ['Forward record', 'Settled hits divided by frozen forward picks, with unresolved picks shown separately.'],
        ['Historical replay', 'Hits and sample from frozen historical rows that satisfy the current saved version.'],
        ['Lift vs slate', 'Historical replay hit rate relative to the matching slate population.'],
        ['Calibration', 'Observed HR rate compared with the mean model projection for the tracked sample.'],
        ['Cold streak', 'Consecutive tracked misses from the best available forward or replay sample.'],
        ['Top overlap', 'How many selections this recipe shares with another saved recipe. High overlap means the recipes may not be adding distinct ideas.'],
      ]} />
      <Note tone="warn" icon="DollarSign" title="Profit is unavailable">Recipes do not store a sportsbook, price, stake, or explicit wager ledger. Lift and hit rate describe selection behavior, not ROI.</Note>
    </>
  )

  if (id === 'workflow') return (
    <>
      <div className="lbg-chapter-head"><span>08</span><div><h3>Worked example: disciplined power list</h3><p>A repeatable workflow from broad recipe to usable candidates.</p></div></div>
      <StepList items={[
        ['Set the evidence window to D30', 'Begin with the balanced window and note the slate baseline, sample size, and coverage.'],
        ['Apply Best available', 'Use the preset as the base instead of manually recreating every gate.'],
        ['Keep Pregame, Confirmed lineup, and Clean data on', 'Make the output actionable before adding more specificity.'],
        ['Add a contact-quality idea', 'For example, require a 12% barrel rate and an 8°–32° launch-angle window.'],
        ['Review Exact results', 'Compare model HR probability, gate reasons, lineup state, and the player’s full research evidence.'],
        ['Inspect Near misses once', 'Relax a single gate only if the displayed difference is acceptable before you see the player name.'],
        ['Save the final criteria', 'Use a descriptive name such as “Confirmed barrel window” and let forward tracking begin.'],
        ['Copy or act on the list', 'Copy preserves the criteria and ranking; Watch and Add to slip remain individual decisions.'],
      ]} />
    </>
  )

  return (
    <>
      <div className="lbg-chapter-head"><span>09</span><div><h3>Limits and common mistakes</h3><p>What List Builder can prove—and what it cannot.</p></div></div>
      <div className="lbg-mistakes">
        {[
          ['Treating lift as probability', '2.0× lift is relative to the slate baseline; it does not mean a player has a 200% or 50% HR chance.'],
          ['Ignoring sample size', 'A large lift over a tiny sample is unstable. Read n, coverage, and the selected window together.'],
          ['Stacking too many gates', 'Every extra requirement shrinks coverage and can leave a list that is precise but not useful.'],
          ['Confusing Fit with model strength', 'Fit measures your custom rule. HR probability and model score answer different questions.'],
          ['Editing after outcomes', 'Use recipe versions. Do not rewrite a rule to make yesterday’s record look better.'],
          ['Calling selection lift profit', 'Without wagered odds and stakes, the tracker cannot calculate EV, ROI, or profit.'],
        ].map(([title, copy]) => <div key={title}><Icon name="TriangleAlert" size={14} /><span><b>{title}</b><p>{copy}</p></span></div>)}
      </div>
      <Note icon="Shield" title="Best use">List Builder is a transparent candidate-screening and tracking tool. It supports research; it does not guarantee outcomes or replace price evaluation.</Note>
    </>
  )
}

export default function ListBuilderGuide({ onClose }) {
  const [activeChapter, setActiveChapter] = useState(CHAPTERS[0].id)
  const closeRef = useRef(null)

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus?.()
    }
  }, [onClose])

  if (typeof document === 'undefined') return null

  let lastGroup = null
  return createPortal(
    <div className="lbg-layer" role="presentation">
      <button type="button" className="lbg-scrim" onClick={onClose} aria-label="Close List Builder guide" />
      <section className="lbg-dialog" role="dialog" aria-modal="true" aria-labelledby="lbg-title">
        <header className="lbg-header">
          <span className="lbg-header-icon"><Icon name="BookOpen" size={19} /></span>
          <div><span>List Builder reference</span><h2 id="lbg-title">How to use List Builder</h2><p>Build transparent criteria, understand every match, and track the rule without rewriting history.</p></div>
          <button ref={closeRef} type="button" className="lbg-close" onClick={onClose} aria-label="Close List Builder guide"><Icon name="X" size={18} /></button>
        </header>

        <div className="lbg-layout">
          <aside className="lbg-sidebar" aria-label="Guide chapters">
            {CHAPTERS.map((chapter) => {
              const showGroup = chapter.group !== lastGroup
              lastGroup = chapter.group
              return (
                <div className="lbg-nav-block" key={chapter.id}>
                  {showGroup && <span className="lbg-nav-group">{chapter.group}</span>}
                  <button type="button" className={activeChapter === chapter.id ? 'on' : ''} onClick={() => setActiveChapter(chapter.id)} aria-current={activeChapter === chapter.id ? 'page' : undefined}>
                    <Icon name={chapter.icon} size={14} /> {chapter.label}<Icon name="ChevronRight" size={13} />
                  </button>
                </div>
              )
            })}
          </aside>

          <main className="lbg-reading" tabIndex={-1}>
            <div className="lbg-desktop-chapter"><ChapterContent id={activeChapter} /></div>
            <div className="lbg-mobile-chapters">
              {CHAPTERS.map((chapter, index) => (
                <details key={chapter.id} open={index === 0}>
                  <summary><span><Icon name={chapter.icon} size={15} /> {chapter.label}</span><Icon name="ChevronDown" size={15} /></summary>
                  <div className="lbg-mobile-chapter-body"><ChapterContent id={chapter.id} /></div>
                </details>
              ))}
            </div>
          </main>
        </div>

        <footer className="lbg-footer">
          <span><Icon name="Info" size={13} /> Historical results do not guarantee future outcomes.</span>
          <button type="button" onClick={onClose}><Icon name="Filter" size={14} /> Return to List Builder</button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
