import Icon from './Icon.jsx'
import CommandTabs from './CommandTabs.jsx'

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
  embedded = false,
}) {
  const workspace = (
      <section className={`${embedded ? '' : 'modal '}workspace-modal workspace-${size} ${embedded ? 'workspace-embedded' : ''}`.trim()} role={embedded ? 'region' : 'dialog'} aria-modal={embedded ? undefined : true} aria-label={title}>
        {!embedded && <button type="button" className="drawer-close icon-btn workspace-close" onClick={onClose} aria-label={`Close ${title}`}>
          <Icon name="X" size={18} />
        </button>}

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
          <CommandTabs
            as="nav"
            className="workspace-tabs"
            label={`${title} modes`}
            value={activeTab}
            onChange={onTabChange}
            tabs={tabs.map((tab) => ({ ...tab, iconSize: 14 }))}
          />
        )}

        <div className="workspace-body">{children}</div>
      </section>
  )

  if (embedded) return workspace
  return (
    <>
      <div className="drawer-scrim workspace-scrim" onClick={onClose} />
      {workspace}
    </>
  )
}
