import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { toast } from './Toast.jsx'
import { pct, num } from '../lib/format.js'
import * as store from '../lib/storage.js'
import { translateListBuilderQuery } from '../lib/list-builder-ai.js'
import {
  LIST_BUILDER_EVIDENCE_WINDOW_OPTIONS,
  loadListBuilderEvidence,
} from '../lib/list-builder-evidence.js'
import {
  LIST_BUILDER_EVIDENCE,
  MORE_LIST_BUILDER_PRESETS,
  PRIMARY_LIST_BUILDER_PRESETS,
} from '../lib/list-builder-presets.js'
import {
  LIST_BUILDER_SIGNALS,
  LIST_BUILDER_SORTS,
  activeListBuilderCriteria,
  buildListBuilderResults,
  createListBuilderCriteria,
  relaxListBuilderGate,
  sanitizeListBuilderCriteria,
} from '../lib/list-builder.js'

const FIELD_GROUPS = Object.freeze([
  {
    title: 'Pitcher & park',
    description: 'Tonight’s opposing starter and run environment.',
    fields: [
      { key: 'minOppHr9', label: 'Min exposure HR/9', hint: 'Effective matchup rate', min: 0, max: 4, step: 0.1 },
      { key: 'minPitchMix', label: 'Min pitch-mix score', hint: '0–10 matchup grade', min: 0, max: 10, step: 0.5 },
      { key: 'minParkFactor', label: 'Min park factor', hint: '1.00 is neutral', min: 0.5, max: 1.6, step: 0.05 },
    ],
  },
  {
    title: 'Contact quality',
    description: 'Season skill and batted-ball shape.',
    fields: [
      { key: 'minExitVelo', label: 'Min exit velocity', hint: 'mph', min: 70, max: 105, step: 0.5 },
      { key: 'minBarrel', label: 'Min barrel rate', hint: '% of BBE', min: 0, max: 35, step: 1 },
      { key: 'minHardHit', label: 'Min hard-hit rate', hint: '% at 95+ mph', min: 0, max: 80, step: 1 },
      { key: 'minBlast', label: 'Min blast rate', hint: '% of contact', min: 0, max: 60, step: 1 },
      { key: 'minLaunchAngle', label: 'Min launch angle', hint: 'HR window starts near 8°', min: -10, max: 45, step: 1 },
      { key: 'maxLaunchAngle', label: 'Max launch angle', hint: 'HR window ends near 32°', min: 0, max: 55, step: 1 },
      { key: 'minPullPct', label: 'Min pull rate', hint: '% of BBE', min: 0, max: 100, step: 1 },
    ],
  },
  {
    title: 'Model & form',
    description: 'Projection, recent form and evidence balance.',
    fields: [
      { key: 'minScore', label: 'Min model score', hint: '0–100', min: 0, max: 100, step: 5 },
      { key: 'minHeat', label: 'Min heat index', hint: '0–100', min: 0, max: 100, step: 5 },
      { key: 'minHrProb', label: 'Min HR probability', hint: '% projection', min: 0, max: 50, step: 1 },
      { key: 'minRecBarrel', label: 'Min recent barrel', hint: '%; requires 6+ BBE', min: 0, max: 45, step: 1 },
      { key: 'minHrDue', label: 'Min HR setup', hint: '0–6 evidence checks', min: 0, max: 6, step: 1 },
      { key: 'minPositives', label: 'Min positive trends', hint: 'Evidence count', min: 0, max: 15, step: 1 },
      { key: 'maxNegatives', label: 'Max negative trends', hint: 'Evidence limit', min: 0, max: 10, step: 1 },
    ],
  },
])

function Field({ definition, value, onChange }) {
  return (
    <label className="lbv-field">
      <span className="lbv-label">{definition.label}</span>
      <input
        className="lbv-input"
        type="number"
        value={value}
        min={definition.min}
        max={definition.max}
        step={definition.step}
        placeholder="No gate"
        onChange={(event) => onChange(definition.key, event.target.value)}
      />
      <span className="lbv-hint dim">{definition.hint}</span>
    </label>
  )
}

function criterionText(criterion) {
  if (criterion.type !== 'metric') return criterion.label
  return `${criterion.label} ${criterion.mode === 'max' ? '≤' : '≥'} ${criterion.threshold}`
}

function savedRecipesFromStorage() {
  const saved = store.load('listBuilderRecipes', [])
  if (!Array.isArray(saved)) return []
  return saved
    .filter((recipe) => recipe && typeof recipe.name === 'string' && recipe.criteria)
    .slice(0, 20)
    .map((recipe) => ({ ...recipe, criteria: sanitizeListBuilderCriteria(recipe.criteria) }))
}

function lineupLabel(batter) {
  if (batter.lineupConfirmed && Number.isFinite(batter.battingOrder)) return `Confirmed · batting ${batter.battingOrder}`
  if (batter.lineupConfirmed) return 'Confirmed lineup'
  if (Number.isFinite(batter.battingOrder)) return `Projected · batting ${batter.battingOrder}`
  return 'Lineup unconfirmed'
}

function formatEvidenceRange(startDate, endDate) {
  if (!startDate || !endDate) return 'Waiting for settled games'
  const format = (value, includeYear = false) => new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', ...(includeYear ? { year: 'numeric' } : {}), timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`))
  const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4)
  return `${format(startDate)}–${format(endDate, !sameYear)}`
}

function evidenceStatusLabel(evidence) {
  if (evidence?.fallback) return 'Last verified snapshot'
  if (!evidence || !Number.isFinite(evidence.hitRate)) return 'Collecting exact coverage'
  if (evidence.status === 'limited-coverage') return `${Math.round((evidence.coverage || 0) * 100)}% data coverage`
  if (evidence.stability?.status === 'stable-positive') return 'Stable across halves'
  if (evidence.stability?.status === 'mixed') return 'Mixed across halves'
  if (evidence.status === 'collecting') return 'Sample still collecting'
  return 'Rolling settled sample'
}

function PresetCard({ preset, evidence, active, compact = false, onApply }) {
  const hasMetrics = Number.isFinite(evidence?.hitRate) && Number.isFinite(evidence?.lift)
  const confidence = evidence?.confidence95
  return (
    <button
      type="button"
      className={`lbv-preset${compact ? ' compact' : ''}${active ? ' active' : ''}`}
      onClick={() => onApply(preset)}
      aria-pressed={active}
    >
      <span className="lbv-preset-top">
        <span className="lbv-preset-icon"><Icon name={preset.icon} size={compact ? 15 : 17} /></span>
        <span className={`lbv-preset-lift${hasMetrics ? '' : ' collecting'}`}>
          {hasMetrics ? `${evidence.lift.toFixed(2)}× slate` : 'Collecting'}
        </span>
      </span>
      <span className="lbv-preset-copy">
        <b>{preset.title}</b>
        <small>{preset.description}</small>
      </span>
      <span className="lbv-preset-evidence">
        {hasMetrics ? <><span><b>{evidence.hitRate.toFixed(1)}%</b> HR</span><span>n={evidence.matches ?? evidence.sample}</span></> : <span>Exact recipe history is not deep enough yet.</span>}
      </span>
      <span className="lbv-preset-confidence">
        {confidence ? `95% ${confidence.low.toFixed(1)}–${confidence.high.toFixed(1)}% · ` : ''}{evidenceStatusLabel(evidence)}
      </span>
    </button>
  )
}

function ResultCard({ item, index, nearMiss = false, onRelax, onSelect, watched, inSlip, onToggleWatch, onToggleSlip }) {
  const { batter, evaluation } = item
  const failure = nearMiss ? evaluation.failed[0] : null
  const reasons = evaluation.passed.slice(0, 3)
  const failureSymbol = failure?.mode === 'max' ? '≤' : '≥'
  return (
    <article
      className={`lbv-result-card${nearMiss ? ' near-miss' : ''}`}
      style={{ '--i': Math.min(index, 12) }}
      tabIndex={0}
      role="button"
      onClick={() => onSelect?.(batter)}
      onKeyDown={(event) => event.key === 'Enter' && onSelect?.(batter)}
    >
      <div className="lbv-result-identity">
        <GradeChip grade={batter.grade} size="sm" score={batter.score} />
        <div>
          <span className="lbv-result-name-row">
            <strong>{batter.name}</strong>
            <b className={`lbv-fit-score${nearMiss ? ' near' : ''}`}>{evaluation.fitScore} FIT</b>
          </span>
          <span>{batter.team} vs {batter.opponent?.abbr || batter.opponent?.name || '—'}</span>
          <small>{evaluation.passedGateCount}/{evaluation.gateCount} gates passed</small>
        </div>
      </div>

      <div className="lbv-result-evidence">
        <span className={`lbv-lineup${batter.lineupConfirmed ? ' confirmed' : ''}`}>
          <Icon name={batter.lineupConfirmed ? 'CircleCheck' : 'Clock'} size={13} /> {lineupLabel(batter)}
        </span>
        {batter.dataTrust?.status && (
          <span className="lbv-data-warning"><Icon name="TriangleAlert" size={13} /> Data review</span>
        )}
        {failure ? (
          <div className="lbv-failed-gate">
            <div>
              <b><Icon name="TriangleAlert" size={12} /> Failed: {failure.label}</b>
              {failure.type === 'metric' ? (
                <span>Actual {failure.valueText} · Gate {failureSymbol} {failure.thresholdText} · {failure.mode === 'max' ? 'Over' : 'Short'} by {failure.deltaText}</span>
              ) : (
                <span>Actual {failure.actual} · Gate {failure.thresholdText}</span>
              )}
              <small>{failure.relaxation.description}</small>
            </div>
            <button type="button" onClick={(event) => { event.stopPropagation(); onRelax?.(failure) }}>
              <Icon name="SlidersHorizontal" size={13} /> {failure.relaxation.label}
            </button>
          </div>
        ) : (
          <div className="lbv-reasons">
            {reasons.length
              ? reasons.map((reason) => <span key={reason.key}>{reason.detail || reason.label}</span>)
              : <span>Actionable pregame candidate · no metric gate applied</span>}
          </div>
        )}
      </div>

      <div className="lbv-result-numbers">
        <span><small>Score</small><b className="mono">{num(batter.score, 0)}</b></span>
        <span><small>HR projection</small><b className="mono accent">{pct(batter.hrProbability, 1)}</b></span>
      </div>

      <div className="lbv-result-actions" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => onSelect?.(batter)}><Icon name="ScanSearch" size={14} /> Research</button>
        <button type="button" className={watched ? 'on' : ''} onClick={() => onToggleWatch?.(batter)}>
          <Icon name="Star" size={14} fill={watched ? 'currentColor' : 'none'} /> {watched ? 'Watching' : 'Watch'}
        </button>
        <button type="button" className={inSlip ? 'on' : ''} onClick={() => onToggleSlip?.(batter)}>
          <Icon name={inSlip ? 'Check' : 'Plus'} size={14} /> {inSlip ? 'Added' : 'Add'}
        </button>
      </div>
    </article>
  )
}

export default function ListBuilderView({
  batters = [], onSelect, watchlist = new Set(), slip = new Set(), onToggleWatch, onToggleSlip,
}) {
  const [form, setForm] = useState(() => createListBuilderCriteria())
  const [activePreset, setActivePreset] = useState(null)
  const [savedRecipes, setSavedRecipes] = useState(savedRecipesFromStorage)
  const [recipeName, setRecipeName] = useState('')
  const [aiQuery, setAiQuery] = useState('')
  const [aiProposal, setAiProposal] = useState(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [rollingEvidence, setRollingEvidence] = useState(null)
  const [evidenceWindow, setEvidenceWindow] = useState('d14')
  const [evidenceFeedStatus, setEvidenceFeedStatus] = useState('loading')
  const [resultMode, setResultMode] = useState('exact')

  useEffect(() => {
    let active = true
    loadListBuilderEvidence()
      .then((artifact) => {
        if (!active) return
        setRollingEvidence(artifact)
        setEvidenceFeedStatus('rolling')
      })
      .catch(() => {
        if (active) setEvidenceFeedStatus('fallback')
      })
    return () => { active = false }
  }, [])

  const built = useMemo(() => buildListBuilderResults(batters, form), [batters, form])
  const visibleResults = resultMode === 'near' ? built.nearMisses : built.results
  const aiCriteria = useMemo(() => aiProposal ? activeListBuilderCriteria(aiProposal.criteria) : [], [aiProposal])
  const metricCoverage = Object.values(built.coverage)
  const covered = metricCoverage.length ? Math.min(...metricCoverage.map((item) => item.available)) : batters.length
  const rollingWindow = rollingEvidence?.windows?.[evidenceWindow] || null
  const evidenceContext = rollingWindow || LIST_BUILDER_EVIDENCE
  const evidenceFor = (preset) => rollingEvidence
    ? rollingEvidence.recipes?.[preset.id]?.windows?.[evidenceWindow]
    : { ...preset.evidence, fallback: true }

  const update = (patch) => {
    setActivePreset(null)
    setForm((current) => createListBuilderCriteria({ ...current, ...patch }))
  }

  const applyPreset = (preset) => {
    setActivePreset(preset.id)
    setForm(createListBuilderCriteria(preset.criteria))
  }

  const removeCriterion = (criterion) => {
    if (criterion.type === 'metric') update({ [criterion.key]: '' })
    else if (criterion.type === 'signal') update({ signals: form.signals.filter((key) => key !== criterion.key) })
    else update({ [criterion.key]: false })
  }

  const reset = () => {
    setActivePreset(null)
    setForm(createListBuilderCriteria())
  }

  const persistRecipes = (recipes) => {
    const limited = recipes.slice(0, 20)
    setSavedRecipes(limited)
    store.save('listBuilderRecipes', limited)
  }

  const saveRecipe = () => {
    const name = recipeName.trim().slice(0, 40)
    if (!name) {
      toast.warn('Name this recipe first')
      return
    }
    const existing = savedRecipes.find((recipe) => recipe.name.toLowerCase() === name.toLowerCase())
    const recipe = {
      id: existing?.id || `recipe-${Date.now()}`,
      name,
      criteria: sanitizeListBuilderCriteria(form),
      updatedAt: new Date().toISOString(),
    }
    persistRecipes([recipe, ...savedRecipes.filter((item) => item.id !== recipe.id)])
    setRecipeName('')
    toast.success(existing ? 'Recipe updated' : 'Recipe saved')
  }

  const restoreRecipe = (recipe) => {
    setActivePreset(null)
    setForm(sanitizeListBuilderCriteria(recipe.criteria))
    toast.info(`Loaded ${recipe.name}`)
  }

  const deleteRecipe = (recipe) => {
    persistRecipes(savedRecipes.filter((item) => item.id !== recipe.id))
    toast.info(`Deleted ${recipe.name}`)
  }

  const translateCriteria = async () => {
    if (!aiQuery.trim() || aiLoading) return
    setAiLoading(true)
    setAiError('')
    setAiProposal(null)
    try {
      setAiProposal(await translateListBuilderQuery(aiQuery))
    } catch (error) {
      setAiError(error.message || 'AI criteria is temporarily unavailable.')
    } finally {
      setAiLoading(false)
    }
  }

  const applyAiCriteria = () => {
    if (!aiProposal) return
    setActivePreset(null)
    setForm(sanitizeListBuilderCriteria(aiProposal.criteria))
    toast.success('AI criteria applied')
  }

  const relaxGate = (failure) => {
    setActivePreset(null)
    setForm(relaxListBuilderGate(form, failure))
    setResultMode('exact')
    toast.info(`Applied: ${failure.relaxation.description}`)
  }

  const copyList = async () => {
    const criteria = built.active.map(criterionText).join(' · ') || 'No filters'
    const players = visibleResults.map(({ batter, evaluation }, index) => {
      const miss = resultMode === 'near' ? ` · ${evaluation.fitScore} Fit · misses ${evaluation.failed[0].label}` : ''
      return `${index + 1}. ${batter.name} (${batter.team}) — HR ${pct(batter.hrProbability, 1)}${miss}`
    })
    const listLabel = resultMode === 'near' ? 'near misses' : 'exact matches'
    const text = [`StatFax List Builder · ${visibleResults.length} ${listLabel}`, `Criteria: ${criteria}`, '', ...players].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Criteria and list copied')
    } catch {
      toast.warn('Copy failed')
    }
  }

  return (
    <div className="lbv-root">
      <header className="lbv-hero">
        <div className="lbv-hero-copy">
          <span className="lbv-eyebrow">Decision workspace</span>
          <h2>Build an actionable HR list</h2>
          <p>Start with a recipe or tune the evidence gates. Results refresh with the slate and every match shows why it qualified.</p>
        </div>
        <div className="lbv-live-count" aria-live="polite">
          <strong key={built.results.length}>{built.results.length}</strong>
          <span>exact · {built.nearMisses.length} near</span>
          <small>Updates live</small>
        </div>
      </header>

      <section className="lbv-recipe-section" aria-labelledby="lbv-recipe-title">
        <div className="lbv-recipe-head">
          <div>
            <span className="lbv-eyebrow">{rollingWindow ? 'Rolling validation' : 'Validation snapshot'}</span>
            <h3 id="lbv-recipe-title">Evidence-backed recipes</h3>
            <p>
              {formatEvidenceRange(evidenceContext.startDate, evidenceContext.endDate)} · {evidenceContext.settledSlates} settled slates · {(evidenceContext.population ?? evidenceContext.hitterGames).toLocaleString()} hitter-games
            </p>
          </div>
          <div className="lbv-evidence-tools">
            <div className="lbv-evidence-windows" role="group" aria-label="Evidence window">
              {LIST_BUILDER_EVIDENCE_WINDOW_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={evidenceWindow === option.id ? 'on' : ''}
                  disabled={!rollingEvidence && option.id !== 'd14'}
                  onClick={() => setEvidenceWindow(option.id)}
                  aria-pressed={evidenceWindow === option.id}
                >{option.label}</button>
              ))}
            </div>
            <span className="lbv-slate-baseline"><b>{Number.isFinite(evidenceContext.baselineRate) ? `${evidenceContext.baselineRate.toFixed(1)}%` : '—'}</b> slate HR baseline</span>
          </div>
        </div>

        <div className="lbv-presets" aria-label="Primary list recipes">
          {PRIMARY_LIST_BUILDER_PRESETS.map((preset) => (
            <PresetCard key={preset.id} preset={preset} evidence={evidenceFor(preset)} active={activePreset === preset.id} onApply={applyPreset} />
          ))}
        </div>

        <details className="lbv-more-recipes">
          <summary>
            <span><Icon name="ChevronDown" size={14} /> More recipes</span>
            <small>{MORE_LIST_BUILDER_PRESETS.length} secondary profiles</small>
          </summary>
          <div className="lbv-presets lbv-presets-more" aria-label="Secondary list recipes">
            {MORE_LIST_BUILDER_PRESETS.map((preset) => (
              <PresetCard key={preset.id} preset={preset} evidence={evidenceFor(preset)} active={activePreset === preset.id} compact onApply={applyPreset} />
            ))}
          </div>
        </details>

        <p className="lbv-evidence-note"><Icon name="Info" size={12} /> {evidenceFeedStatus === 'rolling' ? 'Rolling settled records; scratches excluded.' : evidenceFeedStatus === 'fallback' ? 'Rolling feed unavailable; showing the last verified snapshot.' : 'Loading rolling evidence.'} Historical results do not guarantee future outcomes.</p>
      </section>

      <section className="lbv-workflows">
        <div className="lbv-ai-card">
          <div className="lbv-workflow-head">
            <span className="lbv-workflow-icon"><Icon name="Sparkles" size={17} /></span>
            <div><h3>Describe your list</h3><p>AI translates your words into visible filters. It does not score players.</p></div>
          </div>
          <div className="lbv-ai-input">
            <input
              type="text"
              value={aiQuery}
              maxLength={500}
              placeholder="Example: confirmed power bats, 12% barrels, launch angle 8–32"
              onChange={(event) => setAiQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  translateCriteria()
                }
              }}
            />
            <button type="button" onClick={translateCriteria} disabled={!aiQuery.trim() || aiLoading}>
              <Icon name={aiLoading ? 'Loader' : 'Sparkles'} size={14} className={aiLoading ? 'spin' : ''} />
              {aiLoading ? 'Translating' : 'Translate'}
            </button>
          </div>
          {aiError && <div className="lbv-ai-error"><Icon name="TriangleAlert" size={13} /> {aiError}</div>}
          {aiProposal && (
            <div className="lbv-ai-proposal">
              <div><b>Proposed criteria</b><p>{aiProposal.summary}</p></div>
              <div className="lbv-chips">
                {aiCriteria.length
                  ? aiCriteria.map((criterion) => <span key={`${criterion.type}:${criterion.key}`} className="lbv-chip static">{criterionText(criterion)}</span>)
                  : <span className="dim">No supported gates found</span>}
              </div>
              <button type="button" className="lbv-apply-ai" onClick={applyAiCriteria} disabled={!aiCriteria.length}>
                <Icon name="Check" size={13} /> Apply these criteria
              </button>
            </div>
          )}
        </div>

        <div className="lbv-saved-card">
          <div className="lbv-workflow-head">
            <span className="lbv-workflow-icon"><Icon name="Bookmark" size={17} /></span>
            <div><h3>Saved recipes</h3><p>Keep a reusable setup on this device.</p></div>
          </div>
          <div className="lbv-save-input">
            <input
              type="text"
              value={recipeName}
              maxLength={40}
              placeholder="Recipe name"
              onChange={(event) => setRecipeName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && saveRecipe()}
            />
            <button type="button" onClick={saveRecipe}><Icon name="Bookmark" size={14} /> Save current</button>
          </div>
          <div className="lbv-saved-list">
            {savedRecipes.length ? savedRecipes.map((recipe) => (
              <div className="lbv-saved-row" key={recipe.id}>
                <button type="button" className="lbv-saved-load" onClick={() => restoreRecipe(recipe)}>
                  <Icon name="Filter" size={12} /><span>{recipe.name}</span>
                  <small>{activeListBuilderCriteria(recipe.criteria).length} gates</small>
                </button>
                <button type="button" className="lbv-saved-delete" onClick={() => deleteRecipe(recipe)} aria-label={`Delete ${recipe.name}`} title={`Delete ${recipe.name}`}>
                  <Icon name="Trash2" size={13} />
                </button>
              </div>
            )) : <p className="lbv-saved-empty">No saved recipes yet.</p>}
          </div>
        </div>
      </section>

      <section className="lbv-control-card">
        <div className="lbv-control-top">
          <div>
            <span className="lbv-control-label">Actionability</span>
            <div className="lbv-trust">
              {[
                ['pregameOnly', 'Pregame', 'Clock'],
                ['confirmedOnly', 'Confirmed lineup', 'UserCheck'],
                ['trustedOnly', 'Clean data', 'Shield'],
              ].map(([key, label, icon]) => (
                <button key={key} type="button" className={form[key] ? 'on' : ''} onClick={() => update({ [key]: !form[key] })} aria-pressed={form[key]}>
                  <Icon name={icon} size={14} /> {label}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="lbv-reset" onClick={reset}><Icon name="RefreshCw" size={13} /> Reset</button>
        </div>

        <div className="lbv-criteria-bar">
          <span className="lbv-control-label">Active criteria</span>
          <div className="lbv-chips">
            {built.active.length ? built.active.map((criterion) => (
              <button key={`${criterion.type}:${criterion.key}`} type="button" className="lbv-chip" onClick={() => removeCriterion(criterion)} title="Remove criterion">
                {criterionText(criterion)} <Icon name="X" size={12} />
              </button>
            )) : <span className="dim">No gates selected</span>}
          </div>
        </div>
      </section>

      <details className="lbv-advanced">
        <summary><span><Icon name="SlidersHorizontal" size={16} /> Advanced filters</span><small>Fine-tune matchup, contact, form and signals</small><Icon name="ChevronDown" size={16} /></summary>
        <div className="lbv-advanced-body">
          {FIELD_GROUPS.map((group) => (
            <section className="lbv-filter-group" key={group.title}>
              <div className="lbv-filter-group-head"><h3>{group.title}</h3><p>{group.description}</p></div>
              <div className="lbv-grid">
                {group.fields.map((definition) => <Field key={definition.key} definition={definition} value={form[definition.key]} onChange={(key, value) => update({ [key]: value })} />)}
              </div>
            </section>
          ))}

          <section className="lbv-filter-group">
            <div className="lbv-signal-head">
              <div className="lbv-filter-group-head"><h3>Signals</h3><p>Require every selected signal or at least one.</p></div>
              <div className="lbv-mode" aria-label="Signal matching mode">
                {['all', 'any'].map((mode) => <button key={mode} type="button" className={form.signalMode === mode ? 'on' : ''} onClick={() => update({ signalMode: mode })}>{mode.toUpperCase()}</button>)}
              </div>
            </div>
            <div className="lbv-siglist">
              {LIST_BUILDER_SIGNALS.map((signal) => {
                const active = form.signals.includes(signal.key)
                return (
                  <button key={signal.key} type="button" className={`lbv-sigcheck${active ? ' on' : ''}`} onClick={() => update({ signals: active ? form.signals.filter((key) => key !== signal.key) : [...form.signals, signal.key] })} aria-pressed={active}>
                    <Icon name={active ? 'Check' : 'Plus'} size={13} /> {signal.label}
                  </button>
                )
              })}
            </div>
          </section>
        </div>
      </details>

      <section className="lbv-results">
        <div className="lbv-results-head">
          <div>
            <span className="lbv-eyebrow">Ranked matches</span>
            <h3>{built.results.length} exact · {built.nearMisses.length} near</h3>
            <p>{metricCoverage.length ? `${covered}/${batters.length} hitters have data for every active metric gate.` : 'No metric gates active; actionability rules still apply.'}</p>
          </div>
          <div className="lbv-results-tools">
            <label className="lbv-sort">Sort
              <select value={form.sort} onChange={(event) => update({ sort: event.target.value })}>
                {LIST_BUILDER_SORTS.map((sort) => <option key={sort.key} value={sort.key}>{sort.label}</option>)}
              </select>
            </label>
            <button type="button" className="lbv-copy" onClick={copyList} disabled={!visibleResults.length}><Icon name="Copy" size={13} /> Copy list</button>
          </div>
        </div>

        <div className="lbv-result-tabs" role="tablist" aria-label="Result type">
          <button type="button" role="tab" aria-selected={resultMode === 'exact'} className={resultMode === 'exact' ? 'on' : ''} onClick={() => setResultMode('exact')}>
            <Icon name="CircleCheck" size={13} /> Exact matches <b>{built.results.length}</b>
          </button>
          <button type="button" role="tab" aria-selected={resultMode === 'near'} className={resultMode === 'near' ? 'on' : ''} onClick={() => setResultMode('near')}>
            <Icon name="Target" size={13} /> Near misses <b>{built.nearMisses.length}</b>
          </button>
          <span>Fit measures criteria closeness, not HR probability. Missing data and multi-gate failures stay excluded.</span>
        </div>

        {visibleResults.length ? (
          <div className="lbv-result-list">
            {visibleResults.map((item, index) => (
              <ResultCard
                key={item.batter.id}
                item={item}
                index={index}
                nearMiss={resultMode === 'near'}
                onRelax={relaxGate}
                onSelect={onSelect}
                watched={watchlist.has(item.batter.id)}
                inSlip={slip.has(item.batter.id)}
                onToggleWatch={onToggleWatch}
                onToggleSlip={onToggleSlip}
              />
            ))}
          </div>
        ) : (
          <div className="lbv-empty">
            <Icon name="ListFilter" size={28} />
            <strong>{resultMode === 'near' ? 'No one-gate-away hitters' : 'No hitters clear every active gate'}</strong>
            <p>{resultMode === 'near' ? 'Missing-data rows and hitters failing two or more gates are intentionally excluded.' : 'Remove a criterion above, switch signals to ANY, or inspect the closest qualified near misses.'}</p>
            {resultMode === 'exact' && built.nearMisses.length > 0 && (
              <button type="button" className="lbv-empty-action" onClick={() => setResultMode('near')}>View {built.nearMisses.length} near misses</button>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
