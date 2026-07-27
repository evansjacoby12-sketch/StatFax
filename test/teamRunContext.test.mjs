import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGameScheduleContexts,
  buildTeamSeasonRunProfiles,
} from '../src/sports/mlb/logic/teamRunContext.js'

const split = (teamId, stat) => ({
  season: '2026',
  team: { id: teamId, name: `Team ${teamId}` },
  stat: { gamesPlayed: 100, ...stat },
})

test('team season context centers defense and baserunning on the league', () => {
  const payload = {
    stats: [
      {
        group: { displayName: 'hitting' },
        splits: [
          split(1, { stolenBases: 100, caughtStealing: 5 }),
          split(2, { stolenBases: 20, caughtStealing: 20 }),
        ],
      },
      {
        group: { displayName: 'fielding' },
        splits: [
          split(1, { errors: 20, doublePlays: 100, caughtStealing: 30 }),
          split(2, { errors: 60, doublePlays: 40, caughtStealing: 5 }),
        ],
      },
    ],
  }
  const profiles = buildTeamSeasonRunProfiles(payload)

  assert.equal(Object.keys(profiles.teams).length, 2)
  assert.ok(profiles.teams[1].defenseFactor < profiles.teams[2].defenseFactor)
  assert.ok(profiles.teams[1].baserunningFactor > profiles.teams[2].baserunningFactor)
  assert.ok(profiles.teams[1].defenseFactor >= 0.96)
  assert.ok(profiles.teams[2].defenseFactor <= 1.04)
})

test('team season context refuses partial or thin team samples', () => {
  const profiles = buildTeamSeasonRunProfiles({
    stats: [
      {
        group: { displayName: 'hitting' },
        splits: [split(1, { gamesPlayed: 10, stolenBases: 5, caughtStealing: 2 })],
      },
    ],
  })
  assert.deepEqual(profiles.teams, {})
})

test('schedule context uses only prior dates and marks doubleheader fatigue', () => {
  const result = (gamePk, officialDate, awayId, homeId, gameNumber = 1) => ({
    gamePk,
    officialDate,
    gameDate: `${officialDate}T23:00:00.000Z`,
    gameNumber,
    awayTeam: { id: awayId },
    homeTeam: { id: homeId },
  })
  const seasonResults = {
    games: [
      result(1, '2026-07-24', 1, 3),
      result(2, '2026-07-25', 1, 4),
      result(3, '2026-07-26', 1, 5, 1),
      result(4, '2026-07-26', 1, 5, 2),
      result(99, '2026-07-27', 1, 9),
    ],
  }
  const games = [{
    gamePk: 10,
    gameNumber: 2,
    doubleHeader: 'Y',
    awayTeam: { id: 1 },
    homeTeam: { id: 2 },
  }]
  const contexts = buildGameScheduleContexts(games, seasonResults, '2026-07-27')
  const team = contexts.byGame[10][1]

  assert.equal(team.lastGameDate, '2026-07-26')
  assert.equal(team.previousDayGames, 2)
  assert.equal(team.consecutiveDays, 3)
  assert.equal(team.secondDoubleheaderGame, true)
  assert.equal(team.travelSpot, true)
  assert.equal(team.factor, 0.965)
  assert.equal(team.historyGames, 4)
})

test('rested teams remain neutral and same-series games avoid a travel penalty', () => {
  const seasonResults = {
    games: [{
      gamePk: 1,
      officialDate: '2026-07-25',
      gameDate: '2026-07-25T23:00:00.000Z',
      awayTeam: { id: 1 },
      homeTeam: { id: 2 },
    }],
  }
  const games = [{
    gamePk: 10,
    gameNumber: 1,
    awayTeam: { id: 1 },
    homeTeam: { id: 2 },
  }]
  const team = buildGameScheduleContexts(games, seasonResults, '2026-07-27').byGame[10][1]

  assert.equal(team.daysRest, 1)
  assert.equal(team.sameSeries, true)
  assert.equal(team.travelSpot, false)
  assert.equal(team.factor, 1)
})
