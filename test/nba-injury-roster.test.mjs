import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGameInjuriesAndStarters, buildLiveNBASnapshot } from '../src/sports/nba/api/NBAService.js';
import { findPositionalReplacement, getFullRosterForTeam } from '../src/sports/nba/data/fullRosters.js';
import { getStartersForTeam } from '../src/sports/nba/data/teamRosters.js';
import { getJumpBallMatchup } from '../src/sports/nba/data/jumpBalls.js';

test('NBA Injuries & Rosters: parseGameInjuriesAndStarters extracts injury badges and confirmed boxscore starters', () => {
  const mockSummary = {
    injuries: [
      {
        team: { abbreviation: 'SAC' },
        injuries: [
          {
            athlete: { id: '4432811', displayName: 'Keegan Murray' },
            status: 'Out',
            details: { type: 'Ankle', detail: 'Sprain', returnDate: 'Nov 3' },
          },
          {
            athlete: { id: '4065732', displayName: "De'Andre Hunter" },
            status: 'Day-To-Day',
            details: { type: 'Knee', detail: 'Soreness' },
          },
        ],
      },
      {
        team: { abbreviation: 'GSW' },
        injuries: [
          {
            athlete: { id: '3102531', displayName: 'Kristaps Porzingis' },
            status: 'Out',
            details: { type: 'Illness', detail: 'Flu' },
          },
        ],
      },
    ],
    boxscore: {
      players: [
        {
          team: { abbreviation: 'SAC' },
          statistics: [
            {
              athletes: [
                { athlete: { id: '3155942', displayName: 'Domantas Sabonis', position: { abbreviation: 'C' } }, starter: true },
                { athlete: { id: '3064440', displayName: 'Zach LaVine', position: { abbreviation: 'SG' } }, starter: true },
                { athlete: { id: '4431679', displayName: 'Precious Achiuwa', position: { abbreviation: 'PF' } }, starter: true },
                { athlete: { id: '4065732', displayName: "De'Andre Hunter", position: { abbreviation: 'SF' } }, starter: true },
                { athlete: { id: '5142620', displayName: 'Darius Acuff Jr.', position: { abbreviation: 'PG' } }, starter: true },
                { athlete: { id: '9999999', displayName: 'Bench Player', position: { abbreviation: 'G' } }, starter: false },
              ],
            },
          ],
        },
      ],
    },
  };

  const { injuryMap, confirmedStartersByTeam } = parseGameInjuriesAndStarters(mockSummary);

  // Check Keegan Murray is OUT
  const keeganInj = injuryMap.get('4432811');
  assert.ok(keeganInj, 'Keegan Murray injury should be mapped');
  assert.equal(keeganInj.isOut, true);
  assert.equal(keeganInj.badge, 'OUT');
  assert.equal(keeganInj.detail, 'Ankle');

  // Check De'Andre Hunter is GTD
  const hunterInj = injuryMap.get('4065732');
  assert.ok(hunterInj, 'Hunter injury should be mapped');
  assert.equal(hunterInj.isOut, false);
  assert.equal(hunterInj.badge, 'GTD');

  // Check SAC confirmed starters extracted from boxscore
  const sacStarters = confirmedStartersByTeam['SAC'];
  assert.equal(sacStarters.length, 5, 'Should have exactly 5 confirmed starters');
  assert.equal(sacStarters[0].name, 'Domantas Sabonis');
  assert.equal(sacStarters[2].name, 'Precious Achiuwa');
});

test('NBA Next-Man-Up: findPositionalReplacement promotes best depth chart player and respects injury status', () => {
  // Test 1: Center out on NOP
  const outCenter = { id: '5061589', name: 'Yves Missi', position: 'C', earlyShotShare: 0.16 };
  const repCenter = findPositionalReplacement('NOP', outCenter, []);
  assert.ok(repCenter, 'Should find a replacement center for NOP');
  assert.equal(repCenter.team, 'NOP');
  assert.equal(repCenter.isReplacement, true);
  assert.equal(repCenter.replacedPlayer, 'Yves Missi');
  assert.ok(repCenter.position === 'C' || repCenter.position === 'F', 'Replacement should be a big man');

  // Test 2: If primary backup is also injured, skips them
  const injuryMap = new Map();
  // Mark DeAndre Jordan out
  injuryMap.set('3442', { isOut: true, status: 'out' });
  const repCenter2 = findPositionalReplacement('NOP', outCenter, [], injuryMap);
  assert.ok(repCenter2, 'Should find an active replacement center');
  assert.notEqual(repCenter2.id, '3442', 'Should not pick an injured backup center');

  // Test 3: Power Forward out on SAC (Keegan Murray)
  const outPF = { id: '4432811', name: 'Keegan Murray', position: 'PF', earlyShotShare: 0.20 };
  const repPF = findPositionalReplacement('SAC', outPF, []);
  assert.ok(repPF, 'Should find a replacement PF for SAC');
  assert.equal(repPF.name, 'Precious Achiuwa');
  assert.equal(repPF.team, 'SAC');
  assert.equal(repPF.isReplacement, true);
});

test('NBA Daily Lineups: buildLiveNBASnapshot replaces injured starters, adjusts center for opening tip, and re-normalizes shot shares to 1.0', () => {
  const mockScoreboard = [
    {
      gameId: '401909285',
      date: '2026-10-30T02:00:00Z',
      homeTeam: { abbr: 'GSW', name: 'Golden State Warriors', color: '1d428a' },
      awayTeam: { abbr: 'LAL', name: 'Los Angeles Lakers', color: '552583' },
    },
  ];

  // GSW starting center Kristaps Porzingis is OUT with Illness
  const mockSummaries = {
    '401909285': {
      injuries: [
        {
          team: { abbreviation: 'GSW' },
          injuries: [
            {
              athlete: { id: '3102531', displayName: 'Kristaps Porzingis' },
              status: 'Out',
              details: { type: 'Illness', detail: 'Flu' },
            },
          ],
        },
      ],
      boxscore: { players: [] }, // Projected mode
    },
  };

  const snapshot = buildLiveNBASnapshot(mockScoreboard, { gameSummaries: mockSummaries });
  assert.ok(snapshot, 'Snapshot should be created');
  assert.equal(snapshot.games.length, 1);

  const game = snapshot.games[0];
  const gswPlayers = snapshot.players.filter((p) => p.gameId === '401909285' && p.team === 'GSW');

  // 1. Starting center Kristaps Porzingis should NOT be in the starting 5
  const porzingisInLineup = gswPlayers.some((p) => p.name === 'Kristaps Porzingis');
  assert.equal(porzingisInLineup, false, 'Injured player Kristaps Porzingis must be excluded from starting 5');

  // 2. Backup center Al Horford must be promoted to starting center (depth chart priority over deep bench)
  const horford = gswPlayers.find((p) => p.name === 'Al Horford');
  assert.ok(horford, 'Al Horford should be promoted to the starting lineup');
  assert.equal(horford.isReplacement, true);
  assert.equal(horford.replacedPlayer, 'Kristaps Porzingis');

  // 3. Opening tip matchup must feature Al Horford for GSW and Walker Kessler for LAL
  assert.equal(game.tipMatchup.homeJumper, 'Al Horford');
  assert.equal(game.tipMatchup.awayJumper, 'Walker Kessler');

  // 4. Early shot share across the 5 GSW starters must strictly sum to 1.0 (100%)
  const totalEarlyShare = gswPlayers.reduce((sum, p) => sum + (p.earlyShotShare || 0), 0);
  assert.ok(Math.abs(totalEarlyShare - 1.0) < 0.02, `Total earlyShotShare must sum to ~1.0, got ${totalEarlyShare}`);
});

test('NBA Depth Chart Hierarchy: verifies true 6th-man rotation promotions over deep bench / two-way players', () => {
  // GSW SF Jimmy Butler out -> Moses Moody promoted (not Graham Ike)
  const gswRep = findPositionalReplacement('GSW', { position: 'SF', name: 'Jimmy Butler' }, []);
  assert.equal(gswRep.name, 'Moses Moody');

  // MIN SG Anthony Edwards out -> Donte DiVincenzo promoted (not Jaylen Clark)
  const minRep = findPositionalReplacement('MIN', { position: 'SG', name: 'Anthony Edwards' }, []);
  assert.equal(minRep.name, 'Donte DiVincenzo');

  // ORL PF Paolo Banchero out -> Jonathan Isaac promoted (not Jamal Cain)
  const orlRep = findPositionalReplacement('ORL', { position: 'PF', name: 'Paolo Banchero' }, []);
  assert.equal(orlRep.name, 'Jonathan Isaac');

  // LAC SF Brandon Ingram out -> Derrick Jones Jr. promoted (not Cam Christie)
  const lacRep = findPositionalReplacement('LAC', { position: 'SF', name: 'Brandon Ingram' }, []);
  assert.equal(lacRep.name, 'Derrick Jones Jr.');

  // CHI C Nic Claxton out -> Zach Collins promoted (not Tobe Awaka)
  const chiRep = findPositionalReplacement('CHI', { position: 'C', name: 'Nic Claxton' }, []);
  assert.equal(chiRep.name, 'Zach Collins');

  // DAL C Dereck Lively II out -> Daniel Gafford promoted (not Dwight Powell)
  const dalRep = findPositionalReplacement('DAL', { position: 'C', name: 'Dereck Lively II' }, []);
  assert.equal(dalRep.name, 'Daniel Gafford');

  // DET C Jalen Duren out -> Paul Reed promoted (not Tolu Smith)
  const detRep = findPositionalReplacement('DET', { position: 'C', name: 'Jalen Duren' }, []);
  assert.equal(detRep.name, 'Paul Reed');

  // CHA C Naz Reid out -> Ryan Kalkbrenner promoted
  const chaRep = findPositionalReplacement('CHA', { position: 'C', name: 'Naz Reid' }, []);
  assert.equal(chaRep.name, 'Ryan Kalkbrenner');
});

test('NBA Starting Center: Naz Reid is confirmed starting center for CHA', () => {
  const starters = getStartersForTeam('CHA');
  const center = starters.find((s) => s.position === 'C');
  assert.ok(center, 'CHA must have a starting center');
  assert.equal(center.name, 'Naz Reid');
  assert.equal(center.id, '4396971');
  assert.equal(center.jersey, '0');

  const tip = getJumpBallMatchup('WAS', 'CHA', 'Anthony Davis', 'Naz Reid');
  assert.ok(tip, 'Tip matchup between Anthony Davis and Naz Reid must compute');
  assert.equal(tip.jumperA.jumper, 'Anthony Davis');
  assert.equal(tip.jumperB.jumper, 'Naz Reid');
  assert.ok(tip.tipProbA > tip.tipProbB, 'Anthony Davis should have slight reach/rating edge');
});


