import Icon from './Icon.jsx'

// Central home for the app's optional, persisted preferences — pulled out of the
// header and the combos controls so they live in one place.
export default function Settings({
  liveScores, onToggleLive,
  autoRefresh, onToggleAuto,
  windowMode, onToggleWindows,
  showDayRating, onToggleDayRating,
  splitProjected, onToggleSplit,
  comboConf, onSetComboConf,
  comboLock, onToggleComboLock,
  eliLevel, onSetEli,
  betaCeil, onToggleBetaCeil,
  onClose,
}) {
  const groups = [
    {
      title: 'Display',
      rows: [
        {
          icon: 'Activity',
          label: 'Live scores',
          desc: 'Show live scores + innings and auto-update while games are in progress. Off = a clean pregame look.',
          on: liveScores,
          toggle: onToggleLive,
        },
        {
          icon: 'Gauge',
          label: 'Day Rating',
          desc: 'Show the 1-5★ "should I bet HR props today?" gauge at the top of the board.',
          on: showDayRating,
          toggle: onToggleDayRating,
        },
        {
          icon: 'List',
          label: 'Lineup grouping',
          desc: 'Keep confirmed-lineup plays on top and group not-yet-posted (projected) bats under a collapsible divider, so the board stops reshuffling before lineups drop. Off = one flat board ranked purely by your sort.',
          on: splitProjected,
          toggle: onToggleSplit,
        },
        {
          icon: 'Sparkles',
          label: 'Explanation level',
          desc: 'How the "Why" picks are worded across the site. ELI5 = plain English, no jargon. ELI15 = the stats behind each call.',
          segments: [['eli5', 'ELI5'], ['eli15', 'ELI15']],
          value: eliLevel,
          onSet: onSetEli,
        },
      ],
    },
    {
      title: 'Updates',
      rows: [
        {
          icon: 'Radio',
          label: 'Auto-refresh',
          desc: 'Reload the slate every 60 seconds (handy during live games). Off = manual refresh only.',
          on: autoRefresh,
          toggle: onToggleAuto,
        },
      ],
    },
    {
      title: 'Parlay Combos',
      rows: [
        {
          icon: 'Clock',
          label: 'Start-window grouping',
          desc: 'Group the slate into start windows on the Combos page, so you can build same-window combos that lock together — no staggered-start trap.',
          on: windowMode,
          toggle: onToggleWindows,
        },
        {
          icon: 'Trophy',
          label: 'Combo confidence',
          desc: 'Show the actual chance every leg homers (all-hit %) on each combo.',
          segments: [['off', 'Off'], ['percent', 'All-hit %']],
          value: comboConf,
          onSet: onSetComboConf,
        },
        {
          icon: 'Lock',
          label: 'Morning combo lock',
          desc: 'Pin the combo board to its morning-lock picks (heat, park, edge signals frozen), so the legs don’t re-rank through the day. Off = the board rebuilds live from current signals. Takes effect from the next morning lock; a pitcher change still re-ranks that bat.',
          on: comboLock,
          toggle: onToggleComboLock,
        },
      ],
    },
    {
      title: 'Beta (unvalidated)',
      rows: [
        {
          icon: 'Sparkles',
          label: 'Ceiling & Form',
          desc: 'Preview the experimental raw-power Ceiling and recent-Form scores in the player drawer (Statcast tab). NOT a betting signal — it never affects any pick, grade, or probability, and is being forward-tested against real HR results. It only joins the real board if it beats the base rate.',
          on: betaCeil,
          toggle: onToggleBetaCeil,
        },
      ],
    },
  ]

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="modal settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <button className="drawer-close icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="X" size={18} />
        </button>
        <div className="model-head">
          <h2>
            <Icon name="SlidersHorizontal" size={18} /> Settings
          </h2>
          <div className="model-sub dim">Optional features, all in one place — saved on this device.</div>
        </div>

        {groups.map((g) => (
          <div key={g.title}>
            <h3 className="section-title" style={{ marginTop: 16 }}>{g.title}</h3>
            <div className="set-list">
              {g.rows.map((r) => (
                <div className="set-row" key={r.label}>
                  <span className="set-ico"><Icon name={r.icon} size={16} /></span>
                  <span className="set-txt">
                    <b>{r.label}</b>
                    <span className="dim">{r.desc}</span>
                  </span>
                  {r.segments ? (
                    <span className="set-seg" role="group" aria-label={r.label}>
                      {r.segments.map(([val, lbl]) => (
                        <button
                          key={val}
                          className={`set-seg-btn ${r.value === val ? 'on' : ''}`}
                          onClick={() => r.onSet(val)}
                          aria-pressed={r.value === val}
                        >
                          {lbl}
                        </button>
                      ))}
                    </span>
                  ) : (
                    <button
                      className={`set-switch ${r.on ? 'on' : ''}`}
                      onClick={r.toggle}
                      role="switch"
                      aria-checked={r.on}
                      aria-label={r.label}
                    >
                      <span className="set-knob" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
