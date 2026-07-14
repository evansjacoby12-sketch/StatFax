import Icon from './Icon.jsx'

export default function SportMarketRail({ sport, markets, value, onChange, icons = {}, ariaLabel }) {
  return <div className={`sport-market-rail ${sport}-market-rail`} role="tablist" aria-label={ariaLabel || `${sport.toUpperCase()} market`}>
    {markets.map((market) => <button key={market.id} type="button" role="tab" aria-selected={value === market.id} className={value === market.id ? 'active' : ''} onClick={() => onChange(market.id)}>
      {icons[market.id] && <Icon name={icons[market.id]} size={13} />}{market.shortLabel || market.label}
    </button>)}
  </div>
}
