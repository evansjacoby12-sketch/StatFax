import Icon from './Icon.jsx'

export default function WorkspaceShell({
  icon,
  eyebrow,
  title,
  description,
  tabs = [],
  activeTab,
  onTabChange,
  onClose,
  children,
  size = 'wide',
  status = 'Saved on this device',
}) {
  return (
    <>
      <div className="drawer-scrim workspace-scrim" onClick={onClose} />
      <section className={`modal workspace-modal workspace-${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <button type="button" className="drawer-close icon-btn workspace-close" onClick={onClose} aria-label={`Close ${title}`}>
          <Icon name="X" size={18} />
        </button>

        <header className="workspace-head">
          <div className="workspace-head-icon"><Icon name={icon} size={18} /></div>
          <div className="workspace-head-copy">
            {eyebrow && <span>{eyebrow}</span>}
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          {status && <div className="workspace-state"><Icon name="CircleCheck" size={12} /> {status}</div>}
        </header>

        {tabs.length > 0 && (
          <nav className="workspace-tabs" role="tablist" aria-label={`${title} modes`}>
            {tabs.map((tab) => (
              <button
                type="button"
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => onTabChange(tab.id)}
              >
                <Icon name={tab.icon} size={14} />
                <span>{tab.label}</span>
                {tab.badge != null && <b className="mono">{tab.badge}</b>}
              </button>
            ))}
          </nav>
        )}

        <div className="workspace-body">{children}</div>
      </section>
    </>
  )
}
