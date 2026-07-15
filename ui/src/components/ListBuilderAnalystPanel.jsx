import Icon from './Icon.jsx'

function EmptyAnalystState({ context }) {
  const blocked = context?.current?.blockedGates?.[0]
  return (
    <div className="lbv-analyst-empty">
      <Icon name="Beaker" size={18} />
      <div>
        <b>Ready to review this setup</b>
        <p>
          {context?.mode === 'empty'
            ? blocked ? `${blocked.label} is the most common blocker in the current slate.` : 'The current setup has no exact matches to review.'
            : 'The analyst will summarize the current matches and strongest aggregate evidence.'}
        </p>
      </div>
    </div>
  )
}

export default function ListBuilderAnalystPanel({
  context,
  result,
  relaxation,
  loading = false,
  error = '',
  recipes = [],
  leftRecipeId = '',
  rightRecipeId = '',
  onLeftRecipeChange,
  onRightRecipeChange,
  onAnalyze,
  onApplyRelaxation,
}) {
  const current = context?.current || {}
  const canCompare = recipes.length >= 2

  return (
    <section className="lbv-analyst" aria-labelledby="lbv-analyst-title">
      <div className="lbv-analyst-head">
        <span className="lbv-workflow-icon"><Icon name="Beaker" size={17} /></span>
        <div>
          <span className="lbv-eyebrow">Aggregate engine review</span>
          <h3 id="lbv-analyst-title">AI Analyst</h3>
          <p>Explains the current list, compares tracked recipes, and can select one engine-approved relaxation.</p>
        </div>
        <span className="lbv-analyst-guard"><Icon name="Shield" size={12} /> Advisory only · projections unchanged</span>
      </div>

      <div className="lbv-analyst-controls">
        <div className="lbv-analyst-counts" aria-label="Current List Builder counts">
          <span><small>Exact</small><b className="mono">{current.exactCount ?? 0}</b></span>
          <span><small>Near</small><b className="mono">{current.nearCount ?? 0}</b></span>
          <span><small>Gates</small><b className="mono">{current.activeGateCount ?? 0}</b></span>
        </div>

        <div className="lbv-analyst-compare" aria-label="Recipe comparison">
          <label>Recipe A
            <select value={leftRecipeId} onChange={(event) => onLeftRecipeChange?.(event.target.value)} disabled={!recipes.length}>
              <option value="">No recipe</option>
              {recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}
            </select>
          </label>
          <span>vs</span>
          <label>Recipe B
            <select value={rightRecipeId} onChange={(event) => onRightRecipeChange?.(event.target.value)} disabled={!canCompare}>
              <option value="">No recipe</option>
              {recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}
            </select>
          </label>
        </div>

        <button type="button" className="lbv-analyst-run" onClick={onAnalyze} disabled={loading || !context}>
          <Icon name={loading ? 'Loader' : 'Sparkles'} size={14} className={loading ? 'spin' : ''} />
          {loading ? 'Reviewing' : 'Analyze list'}
        </button>
      </div>

      {error && <div className="lbv-ai-error"><Icon name="TriangleAlert" size={13} /> {error}</div>}

      {result ? (
        <div className="lbv-analyst-result" aria-live="polite">
          <section className="lbv-analyst-diagnosis">
            <span className="lbv-analyst-label"><Icon name="Gauge" size={12} /> Diagnosis</span>
            <h4>{result.headline}</h4>
            <p>{result.diagnosis}</p>
          </section>

          <section>
            <span className="lbv-analyst-label"><Icon name="BarChart3" size={12} /> Strongest evidence</span>
            {result.strongestEvidence.length ? (
              <ul>{result.strongestEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
            ) : <p className="dim">No decision-grade aggregate evidence was available.</p>}
          </section>

          <section>
            <span className="lbv-analyst-label"><Icon name="Split" size={12} /> Recipe comparison</span>
            {result.comparison.available ? (
              <>
                <p>{result.comparison.verdict}</p>
                {result.comparison.differences.length > 0 && <ul>{result.comparison.differences.map((item) => <li key={item}>{item}</li>)}</ul>}
                {result.comparison.caution && <small>{result.comparison.caution}</small>}
              </>
            ) : <p className="dim">Save and select two recipes to compare their settled records.</p>}
          </section>

          <section className="lbv-analyst-action">
            <span className="lbv-analyst-label"><Icon name="SlidersHorizontal" size={12} /> One safe change</span>
            {relaxation ? (
              <>
                <p>{result.relaxation.reason || relaxation.description}</p>
                <button type="button" onClick={() => onApplyRelaxation?.(relaxation)}>
                  <Icon name="Check" size={13} /> {relaxation.label}
                  <small>would yield {relaxation.newExactCount} exact</small>
                </button>
              </>
            ) : <p className="dim">No allow-listed relaxation was recommended.</p>}
          </section>

          {result.limitations.length > 0 && (
            <div className="lbv-analyst-limitations"><Icon name="Info" size={12} /> {result.limitations.join(' · ')}</div>
          )}
        </div>
      ) : <EmptyAnalystState context={context} />}
    </section>
  )
}
