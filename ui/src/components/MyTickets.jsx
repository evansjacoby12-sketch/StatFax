import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { pct, american, surname, signedPct } from '../lib/format.js'
import { useTickets, makeTicket } from '../lib/tickets.js'
import { gradeTicket, summarizeTickets, ticketEconomics } from '../lib/ticketMath.js'

export const TICKET_STATUS_META = {
  cashed: { label: 'CASHED', color: 'var(--strong)', icon: 'Check' },
  dead: { label: 'DEAD', color: 'var(--bad)', icon: 'X' },
  live: { label: 'LIVE', color: 'var(--accent)', icon: 'Activity' },
  pending: { label: 'PENDING', color: 'var(--text-dim)', icon: 'Clock' },
  unknown: { label: 'UNKNOWN', color: 'var(--text-faint)', icon: 'HelpCircle' },
}

const LEG_ICON = { hit: 'Check', dead: 'X', live: 'Activity', pending: 'Clock', unknown: 'Minus' }
const LEG_COLOR = { hit: 'var(--strong)', dead: 'var(--bad)', live: 'var(--accent)', pending: 'var(--text-faint)', unknown: 'var(--text-faint)' }

const unit = (value, signed = false) => {
  if (!Number.isFinite(value)) return '—'
  const prefix = signed && value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(Math.abs(value) >= 10 ? 1 : 2)}u`
}

export default function MyTickets({ batters = [], slateDate = null, onSelect, compact = false, limit = null }) {
  const { tickets, toggle, remove, update, settle } = useTickets()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editWager, setEditWager] = useState('')
  const [editOdds, setEditOdds] = useState('')

  const graded = useMemo(() => tickets.map((ticket) => gradeTicket(ticket, batters)), [tickets, batters])
  const summary = useMemo(() => summarizeTickets(graded), [graded])

  useEffect(() => {
    for (const item of graded) {
      if (!item.ticket.settled && item.status !== 'unknown' && item.status !== 'live' && item.status !== 'pending' && item.allFinal) {
        settle(item.ticket.id, item.status === 'cashed')
      }
    }
  }, [graded, settle])

  const beginEdit = (item) => {
    setEditingId(item.ticket.id)
    setEditWager(item.ticket.wager ?? '')
    setEditOdds(item.ticket.american ?? '')
  }

  const saveEdit = (item) => {
    const wager = Number(editWager)
    const odds = Number(editOdds)
    update(item.ticket.id, {
      wager: Number.isFinite(wager) && wager > 0 ? wager : null,
      american: Number.isFinite(odds) && odds !== 0 ? odds : null,
    })
    setEditingId(null)
  }

  const shareTicket = async (item) => {
    const economics = ticketEconomics(item.ticket, item.status)
    const legs = item.legs.map((leg) => surname(leg.name)).join(' · ')
    const text = `StatFax ticket · ${TICKET_STATUS_META[item.status].label}\n${legs}\n${item.n}-leg${Number.isFinite(item.ticket.allHitPct) ? ` · model ${pct(item.ticket.allHitPct, 2)}` : ''}${Number.isFinite(economics.american) ? ` · ${american(economics.american)}` : ''}`
    try {
      if (navigator.share) await navigator.share({ title: 'StatFax ticket', text })
      else await navigator.clipboard.writeText(text)
    } catch {
      // A dismissed native share sheet needs no error state.
    }
  }

  if (!tickets.length && !adding) {
    return (
      <div className="ticket-empty">
        <div><Icon name="Bookmark" size={20} /><span><b>No tracked tickets yet</b><small>Track a combo or log a ticket to build an honest personal record.</small></span></div>
        <button type="button" className="mt-add-btn" onClick={() => setAdding(true)}><Icon name="Plus" size={14} /> Log a ticket</button>
      </div>
    )
  }

  const visible = limit ? graded.slice(0, limit) : graded

  return (
    <div className={`ticket-ledger ${compact ? 'compact' : ''}`}>
      <div className="ticket-ledger-head">
        <div className="ticket-ledger-summary">
          <span><b>{summary.wins}/{summary.settled}</b><small>settled</small></span>
          <span><b className={summary.net >= 0 ? 'pos' : 'neg'}>{summary.pricedSettled ? unit(summary.net, true) : '—'}</b><small>net units</small></span>
          <span><b>{summary.roi != null ? signedPct(summary.roi, 1) : '—'}</b><small>ROI</small></span>
          <span><b className="accent">{summary.open}</b><small>open</small></span>
        </div>
        {!compact && (
          <button type="button" className="mt-add-btn" onClick={() => setAdding((value) => !value)}>
            <Icon name={adding ? 'X' : 'Plus'} size={14} /> {adding ? 'Close' : 'Log ticket'}
          </button>
        )}
      </div>

      {summary.settled > summary.pricedSettled && (
        <div className="ticket-ledger-note"><Icon name="Info" size={13} /> ROI uses only the {summary.pricedSettled} settled {summary.pricedSettled === 1 ? 'ticket' : 'tickets'} with both wager and odds.</div>
      )}

      {adding && <AddTicket batters={batters} slateDate={slateDate} onDone={() => setAdding(false)} onAdd={toggle} />}

      <ul className="ticket-list">
        {visible.map((item) => {
          const meta = TICKET_STATUS_META[item.status]
          const economics = ticketEconomics(item.ticket, item.status)
          const canEdit = item.status === 'pending' || item.status === 'unknown'
          const isEditing = editingId === item.ticket.id
          return (
            <li className={`ticket-card status-${item.status}`} key={item.ticket.id}>
              <div className="ticket-card-head">
                <span className="ticket-status" style={{ color: meta.color }}><Icon name={meta.icon} size={12} className={item.status === 'live' ? 'spin-pulse' : ''} /> {meta.label}</span>
                <span className="ticket-card-date mono">{item.ticket.date ? String(item.ticket.date).slice(5) : 'No date'} · {item.hits}/{item.n} hit</span>
                <span className="ticket-card-price mono">{economics.american != null ? american(economics.american) : 'Odds needed'}</span>
              </div>

              <div className="ticket-card-body">
                <div className="ticket-leg-list">
                  {item.legs.map((leg) => (
                    <button type="button" key={`${leg.playerId}-${leg.gamePk || ''}`} onClick={() => onSelect?.(leg.batter || { ...leg, id: leg.playerId })}>
                      <span><b>{leg.name}</b><small>{leg.team}{leg.opponent ? ` vs ${leg.opponent}` : ''}</small></span>
                      <span style={{ color: LEG_COLOR[leg.code] }}><Icon name={LEG_ICON[leg.code]} size={11} /> {leg.statusLabel}</span>
                    </button>
                  ))}
                </div>

                <div className="ticket-economics">
                  <span><small>Model all-hit</small><b className="mono">{Number.isFinite(item.ticket.allHitPct) ? pct(item.ticket.allHitPct, item.ticket.allHitPct < 0.01 ? 2 : 1) : '—'}</b></span>
                  <span><small>Wager</small><b className="mono">{economics.wager != null ? unit(economics.wager) : '—'}</b></span>
                  <span><small>{item.status === 'cashed' || item.status === 'dead' ? 'Net result' : 'Potential payout'}</small><b className={`mono ${economics.profit != null ? economics.profit >= 0 ? 'pos' : 'neg' : ''}`}>{economics.profit != null ? unit(economics.profit, true) : economics.projectedPayout != null ? unit(economics.projectedPayout) : '—'}</b></span>
                </div>
              </div>

              {isEditing && (
                <div className="ticket-edit-row">
                  <label><span>Wager units</span><input type="number" inputMode="decimal" min="0" step="0.25" value={editWager} onChange={(event) => setEditWager(event.target.value)} /></label>
                  <label><span>American odds</span><input type="number" inputMode="numeric" step="5" value={editOdds} onChange={(event) => setEditOdds(event.target.value)} placeholder="+450" /></label>
                  <button type="button" onClick={() => saveEdit(item)}><Icon name="Check" size={13} /> Save</button>
                </div>
              )}

              <div className="ticket-card-foot">
                <span>{item.ticket.label || item.ticket.strategy} · original ticket preserved</span>
                <div>
                  {canEdit && !compact && <button type="button" onClick={() => isEditing ? setEditingId(null) : beginEdit(item)} aria-label={`Edit ${item.ticket.label || 'ticket'}`}><Icon name={isEditing ? 'X' : 'Pencil'} size={14} /></button>}
                  <button type="button" onClick={() => shareTicket(item)} aria-label="Share ticket"><Icon name="Share2" size={14} /></button>
                  {!compact && <button type="button" onClick={() => remove(item.ticket.id)} aria-label="Remove ticket"><Icon name="Trash2" size={14} /></button>}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function AddTicket({ batters, slateDate, onDone, onAdd }) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState([])
  const [wager, setWager] = useState('1')
  const [odds, setOdds] = useState('')

  const pool = useMemo(() => (batters || [])
    .filter((batter) => batter.grade?.label === 'PRIME' || batter.grade?.label === 'STRONG' || (batter.grade && batter.grade !== 'SKIP'))
    .filter((batter) => !query || batter.name.toLowerCase().includes(query.toLowerCase()) || (batter.team || '').toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 40), [batters, query])

  const batterKey = (batter) => batter?.id ?? `${batter?.playerId}-${batter?.gamePk ?? '?'}`
  const gameLabel = (batter) => {
    if (Number.isFinite(batter?.game?.gameNumber)) return `G${batter.game.gameNumber}`
    const time = batter?.game?.gameDate ? new Date(batter.game.gameDate) : null
    return time && Number.isFinite(time.getTime())
      ? time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : `Game ${batter?.gamePk ?? '?'}`
  }
  const pickedIds = new Set(picked.map(batterKey))
  const toggle = (batter) => setPicked((current) => current.some((item) => batterKey(item) === batterKey(batter))
    ? current.filter((item) => batterKey(item) !== batterKey(batter))
    : current.length >= 4 ? current : [...current, batter])

  const save = () => {
    if (picked.length < 1) return
    const wagerNumber = Number(wager)
    const oddsNumber = Number(odds)
    const allHit = picked.every((batter) => Number.isFinite(batter.hrProbability))
      ? picked.reduce((product, batter) => product * batter.hrProbability, 1)
      : null
    onAdd(makeTicket({
      legs: picked,
      date: slateDate,
      strategy: 'custom',
      label: 'My ticket',
      size: picked.length,
      allHit,
      wager: Number.isFinite(wagerNumber) && wagerNumber > 0 ? wagerNumber : null,
      american: Number.isFinite(oddsNumber) && oddsNumber !== 0 ? oddsNumber : null,
    }))
    setPicked([])
    setQuery('')
    onDone()
  }

  return (
    <div className="ticket-add-form">
      <div className="ticket-add-head"><span><b>Log the ticket you actually placed</b><small>Pick 1–4 legs. Odds and wager unlock honest ROI.</small></span><span>{picked.length}/4 legs</span></div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a hitter to add…" aria-label="Search ticket players" />
      {picked.length > 0 && <div className="ticket-picked">{picked.map((batter) => <button type="button" key={batterKey(batter)} onClick={() => toggle(batter)}>{surname(batter.name)} {gameLabel(batter)} <Icon name="X" size={10} /></button>)}</div>}
      <div className="ticket-player-pool">
        {pool.map((batter) => (
          <button type="button" key={batterKey(batter)} onClick={() => toggle(batter)} disabled={!pickedIds.has(batterKey(batter)) && picked.length >= 4} className={pickedIds.has(batterKey(batter)) ? 'on' : ''}>
            <Icon name={pickedIds.has(batterKey(batter)) ? 'CheckSquare' : 'Square'} size={14} />
            <span><b>{batter.name}</b><small>{batter.team} · {gameLabel(batter)} · {batter.grade?.label || batter.grade}</small></span>
            <span className="mono">{pct(batter.hrProbability, 1)}</span>
          </button>
        ))}
      </div>
      <div className="ticket-add-economics">
        <label><span>Wager units</span><input type="number" inputMode="decimal" min="0" step="0.25" value={wager} onChange={(event) => setWager(event.target.value)} /></label>
        <label><span>American odds</span><input type="number" inputMode="numeric" step="5" value={odds} onChange={(event) => setOdds(event.target.value)} placeholder="+450" /></label>
        <button type="button" onClick={save} disabled={picked.length < 1}><Icon name="Check" size={14} /> Track ticket</button>
      </div>
    </div>
  )
}
