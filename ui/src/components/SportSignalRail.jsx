import Icon from './Icon.jsx'

export default function SportSignalRail({ sport, filters, values, counts, total, onToggleFilter, onClear, open, onToggleOpen, label = 'Signals' }) {
  const listId = `${sport}-signal-filter-list`
  return <div className={`sport-signal-rail ${open ? '' : 'is-collapsed'}`} aria-label={`Filter ${sport.toUpperCase()} props by signal`}>
    <button type="button" className="sport-signal-label" aria-expanded={open} aria-controls={listId} onClick={onToggleOpen} title={open ? `Collapse ${label.toLowerCase()}` : `Expand ${label.toLowerCase()}`}><Icon name="SlidersHorizontal" size={12} /><span>{label}</span><Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={11} className="sport-signal-chevron" /></button>
    {open && <div className="sport-signal-scroll" id={listId}>
      <button type="button" className={`sport-signal-chip ${values.size === 0 ? 'active' : ''}`} aria-pressed={values.size === 0} onClick={onClear}><span>Any</span><b className="mono">{total}</b></button>
      {filters.map((filter) => {
        const count = counts[filter.id] || 0
        const active = values.has(filter.id)
        return <button type="button" key={filter.id} className={`sport-signal-chip ${active ? 'active' : ''} ${count === 0 ? 'zero-count' : ''}`} data-signal-tone={filter.tone || undefined} aria-pressed={active} onClick={() => onToggleFilter(filter.id)}><Icon name={filter.icon} size={11} /><span>{filter.label}</span><b className="mono">{count}</b></button>
      })}
    </div>}
  </div>
}
