import Icon from './Icon.jsx'

// Central home for the app's optional, persisted preferences — pulled out of the
// header and the combos controls so they live in one place.
export default function Settings({
  liveScores, onToggleLive,
  autoRefresh, onToggleAuto,
  windowMode, onToggleWindows,
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
                  <button
                    className={`set-switch ${r.on ? 'on' : ''}`}
                    onClick={r.toggle}
                    role="switch"
                    aria-checked={r.on}
                    aria-label={r.label}
                  >
                    <span className="set-knob" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
