import Icon from './Icon.jsx'

function sourceFor(issue) {
  return Array.isArray(issue?.evidence) ? issue.evidence.find((item) => item?.url) : null
}

export default function MlbDataHealthBanner({ health }) {
  if (!health || health.status === 'ready') return null
  const issues = Array.isArray(health.issues) ? health.issues : []
  const warnings = Number(health.warnings || 0)
  const aiAlerts = Number(health.aiAlerts || 0)
  const affectedGames = Number(health.affectedGames || 0)
  const affectedBatters = Number(health.affectedBatters || 0)
  const label = health.status === 'critical' ? 'Slate publish blocked' : 'Data review active'
  const summary = health.status === 'critical'
    ? `${health.hardFailures || 0} feed identity failure${health.hardFailures === 1 ? '' : 's'} detected.`
    : `${warnings} data check${warnings === 1 ? '' : 's'}${affectedGames ? ` across ${affectedGames} game${affectedGames === 1 ? '' : 's'}` : ''}${affectedBatters ? ` · ${affectedBatters} hitter${affectedBatters === 1 ? '' : 's'} marked for review` : ''}${aiAlerts ? ` · ${aiAlerts} source-backed AI alert${aiAlerts === 1 ? '' : 's'}` : ''}. Projections were not changed by ${warnings === 1 ? 'this check' : 'these checks'}.`

  return (
    <details className={`mlb-data-health is-${health.status}`}>
      <summary aria-label={`${label}. ${summary}`}>
        <span className="mlb-data-health-icon" aria-hidden="true"><Icon name="TriangleAlert" size={16} /></span>
        <span className="mlb-data-health-copy"><b>{label}</b><span>{summary}</span></span>
        {issues.length > 0 && <span className="mlb-data-health-action">View checks <Icon name="ChevronDown" size={15} /></span>}
      </summary>
      {issues.length > 0 && (
        <div className="mlb-data-health-list">
          {issues.map((issue) => {
            const source = sourceFor(issue)
            return (
              <div className="mlb-data-health-item" key={issue.id}>
                <span className={`mlb-data-health-dot is-${issue.severity}`} aria-hidden="true" />
                <span>{issue.message}</span>
                {source && (
                  <a href={source.url} target="_blank" rel="noreferrer" aria-label={`Open source: ${source.title || 'external report'}`}>
                    Source <Icon name="ExternalLink" size={13} />
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}
    </details>
  )
}
