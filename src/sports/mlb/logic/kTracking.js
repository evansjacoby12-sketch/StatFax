function gameStarted(game) {
  return game?.isLive === true || game?.isFinal === true
}

function gameCancelled(game) {
  return /postponed|cancelled|suspended/i.test(String(game?.status || ''))
}

/**
 * Refresh K estimates throughout pregame, then preserve the last estimate once
 * its individual game starts. Keys include gamePk, so doubleheaders remain
 * independent even when the same pitcher/player appears twice.
 */
export function mergeKEstimateRows(priorRows, currentRows, games, { capturedAt = new Date().toISOString() } = {}) {
  const priorByKey = new Map((priorRows || []).filter((row) => row?.key).map((row) => [row.key, row]))
  const currentByKey = new Map((currentRows || []).filter((row) => row?.key).map((row) => [row.key, row]))
  const gamesByPk = new Map((games || []).map((game) => [String(game.gamePk), game]))
  const next = []

  for (const current of currentByKey.values()) {
    const game = gamesByPk.get(String(current.gamePk))
    if (gameCancelled(game)) continue
    const prior = priorByKey.get(current.key)

    if (gameStarted(game)) {
      if (prior) {
        if (prior.lateCapture) {
          next.push(prior)
          continue
        }
        next.push({
          ...prior,
          finalPregame: true,
          freezeState: 'final-pregame',
          frozenAt: prior.frozenAt || capturedAt,
        })
      } else {
        next.push({
          ...current,
          capturedAt,
          finalPregame: false,
          freezeState: 'late-capture',
          lateCapture: true,
        })
      }
      continue
    }

    next.push({
      ...current,
      capturedAt,
      finalPregame: false,
      freezeState: current.lineupMode === 'confirmed' ? 'confirmed-live' : 'projected-live',
    })
  }

  for (const prior of priorByKey.values()) {
    if (currentByKey.has(prior.key)) continue
    const game = gamesByPk.get(String(prior.gamePk))
    if (gameCancelled(game)) continue
    if (!game) {
      next.push(prior)
      continue
    }
    // Pregame disappearance means the probable starter changed; discard the
    // stale arm. After first pitch, retain the last bettable estimate.
    if (gameStarted(game)) {
      if (prior.lateCapture) {
        next.push(prior)
        continue
      }
      next.push({
        ...prior,
        finalPregame: true,
        freezeState: 'final-pregame',
        frozenAt: prior.frozenAt || capturedAt,
      })
    }
  }

  return next.sort((a, b) => (
    Number(a.gamePk) - Number(b.gamePk)
    || Number(a.pitcherId) - Number(b.pitcherId)
  ))
}
