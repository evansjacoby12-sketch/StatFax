import Icon from './Icon.jsx'
import Select from './Select.jsx'

export default function SportMultiFilterBar({ sport, searchValue, onSearch, searchPlaceholder, filters, children, className = '' }) {
  return <div className={`sport-filter-bar ${sport}-filters ${className}`.trim()}>
    <label className={`sport-filter-search ${sport}-search`}><Icon name="Search" size={15} /><span className="sr-only">Search players</span><input value={searchValue} onChange={(event) => onSearch(event.target.value)} placeholder={searchPlaceholder} /></label>
    {filters.map((filter) => <Select key={filter.id} multi value={filter.value} onChange={filter.onChange} ariaLabel={filter.label} options={filter.options} />)}
    {children}
  </div>
}
