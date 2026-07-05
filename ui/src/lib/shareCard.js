// Render a batter's pick as a 1080×1080 PNG — a share-anywhere image card
// (group chats, socials) drawn with the app's own palette. All canvas; no deps.

import { gradeColor } from './badges.js'
import { teamColor, playerHeadshot } from './teams.js'
import { hrSetup } from './scout.js'
import { american } from './format.js'

const BG = '#000000'
const ACCENT = '#00d8f6'
const DIM = '#8b98ab'
const FAINT = '#5b6b80'

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// Headshot loads cross-origin (img.mlbstatic.com sends CORS headers). If it
// doesn't arrive in time — or would taint the canvas — fall back to initials.
function loadImage(url, timeoutMs = 3500) {
  return new Promise((resolve) => {
    if (!url) return resolve(null)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const t = setTimeout(() => resolve(null), timeoutMs)
    img.onload = () => { clearTimeout(t); resolve(img) }
    img.onerror = () => { clearTimeout(t); resolve(null) }
    img.src = url
  })
}

function chip(ctx, x, y, text, { color = DIM, border = 'rgba(255,255,255,0.14)', bg = 'rgba(255,255,255,0.04)', size = 30 } = {}) {
  ctx.font = `700 ${size}px Inter, sans-serif`
  const w = ctx.measureText(text).width + 44
  roundRect(ctx, x, y, w, size + 26, 14)
  ctx.fillStyle = bg
  ctx.fill()
  ctx.strokeStyle = border
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(text, x + 22, y + (size + 26) / 2 + 2)
  return w
}

export async function renderPickCard(b) {
  await document.fonts?.ready?.catch?.(() => {})

  const W = 1080, H = 1080
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  const g = b.grade?.label || 'SKIP'
  const gc = gradeColor(g)
  const tc = teamColor(b.teamId)
  const hrPct = b.hrProbability != null ? `${(b.hrProbability * 100).toFixed(1)}%` : '—'
  const setup = hrSetup(b)
  const best = b.odds?.best

  // ── backdrop ──
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)
  let glow = ctx.createRadialGradient(220, 300, 0, 220, 300, 700)
  glow.addColorStop(0, `${tc}26`)
  glow.addColorStop(1, 'transparent')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)
  glow = ctx.createRadialGradient(W - 120, H - 160, 0, W - 120, H - 160, 600)
  glow.addColorStop(0, `${ACCENT}14`)
  glow.addColorStop(1, 'transparent')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // ── brand + date ──
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.font = '800 54px Inter, sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.fillText('Stat', 70, 110)
  ctx.fillStyle = ACCENT
  ctx.fillText('Fax', 70 + ctx.measureText('Stat').width, 110)
  ctx.font = '600 28px Inter, sans-serif'
  ctx.fillStyle = FAINT
  ctx.textAlign = 'right'
  const dateStr = b.game?.gameDate ? new Date(b.game.gameDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''
  ctx.fillText(`HR MODEL BOARD${dateStr ? ` · ${dateStr}` : ''}`, W - 70, 106)

  // ── headshot ──
  const img = await loadImage(playerHeadshot(b.playerId, 400))
  const cx = 250, cy = 420, r = 145
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  if (img) {
    const s = Math.max((r * 2) / img.width, (r * 2) / img.height) * 1.08
    ctx.fillStyle = '#0c1320'
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    ctx.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2 + 12, img.width * s, img.height * s)
  } else {
    ctx.fillStyle = '#0c1320'
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    ctx.font = '800 110px Inter, sans-serif'
    ctx.fillStyle = tc
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const initials = (b.name || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('')
    ctx.fillText(initials, cx, cy)
  }
  ctx.restore()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.strokeStyle = gc
  ctx.lineWidth = 7
  ctx.shadowColor = gc
  ctx.shadowBlur = 26
  ctx.stroke()
  ctx.shadowBlur = 0

  // ── name / matchup / grade ──
  const rx = 460
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  let nameSize = 66
  ctx.font = `800 ${nameSize}px Inter, sans-serif`
  while (ctx.measureText(b.name || '').width > W - rx - 70 && nameSize > 38) {
    nameSize -= 4
    ctx.font = `800 ${nameSize}px Inter, sans-serif`
  }
  ctx.fillStyle = '#ffffff'
  ctx.fillText(b.name || '', rx, 350)
  ctx.font = '600 32px Inter, sans-serif'
  ctx.fillStyle = DIM
  const pitcher = b.pitcher?.name ? `vs ${b.pitcher.name}${b.pitcher.hand ? ` (${b.pitcher.hand}HP)` : ''}` : 'vs TBD'
  ctx.fillText(`${b.team || ''} · ${pitcher}`, rx, 404)

  ctx.font = '800 34px Inter, sans-serif'
  const gradeTxt = `${g} ${Math.round(b.score ?? 0)}`
  const gw = ctx.measureText(gradeTxt).width + 56
  roundRect(ctx, rx, 445, gw, 64, 16)
  ctx.fillStyle = `${gc}22`
  ctx.fill()
  ctx.strokeStyle = gc
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.fillStyle = gc
  ctx.textBaseline = 'middle'
  ctx.fillText(gradeTxt, rx + 28, 445 + 34)

  if (b.precision) {
    ctx.font = '800 30px Inter, sans-serif'
    ctx.textBaseline = 'middle'
    const pt = '✦ PRECISION PLAY'
    const pw = ctx.measureText(pt).width + 56
    roundRect(ctx, rx + gw + 20, 445, pw, 64, 16)
    ctx.fillStyle = `${ACCENT}1f`
    ctx.fill()
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.fillStyle = ACCENT
    ctx.fillText(pt, rx + gw + 48, 445 + 34)
  }

  // ── hero HR% ──
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.font = '700 30px Inter, sans-serif'
  ctx.fillStyle = FAINT
  ctx.fillText('HR PROBABILITY', 90, 705)
  ctx.font = '800 176px "JetBrains Mono", Inter, monospace'
  ctx.fillStyle = gc
  ctx.shadowColor = gc
  ctx.shadowBlur = 44
  ctx.fillText(hrPct, 82, 880)
  ctx.shadowBlur = 0

  // ── stat chips ──
  let chy = 930
  let chx = 90
  chx += chip(ctx, chx, chy, `Heat ${b.heatIndex ?? '—'}`, { color: '#ff9f43', border: 'rgba(255,159,67,0.4)', bg: 'rgba(255,159,67,0.08)' }) + 18
  chx += chip(ctx, chx, chy, `HR Setup ${setup.n}/6`, {
    color: setup.n >= 5 ? '#f5a623' : DIM,
    border: setup.n >= 5 ? 'rgba(245,166,35,0.5)' : 'rgba(255,255,255,0.14)',
    bg: setup.n >= 5 ? 'rgba(245,166,35,0.1)' : 'rgba(255,255,255,0.04)',
  }) + 18
  if (best?.american) chx += chip(ctx, chx, chy, `Best ${american(best.american)}`, { color: '#32d74b', border: 'rgba(50,215,75,0.4)', bg: 'rgba(50,215,75,0.08)' }) + 18

  // ── footer ──
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(70, H - 62)
  ctx.lineTo(W - 70, H - 62)
  ctx.stroke()
  ctx.font = '700 26px Inter, sans-serif'
  ctx.fillStyle = FAINT
  ctx.textAlign = 'left'
  ctx.fillText('statfax.online', 70, H - 22)
  ctx.textAlign = 'right'
  ctx.fillText('model output · not betting advice', W - 70, H - 22)

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('render failed'))), 'image/png')
    } catch (e) {
      reject(e) // tainted canvas etc.
    }
  })
}

// Share the card via the native sheet when possible, else download it.
export async function sharePickCard(b) {
  const blob = await renderPickCard(b)
  const file = new File([blob], `${(b.name || 'pick').replace(/\s+/g, '-')}-statfax.png`, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `${b.name} — StatFax pick` })
      return 'shared'
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled'
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}
