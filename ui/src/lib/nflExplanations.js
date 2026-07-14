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
    case 'end-zone-alpha': return `Gets ${amount || 'a large share of'}% of his team's end-zone throws`
    case 'goal-to-go-dominator': return `Gets ${amount || 'most'}% of his team's chances right next to the goal line`
    case 'opportunity-spike': return `His recent chances increased by about ${amount || '20'}%`
    case 'drive-participation': return `Regularly plays on the team's scoring drives${amount ? ` (${amount}%)` : ''}`
    case 'committee-risk': return `Shares backfield work and gets only about ${amount || 'half'}% of the carries`
    case 'defense-funnel': return `This defense tends to allow production to ${signal.text?.split(' ').at(-1) || 'his position'}`
    case 'qb-keeper-threat': return `The quarterback has ${amount || 'several'} recent runs near the goal line`
    case 'scoring-role-lost': return `His recent opportunities dropped by about ${amount || '25'}%`
    case 'air-yards-leader': return `Owns about ${amount || 'a large share of'}% of his team's downfield passing opportunities`
    case 'yac-creator': return `Creates about ${amount || '1.5'} more yards after each catch than expected`
    case 'rushing-over-expected': return `Gains about ${amount || '0.5'} more rushing yards per attempt than expected`
    case 'separation-edge': return `Creates about ${amount || '3.2'} yards of space from the nearest defender`
    case 'protection-mismatch': return `His pass protection faces a defense generating pressure on about ${amount || '28'}% of dropbacks`
    case 'quick-pressure-risk': return `The opponent creates quick pressure on about ${amount || '25'}% of dropbacks`
    case 'split': return positive ? `This ${signal.text?.startsWith('Away') ? 'away' : 'home'} setting has helped him` : `This ${signal.text?.startsWith('Away') ? 'away' : 'home'} setting has hurt him`
    default: return signal.text || 'The model found a useful player trend'
  }
}

export function nflSignalCaption(level = 'eli5') {
  return level === 'eli5' ? 'Why it matters' : 'Active model evidence'
}
