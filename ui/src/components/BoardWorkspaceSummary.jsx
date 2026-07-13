import Icon from './Icon.jsx'

export default function BoardWorkspaceSummary({ watchCount, slipCount, onWatchlist, onBuilder }) {
  return (
    <section className="board-workspace-summary" aria-label="Current workspace">
      <div className="bws-head"><Icon name="Layers" size={12} /> Current workspace</div>
      <div className="bws-actions">
        <button type="button" onClick={onWatchlist}>
          <Icon name="Star" size={14} />
          <span><b className="mono">{watchCount}</b><small>Watching</small></span>
          <Icon name="ChevronRight" size={13} />
        </button>
        <button type="button" onClick={onBuilder}>
          <Icon name="GitMerge" size={14} />
          <span><b className="mono">{slipCount}</b><small>In slip</small></span>
          <Icon name="ChevronRight" size={13} />
        </button>
      </div>
    </section>
  )
}
