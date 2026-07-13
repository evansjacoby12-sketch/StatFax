const numberIn = (text = '') => text.match(/-?\d+(?:\.\d+)?/)?.[0] || null

export function nflSignalText(signal, level = 'eli5') {
  if (!signal || level === 'eli15') return signal?.text || ''
  const amount = numberIn(signal.text)
  const games = signal.games || amount
  const positive = !['warn', 'bad'].includes(signal.tone)

  switch (signal.key) {
    case 'touchdown': return `Scored a touchdown in ${games} straight games`
    case 'receptions': return `Caught at least 3 passes in ${games} straight games`
    case 'passing': return `Threw for 200+ yards in ${games} straight games`
    case 'rushing': return `Ran for 40+ yards in ${games} straight games`
    case 'receiving': return `Had 50+ receiving yards in ${games} straight games`
    case 'rz-targets': return `Gets plenty of throws close to the end zone${amount ? ` (${amount} recently)` : ''}`
    case 'rz-touches': return `Gets the ball often close to the end zone${amount ? ` (${amount} recent chances)` : ''}`
    case 'goal-line': return 'Usually gets the ball when the team is one short play from scoring'
    case 'target-share': return `Gets about ${amount || 'a large share of'}% of his team's throws`
    case 'snap-share': return `Stays on the field for about ${amount || 'most'}% of the plays`
    case 'lineup-confirmed': return 'His spot in the lineup is confirmed'
    case 'role-inheritance': return 'Should get extra chances because a teammate is out'
    case 'route-participation': return 'Runs a route on most passing plays'
    case 'goal-line-package': return 'The team uses him in its close-to-the-end-zone scoring group'
    case 'snap-limit': return `May play fewer snaps than usual${amount ? ` (about ${amount}% maximum)` : ''}`
    case 'split': return positive ? `This ${signal.text?.startsWith('Away') ? 'away' : 'home'} setting has helped him` : `This ${signal.text?.startsWith('Away') ? 'away' : 'home'} setting has hurt him`
    default: return signal.text || 'The model found a useful player trend'
  }
}

export function nflSignalCaption(level = 'eli5') {
  return level === 'eli5' ? 'Why it matters' : 'Active model evidence'
}
