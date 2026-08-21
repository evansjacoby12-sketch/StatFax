import Icon from './Icon.jsx'

// Only user-facing behavior belongs here. Model, parlay, and experimental
// policy stays deterministic so a forgotten device toggle cannot change calls.
export default function Settings({
  liveUpdates, onToggleLiveUpdates,
  comboLock, onToggleComboLock,
  eliLevel, onSetEli,
  onClose,
  embedded = false,
}) {
  const groups = [
    {
      title: 'App behavior',
      rows: [
        {
          icon: 'Activity',
          label: 'Live updates',
          desc: 'Show live scores and refresh the slate every 60 seconds. Off keeps a stable pregame view with manual refresh.',
          on: liveUpdates,
          toggle: onToggleLiveUpdates,
        },
        {
          icon: 'Lock',
          label: 'Morning combo lock',
          desc: 'Freeze parlay combos at the morning lock time so the legs you see match the settled outcomes next day. Off ranks combos live.',
          on: comboLock,
          toggle: onToggleComboLock,
        },
      ],
    },
    {
      title: 'Explanation',
      rows: [
        {
          icon: 'Sparkles',
          label: 'Explanation level',
          desc: 'Choose plain-English ELI5 wording or the underlying ELI15 statistics anywhere StatFax explains a pick.',
          segments: [['eli5', 'ELI5'], ['eli15', 'ELI15']],
          value: eliLevel,
          onSet: onSetEli,
        },
      ],
    },
  ]

  return (
    <>
      {!embedded && <div className="drawer-scrim" onClick={onClose} />}
      <div className={embedded ? 'settings-embedded' : 'modal settings-modal'} role={embedded ? 'tabpanel' : 'dialog'} aria-modal={embedded ? undefined : 'true'} aria-label="Settings">
        {!embedded && <button className="drawer-close icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="X" size={18} />
        </button>}
        <div className="model-head">
          <h2><Icon name="SlidersHorizontal" size={18} /> Settings</h2>
          <div className="model-sub dim">Only preferences that change how you use the app. Saved on this device.</div>
        </div>

        {groups.map((group) => (
          <div key={group.title}>
            <h3 className="section-title" style={{ marginTop: 16 }}>{group.title}</h3>
            <div className="set-list">
              {group.rows.map((row) => (
                <div className="set-row" key={row.label}>
                  <span className="set-ico"><Icon name={row.icon} size={16} /></span>
                  <span className="set-txt"><b>{row.label}</b><span className="dim">{row.desc}</span></span>
                  {row.segments ? (
                    <span className="set-seg" role="group" aria-label={row.label}>
                      {row.segments.map(([value, label]) => (
                        <button key={value} className={`set-seg-btn ${row.value === value ? 'on' : ''}`} onClick={() => row.onSet(value)} aria-pressed={row.value === value}>{label}</button>
                      ))}
                    </span>
                  ) : (
                    <button className={`set-switch ${row.on ? 'on' : ''}`} onClick={row.toggle} role="switch" aria-checked={row.on} aria-label={row.label}>
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
