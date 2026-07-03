import { useEffect, useMemo } from 'react'

const COLORS = ['#00d8f6', '#f5a623', '#10b981', '#ff5c5c', '#8b5cf6', '#facc15', '#fff']

// CSS-only confetti burst for the big moments (parlay cashed). Renders ~60
// falling pieces with randomized drift/spin, then calls onDone so the parent
// unmounts it. Skipped entirely under prefers-reduced-motion.
export default function Confetti({ duration = 4200, onDone }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 60 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.7,
        fall: 2.2 + Math.random() * 1.6,
        size: 6 + Math.random() * 6,
        color: COLORS[i % COLORS.length],
        spin: Math.random() > 0.5 ? 1 : -1,
        drift: (Math.random() - 0.5) * 120,
      })),
    [],
  )

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      onDone?.()
      return
    }
    const t = setTimeout(() => onDone?.(), duration)
    return () => clearTimeout(t)
  }, [duration, onDone])

  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null

  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${p.size * 0.45}px`,
            background: p.color,
            animationDuration: `${p.fall}s`,
            animationDelay: `${p.delay}s`,
            '--drift': `${p.drift}px`,
            '--spin': p.spin,
          }}
        />
      ))}
    </div>
  )
}
