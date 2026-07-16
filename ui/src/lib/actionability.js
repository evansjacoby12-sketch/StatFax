export function lineupActionability(batter) {
  const confirmed = batter?.lineupConfirmed === true
  const battingOrder = Number.isFinite(batter?.battingOrder) ? batter.battingOrder : null

  if (confirmed && battingOrder == null) {
    return {
      key: 'out',
      actionReady: false,
      icon: 'X',
      label: 'Not starting',
      shortLabel: 'Out',
    }
  }

  if (confirmed) {
    return {
      key: 'ready',
      actionReady: true,
      icon: 'UserRoundCheck',
      label: battingOrder ? `Action ready · #${battingOrder}` : 'Action ready',
      shortLabel: 'Ready',
    }
  }

  return {
    key: 'projected',
    actionReady: false,
    icon: 'Clock3',
    label: battingOrder ? `Projected · #${battingOrder}` : 'Projected · research ready',
    shortLabel: 'Projected',
  }
}

export function selectTopModelPick(batters = []) {
  const eligible = batters.filter((batter) => {
    const grade = batter?.grade?.label || batter?.grade || 'SKIP'
    return grade !== 'SKIP' && lineupActionability(batter).key !== 'out'
  })

  return eligible.slice().sort(
    (a, b) =>
      (b.score ?? 0) - (a.score ?? 0) ||
      (b.hrProbability ?? 0) - (a.hrProbability ?? 0) ||
      (b.expectedHRs ?? 0) - (a.expectedHRs ?? 0) ||
      String(a.id ?? `${a.playerId}-${a.gamePk}`).localeCompare(String(b.id ?? `${b.playerId}-${b.gamePk}`)),
  )[0] || null
}
