// Deterministic status-bar inset. iOS standalone PWAs proved unreliable at
// reporting env(safe-area-inset-top) — some installs resolve it to 0 while
// still drawing the app UNDER the clock, which clipped the header brand no
// matter how the CSS stated the inset. So: measure env() for real via a probe
// element, and when it reads 0 in a provably fullscreen standalone context,
// fall back to the device's status-bar height estimated from screen size.
// The result lands in --safe-top, which the header consumes.

function statusBarEstimate() {
  // Portrait logical heights: Dynamic Island models (852/874/932/956) use a
  // 59pt bar, notch models (780/812/844/896/926) 47pt, legacy squares 20pt.
  const h = Math.max(window.screen?.height || 0, window.screen?.width || 0)
  if (h >= 852) return 59
  if (h >= 780) return 47
  return 20
}

export function applySafeAreaFix() {
  const set = () => {
    let measured = 0
    try {
      const probe = document.createElement('div')
      probe.style.cssText = 'position:fixed;top:0;left:0;height:env(safe-area-inset-top,0px);width:1px;visibility:hidden;pointer-events:none'
      document.body.appendChild(probe)
      measured = probe.getBoundingClientRect().height
      probe.remove()
    } catch { /* probe is best-effort */ }

    const standalone = window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches
    // Fullscreen check: when iOS lays the app out UNDER the status bar, the
    // viewport spans the whole screen. When it's laid out below the bar,
    // innerHeight is meaningfully shorter and no inset is needed.
    const fullscreen = Math.abs((window.screen?.height || 0) - window.innerHeight) <= 2
    const fallback = standalone && fullscreen && measured === 0 ? statusBarEstimate() : 0

    document.documentElement.style.setProperty('--safe-top', `${Math.max(measured, fallback)}px`)
  }
  set()
  window.addEventListener('resize', set)
  window.addEventListener('orientationchange', () => setTimeout(set, 250))
}
