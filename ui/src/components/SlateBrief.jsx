import Icon from './Icon.jsx'

// Today's Slate Brief — the server-generated one-paragraph board summary
// (slate-brief.mjs → dist/brief.json). Advisory prose over the already-scored
// board; renders nothing when the brief wasn't generated.
export default function SlateBrief({ brief }) {
  if (!brief?.text) return null

  const prime = Number.isFinite(brief.primeCount) ? brief.primeCount : null
  const strong = Number.isFinite(brief.strongCount) ? brief.strongCount : null

  return (
    <section
      className="slate-brief"
      style={{
        background: 'linear-gradient(135deg, rgba(0,216,246,0.07) 0%, rgba(255,255,255,0.02) 100%)',
        border: '1px solid rgba(0,216,246,0.18)',
        borderRadius: '14px',
        padding: '14px 16px',
        marginBottom: '14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent)' }}>
          <Icon name="Sparkles" size={14} /> Today's Brief
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: 'auto' }}>
          {prime != null && (
            <span style={{ fontSize: '10px', fontWeight: '800', padding: '2px 7px', borderRadius: '6px', background: 'rgba(245,166,35,0.14)', color: 'var(--prime)' }}>
              {prime} PRIME
            </span>
          )}
          {strong != null && (
            <span style={{ fontSize: '10px', fontWeight: '800', padding: '2px 7px', borderRadius: '6px', background: 'rgba(16,185,129,0.12)', color: 'var(--strong)' }}>
              {strong} STRONG
            </span>
          )}
        </span>
      </div>
      <p style={{ fontSize: '13.5px', lineHeight: '1.55', color: 'var(--text)', margin: 0 }}>{brief.text}</p>
      <div style={{ fontSize: '9px', color: 'var(--text-faint)', marginTop: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        AI summary of the model's board · advisory only
      </div>
    </section>
  )
}
