/**
 * demoSlate.js — Realistic NBA First Basket demo slate for offline testing & rich fallback
 *
 * Featured Marquee Matchups:
 * 1. SAS @ OKC: Victor Wembanyama (74% tip win) vs Chet Holmgren (66% tip win)
 * 2. LAL @ DEN: Anthony Davis (69% tip win) vs Nikola Jokic (46% tip win)
 * 3. NYK @ BOS: Karl-Anthony Towns (51% tip win) vs Kristaps Porzingis (68% tip win)
 * 4. PHI @ MIL: Joel Embiid (59% tip win) vs Brook Lopez (58% tip win)
 */

import { scoreGameFirstBasket } from '../logic/firstBasketEngine.js';

// Raw rosters with starting 5 lineups and early season stats
const GAMES_RAW = [
  {
    gameId: 'nba-game-sas-okc',
    gameTime: 'Tonight · 8:00 PM ET',
    homeTeam: { id: '25', name: 'Oklahoma City Thunder', abbr: 'OKC', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/okc.png', color: '007ac1' },
    awayTeam: { id: '24', name: 'San Antonio Spurs', abbr: 'SAS', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/sas.png', color: 'c4ced4' },
    homeJumper: 'Chet Holmgren',
    awayJumper: 'Victor Wembanyama',
    pace: 102.5,
    lineupStatus: { confirmed: true, announcedMinutesAgo: 24, status: 'CONFIRMED' },
    homeOppDefense: { rimProtectionFactor: 0.91, threePtDefenseFactor: 0.98, orebRateAllowed: 0.28, foulTurnoverForced: 0.13 }, // SAS defense vs OKC
    awayOppDefense: { rimProtectionFactor: 0.90, threePtDefenseFactor: 0.94, orebRateAllowed: 0.24, foulTurnoverForced: 0.15 }, // OKC elite defense vs SAS
    closingLines: {
      'sas-c-1': { opening: '+550', closing: '+450', movement: '-100 (Steam)' },
      'okc-pg-1': { opening: '+600', closing: '+550', movement: '-50' },
      'okc-c-1': { opening: '+700', closing: '+750', movement: '+50 (Drift)' },
    },
    marketOdds: {
      'sas-c-1': { draftkings: '+450', fanduel: '+480', betmgm: '+425', caesars: '+440' },
      'okc-pg-1': { draftkings: '+550', fanduel: '+525', betmgm: '+575', caesars: '+550' },
      'okc-c-1': { draftkings: '+750', fanduel: '+700', betmgm: '+750', caesars: '+800' },
      'sas-pg-1': '+900',
      'sas-sf-1': '+850',
      'okc-sg-1': '+800',
    },
    homePlayers: [
      { id: 'okc-pg-1', name: 'Shai Gilgeous-Alexander', position: 'PG', isStarter: true, jersey: '2', earlyShotShare: 0.29, shotMix: { rim: 0.45, mid: 0.40, three: 0.15 }, rimFG: 0.66, midFG: 0.49, threeFG: 0.36, ftRate: 0.44, ftPct: 0.88, scriptedSetPlay: 'Spain PnR Drive / Elbow Floater', roleContext: 'Lead initiator; 38% early touch rate', seasonStats: { pointsPerGame: 30.1, usageProxy: 24.2, fgaPerGame: 20.4, threesAttemptedPerGame: 4.8, threePointPct: 0.355 } },
      { id: 'okc-sg-1', name: 'Jalen Williams', position: 'SG', isStarter: true, jersey: '8', earlyShotShare: 0.21, shotMix: { rim: 0.40, mid: 0.35, three: 0.25 }, rimFG: 0.64, midFG: 0.46, threeFG: 0.42, ftRate: 0.28, ftPct: 0.82, scriptedSetPlay: 'Weak-side Baseline Cut', roleContext: 'Secondary slasher', seasonStats: { pointsPerGame: 19.5, usageProxy: 16.2, fgaPerGame: 14.1, threesAttemptedPerGame: 3.8, threePointPct: 0.420 } },
      { id: 'okc-sf-1', name: 'Luguentz Dort', position: 'SF', isStarter: true, jersey: '5', earlyShotShare: 0.12, shotMix: { rim: 0.20, mid: 0.15, three: 0.65 }, rimFG: 0.58, midFG: 0.38, threeFG: 0.40, ftRate: 0.20, ftPct: 0.78, scriptedSetPlay: 'Corner Flare 3PT Catch-and-Shoot', roleContext: 'Spacing wing', seasonStats: { pointsPerGame: 10.8, usageProxy: 9.4, fgaPerGame: 8.2, threesAttemptedPerGame: 5.1, threePointPct: 0.395 } },
      { id: 'okc-pf-1', name: 'Alex Caruso', position: 'PF', isStarter: true, jersey: '9', earlyShotShare: 0.10, shotMix: { rim: 0.25, mid: 0.20, three: 0.55 }, rimFG: 0.60, midFG: 0.40, threeFG: 0.37, ftRate: 0.18, ftPct: 0.80, scriptedSetPlay: 'DHO Hand-off Quick Trigger', roleContext: 'Defensive connector', seasonStats: { pointsPerGame: 8.5, usageProxy: 7.8, fgaPerGame: 6.9, threesAttemptedPerGame: 3.5, threePointPct: 0.370 } },
      { id: 'okc-c-1',  name: 'Chet Holmgren', position: 'C', isStarter: true, jersey: '7', earlyShotShare: 0.28, shotMix: { rim: 0.50, mid: 0.15, three: 0.35 }, rimFG: 0.72, midFG: 0.44, threeFG: 0.38, ftRate: 0.32, ftPct: 0.81, scriptedSetPlay: 'Trail Pop 3PT / High Lob', roleContext: 'Primary pick-and-pop anchor', seasonStats: { pointsPerGame: 18.2, usageProxy: 14.8, fgaPerGame: 12.8, threesAttemptedPerGame: 4.2, threePointPct: 0.380 } },
      { id: 'okc-b-1',  name: 'Isaiah Joe', position: 'SG', isStarter: false, jersey: '11', seasonStats: { pointsPerGame: 9.2, usageProxy: 7.8, fgaPerGame: 7.2, threesAttemptedPerGame: 5.8, threePointPct: 0.415 } },
    ],
    awayPlayers: [
      { id: 'sas-pg-1', name: 'Chris Paul', position: 'PG', isStarter: true, jersey: '3', earlyShotShare: 0.15, shotMix: { rim: 0.15, mid: 0.55, three: 0.30 }, rimFG: 0.55, midFG: 0.50, threeFG: 0.38, ftRate: 0.22, ftPct: 0.90, scriptedSetPlay: 'Horns Action Floor General Feed', roleContext: 'Opening possession orchestrator', seasonStats: { pointsPerGame: 10.4, usageProxy: 10.2, fgaPerGame: 8.6, threesAttemptedPerGame: 3.9, threePointPct: 0.385 } },
      { id: 'sas-sg-1', name: 'Devin Vassell', position: 'SG', isStarter: true, jersey: '24', earlyShotShare: 0.22, shotMix: { rim: 0.25, mid: 0.40, three: 0.35 }, rimFG: 0.62, midFG: 0.46, threeFG: 0.38, ftRate: 0.22, ftPct: 0.82, scriptedSetPlay: 'Stagger Screen Pull-Up Mid-Range', roleContext: 'Perimeter shot creator', seasonStats: { pointsPerGame: 19.2, usageProxy: 16.5, fgaPerGame: 15.2, threesAttemptedPerGame: 6.4, threePointPct: 0.375 } },
      { id: 'sas-sf-1', name: 'Julian Champagnie', position: 'SF', isStarter: true, jersey: '30', earlyShotShare: 0.12, shotMix: { rim: 0.20, mid: 0.15, three: 0.65 }, rimFG: 0.60, midFG: 0.38, threeFG: 0.37, ftRate: 0.15, ftPct: 0.80, scriptedSetPlay: 'Wing Drift Catch-and-Shoot', roleContext: 'Floor spacer', seasonStats: { pointsPerGame: 9.8, usageProxy: 8.4, fgaPerGame: 7.9, threesAttemptedPerGame: 4.8, threePointPct: 0.365 } },
      { id: 'sas-pf-1', name: 'Jeremy Sochan', position: 'PF', isStarter: true, jersey: '10', earlyShotShare: 0.18, shotMix: { rim: 0.60, mid: 0.25, three: 0.15 }, rimFG: 0.65, midFG: 0.40, threeFG: 0.32, ftRate: 0.30, ftPct: 0.76, scriptedSetPlay: 'Short Roll Duck-In Paint Seal', roleContext: 'Inside glass crasher', seasonStats: { pointsPerGame: 14.5, usageProxy: 12.8, fgaPerGame: 11.2, threesAttemptedPerGame: 2.1, threePointPct: 0.320 } },
      { id: 'sas-c-1',  name: 'Victor Wembanyama', position: 'C', isStarter: true, jersey: '1', earlyShotShare: 0.33, shotMix: { rim: 0.50, mid: 0.15, three: 0.35 }, rimFG: 0.74, midFG: 0.44, threeFG: 0.34, ftRate: 0.38, ftPct: 0.82, scriptedSetPlay: 'Popovich Horns Set Lob / Pick-and-Pop', roleContext: 'Focal point; 74% tip win rate advantage', seasonStats: { pointsPerGame: 24.8, usageProxy: 22.4, fgaPerGame: 18.5, threesAttemptedPerGame: 6.8, threePointPct: 0.340 } },
      { id: 'sas-b-1',  name: 'Keldon Johnson', position: 'SF', isStarter: false, jersey: '0', seasonStats: { pointsPerGame: 13.8, usageProxy: 11.6, fgaPerGame: 10.8, threesAttemptedPerGame: 4.2, threePointPct: 0.350 } },
    ],
  },
  {
    gameId: 'nba-game-lal-den',
    gameTime: 'Tonight · 10:00 PM ET',
    homeTeam: { id: '7', name: 'Denver Nuggets', abbr: 'DEN', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/den.png', color: '0e2240' },
    awayTeam: { id: '13', name: 'Los Angeles Lakers', abbr: 'LAL', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/lal.png', color: '552583' },
    homeJumper: 'Nikola Jokic',
    awayJumper: 'Anthony Davis',
    pace: 98.4,
    lineupStatus: { confirmed: true, announcedMinutesAgo: 28, status: 'CONFIRMED' },
    homeOppDefense: { rimProtectionFactor: 0.90, threePtDefenseFactor: 0.96, orebRateAllowed: 0.25, foulTurnoverForced: 0.12 }, // LAL rim protection (AD)
    awayOppDefense: { rimProtectionFactor: 1.02, threePtDefenseFactor: 0.98, orebRateAllowed: 0.27, foulTurnoverForced: 0.11 }, // DEN interior
    closingLines: {
      'lal-c-1': { opening: '+450', closing: '+400', movement: '-50 (Steam)' },
      'den-c-1': { opening: '+600', closing: '+650', movement: '+50 (Drift)' },
    },
    marketOdds: {
      'lal-c-1': { draftkings: '+400', fanduel: '+420', betmgm: '+380', caesars: '+390' },
      'lal-sf-1': '+600',
      'den-c-1': { draftkings: '+650', fanduel: '+600', betmgm: '+700', caesars: '+650' },
      'den-pg-1': { draftkings: '+700', fanduel: '+750', betmgm: '+675', caesars: '+700' },
      'den-sf-1': '+850',
      'lal-sg-1': '+950',
    },
    homePlayers: [
      { id: 'den-pg-1', name: 'Jamal Murray', position: 'PG', isStarter: true, jersey: '27', earlyShotShare: 0.26, shotMix: { rim: 0.30, mid: 0.35, three: 0.35 }, rimFG: 0.63, midFG: 0.47, threeFG: 0.41, ftRate: 0.24, ftPct: 0.88, scriptedSetPlay: 'Two-man Game Snake Dribble Pull-Up', roleContext: 'Lead ball-handler with Jokic', seasonStats: { pointsPerGame: 21.2, usageProxy: 18.2, fgaPerGame: 16.8, threesAttemptedPerGame: 6.2, threePointPct: 0.410 } },
      { id: 'den-sg-1', name: 'Christian Braun', position: 'SG', isStarter: true, jersey: '0', earlyShotShare: 0.12, shotMix: { rim: 0.55, mid: 0.15, three: 0.30 }, rimFG: 0.66, midFG: 0.38, threeFG: 0.38, ftRate: 0.20, ftPct: 0.74, scriptedSetPlay: 'Backdoor Baseline Cut', roleContext: 'Transition cutter', seasonStats: { pointsPerGame: 13.5, usageProxy: 10.8, fgaPerGame: 9.8, threesAttemptedPerGame: 3.2, threePointPct: 0.385 } },
      { id: 'den-sf-1', name: 'Michael Porter Jr.', position: 'SF', isStarter: true, jersey: '1', earlyShotShare: 0.22, shotMix: { rim: 0.20, mid: 0.25, three: 0.55 }, rimFG: 0.65, midFG: 0.45, threeFG: 0.41, ftRate: 0.15, ftPct: 0.82, scriptedSetPlay: 'Pin-down Elevation 3PT', roleContext: 'Catch-and-shoot release', seasonStats: { pointsPerGame: 18.4, usageProxy: 15.2, fgaPerGame: 14.1, threesAttemptedPerGame: 7.2, threePointPct: 0.405 } },
      { id: 'den-pf-1', name: 'Aaron Gordon', position: 'PF', isStarter: true, jersey: '50', earlyShotShare: 0.16, shotMix: { rim: 0.70, mid: 0.15, three: 0.15 }, rimFG: 0.70, midFG: 0.38, threeFG: 0.34, ftRate: 0.32, ftPct: 0.72, scriptedSetPlay: 'Dunker Spot Lob from Jokic', roleContext: 'Vertical spacer', seasonStats: { pointsPerGame: 14.8, usageProxy: 12.1, fgaPerGame: 10.6, threesAttemptedPerGame: 2.4, threePointPct: 0.345 } },
      { id: 'den-c-1',  name: 'Nikola Jokic', position: 'C', isStarter: true, jersey: '15', earlyShotShare: 0.24, shotMix: { rim: 0.55, mid: 0.30, three: 0.15 }, rimFG: 0.71, midFG: 0.52, threeFG: 0.38, ftRate: 0.36, ftPct: 0.83, scriptedSetPlay: 'Elbow Hub DHO / Sombor Shuffle Post', roleContext: 'Offensive fulcrum; 46% tip win rate', seasonStats: { pointsPerGame: 28.5, usageProxy: 22.8, fgaPerGame: 19.2, threesAttemptedPerGame: 4.2, threePointPct: 0.380 } },
      { id: 'den-b-1',  name: 'Russell Westbrook', position: 'PG', isStarter: false, jersey: '4', seasonStats: { pointsPerGame: 11.2, usageProxy: 11.5, fgaPerGame: 9.8, threesAttemptedPerGame: 2.8, threePointPct: 0.315 } },
    ],
    awayPlayers: [
      { id: 'lal-pg-1', name: 'D\'Angelo Russell', position: 'PG', isStarter: true, jersey: '1', earlyShotShare: 0.16, shotMix: { rim: 0.20, mid: 0.35, three: 0.45 }, rimFG: 0.58, midFG: 0.44, threeFG: 0.40, ftRate: 0.18, ftPct: 0.82, scriptedSetPlay: 'High Screen Pull-Up 3PT', roleContext: 'Spacing initiator', seasonStats: { pointsPerGame: 15.2, usageProxy: 13.5, fgaPerGame: 12.4, threesAttemptedPerGame: 6.1, threePointPct: 0.395 } },
      { id: 'lal-sg-1', name: 'Austin Reaves', position: 'SG', isStarter: true, jersey: '15', earlyShotShare: 0.18, shotMix: { rim: 0.40, mid: 0.30, three: 0.30 }, rimFG: 0.65, midFG: 0.44, threeFG: 0.37, ftRate: 0.34, ftPct: 0.87, scriptedSetPlay: 'Secondary PnR Snake / Foul Draw', roleContext: 'Foul draw specialist', seasonStats: { pointsPerGame: 17.6, usageProxy: 14.8, fgaPerGame: 13.2, threesAttemptedPerGame: 5.5, threePointPct: 0.370 } },
      { id: 'lal-sf-1', name: 'LeBron James', position: 'SF', isStarter: true, jersey: '23', earlyShotShare: 0.26, shotMix: { rim: 0.50, mid: 0.25, three: 0.25 }, rimFG: 0.74, midFG: 0.42, threeFG: 0.39, ftRate: 0.32, ftPct: 0.76, scriptedSetPlay: 'Early Transition Freight Train / Post Feed', roleContext: 'Primary orchestrator', seasonStats: { pointsPerGame: 23.4, usageProxy: 20.2, fgaPerGame: 17.5, threesAttemptedPerGame: 5.8, threePointPct: 0.390 } },
      { id: 'lal-pf-1', name: 'Rui Hachimura', position: 'PF', isStarter: true, jersey: '28', earlyShotShare: 0.12, shotMix: { rim: 0.45, mid: 0.30, three: 0.25 }, rimFG: 0.68, midFG: 0.44, threeFG: 0.41, ftRate: 0.20, ftPct: 0.78, scriptedSetPlay: 'Baseline Dunker Spot Cut', roleContext: 'Corner finisher', seasonStats: { pointsPerGame: 12.8, usageProxy: 10.5, fgaPerGame: 9.8, threesAttemptedPerGame: 3.4, threePointPct: 0.410 } },
      { id: 'lal-c-1',  name: 'Anthony Davis', position: 'C', isStarter: true, jersey: '3', earlyShotShare: 0.32, shotMix: { rim: 0.70, mid: 0.20, three: 0.10 }, rimFG: 0.75, midFG: 0.48, threeFG: 0.32, ftRate: 0.42, ftPct: 0.82, scriptedSetPlay: 'Redick Scripted Baseline Stagger Post-Up', roleContext: 'Focal target; 69% tip win rate gives major possession advantage', seasonStats: { pointsPerGame: 29.8, usageProxy: 25.1, fgaPerGame: 21.0, threesAttemptedPerGame: 1.8, threePointPct: 0.320 } },
      { id: 'lal-b-1',  name: 'Gabe Vincent', position: 'PG', isStarter: false, jersey: '7', seasonStats: { pointsPerGame: 6.8, usageProxy: 6.2, fgaPerGame: 5.8, threesAttemptedPerGame: 4.1, threePointPct: 0.340 } },
    ],
  },
  {
    gameId: 'nba-game-nyk-bos',
    gameTime: 'Tonight · 7:30 PM ET',
    homeTeam: { id: '2', name: 'Boston Celtics', abbr: 'BOS', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/bos.png', color: '007a33' },
    awayTeam: { id: '18', name: 'New York Knicks', abbr: 'NYK', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/nyk.png', color: '006bb6' },
    homeJumper: 'Kristaps Porzingis',
    awayJumper: 'Karl-Anthony Towns',
    pace: 99.8,
    lineupStatus: { confirmed: true, announcedMinutesAgo: 20, status: 'CONFIRMED' },
    homeOppDefense: { rimProtectionFactor: 0.95, threePtDefenseFactor: 0.98, orebRateAllowed: 0.29, foulTurnoverForced: 0.11 }, // NYK defense
    awayOppDefense: { rimProtectionFactor: 0.92, threePtDefenseFactor: 0.92, orebRateAllowed: 0.23, foulTurnoverForced: 0.14 }, // BOS elite defense
    closingLines: {
      'bos-pf-1': { opening: '+550', closing: '+500', movement: '-50' },
      'nyk-pg-1': { opening: '+500', closing: '+500', movement: 'Flat' },
    },
    marketOdds: {
      'bos-pf-1': { draftkings: '+500', fanduel: '+525', betmgm: '+475', caesars: '+500' },
      'bos-sf-1': { draftkings: '+600', fanduel: '+575', betmgm: '+625', caesars: '+600' },
      'bos-c-1':  '+650',
      'nyk-pg-1': { draftkings: '+500', fanduel: '+525', betmgm: '+480', caesars: '+510' },
      'nyk-c-1':  '+600',
      'nyk-sg-1': '+950',
    },
    homePlayers: [
      { id: 'bos-pg-1', name: 'Jrue Holiday', position: 'PG', isStarter: true, jersey: '4', earlyShotShare: 0.14, shotMix: { rim: 0.35, mid: 0.20, three: 0.45 }, rimFG: 0.62, midFG: 0.42, threeFG: 0.42, ftRate: 0.18, ftPct: 0.84, scriptedSetPlay: 'Corner Flare / Post Duck-In', roleContext: 'Guard defensive anchor', seasonStats: { pointsPerGame: 12.5, usageProxy: 10.8, fgaPerGame: 9.8, threesAttemptedPerGame: 4.5, threePointPct: 0.415 } },
      { id: 'bos-sg-1', name: 'Derrick White', position: 'SG', isStarter: true, jersey: '9', earlyShotShare: 0.18, shotMix: { rim: 0.30, mid: 0.15, three: 0.55 }, rimFG: 0.64, midFG: 0.44, threeFG: 0.40, ftRate: 0.22, ftPct: 0.88, scriptedSetPlay: 'Trail 3PT / DHO Trigger', roleContext: 'Perimeter quick-trigger', seasonStats: { pointsPerGame: 16.8, usageProxy: 14.1, fgaPerGame: 12.5, threesAttemptedPerGame: 7.8, threePointPct: 0.395 } },
      { id: 'bos-sf-1', name: 'Jaylen Brown', position: 'SF', isStarter: true, jersey: '7', earlyShotShare: 0.28, shotMix: { rim: 0.45, mid: 0.30, three: 0.25 }, rimFG: 0.70, midFG: 0.46, threeFG: 0.36, ftRate: 0.30, ftPct: 0.75, scriptedSetPlay: 'Mazzulla Double Drag Rim Attack', roleContext: 'Primary aggressive slasher', seasonStats: { pointsPerGame: 24.2, usageProxy: 20.8, fgaPerGame: 18.5, threesAttemptedPerGame: 6.2, threePointPct: 0.355 } },
      { id: 'bos-pf-1', name: 'Jayson Tatum', position: 'PF', isStarter: true, jersey: '0', earlyShotShare: 0.30, shotMix: { rim: 0.35, mid: 0.25, three: 0.40 }, rimFG: 0.68, midFG: 0.45, threeFG: 0.38, ftRate: 0.36, ftPct: 0.84, scriptedSetPlay: 'High Isolation Side Step-Back 3PT', roleContext: 'Top scoring option', seasonStats: { pointsPerGame: 28.6, usageProxy: 24.5, fgaPerGame: 20.2, threesAttemptedPerGame: 8.8, threePointPct: 0.375 } },
      { id: 'bos-c-1',  name: 'Kristaps Porzingis', position: 'C', isStarter: true, jersey: '8', earlyShotShare: 0.25, shotMix: { rim: 0.45, mid: 0.20, three: 0.35 }, rimFG: 0.72, midFG: 0.48, threeFG: 0.38, ftRate: 0.35, ftPct: 0.85, scriptedSetPlay: 'Pick-and-Pop 3PT / Mismatch Seal', roleContext: '68% tip win rate gives early edge', seasonStats: { pointsPerGame: 20.1, usageProxy: 17.2, fgaPerGame: 14.6, threesAttemptedPerGame: 5.4, threePointPct: 0.380 } },
      { id: 'bos-b-1',  name: 'Payton Pritchard', position: 'PG', isStarter: false, jersey: '11', seasonStats: { pointsPerGame: 14.2, usageProxy: 11.8, fgaPerGame: 10.5, threesAttemptedPerGame: 6.5, threePointPct: 0.420 } },
    ],
    awayPlayers: [
      { id: 'nyk-pg-1', name: 'Jalen Brunson', position: 'PG', isStarter: true, jersey: '11', earlyShotShare: 0.35, shotMix: { rim: 0.35, mid: 0.40, three: 0.25 }, rimFG: 0.65, midFG: 0.49, threeFG: 0.39, ftRate: 0.32, ftPct: 0.84, scriptedSetPlay: 'Thibodeau Scripted Horns Iso Pull-Up', roleContext: 'League-leading 35% early shot share', seasonStats: { pointsPerGame: 27.8, usageProxy: 24.6, fgaPerGame: 20.5, threesAttemptedPerGame: 6.8, threePointPct: 0.390 } },
      { id: 'nyk-sg-1', name: 'Mikal Bridges', position: 'SG', isStarter: true, jersey: '25', earlyShotShare: 0.18, shotMix: { rim: 0.30, mid: 0.35, three: 0.35 }, rimFG: 0.62, midFG: 0.45, threeFG: 0.37, ftRate: 0.22, ftPct: 0.82, scriptedSetPlay: 'Off-ball Pin-down Curl', roleContext: 'Secondary perimeter scorer', seasonStats: { pointsPerGame: 17.2, usageProxy: 14.5, fgaPerGame: 13.8, threesAttemptedPerGame: 6.4, threePointPct: 0.370 } },
      { id: 'nyk-sf-1', name: 'OG Anunoby', position: 'SF', isStarter: true, jersey: '8', earlyShotShare: 0.16, shotMix: { rim: 0.40, mid: 0.15, three: 0.45 }, rimFG: 0.66, midFG: 0.40, threeFG: 0.39, ftRate: 0.20, ftPct: 0.78, scriptedSetPlay: 'Corner 3PT / Transition Lane', roleContext: 'Two-way wing', seasonStats: { pointsPerGame: 15.6, usageProxy: 13.2, fgaPerGame: 12.1, threesAttemptedPerGame: 5.2, threePointPct: 0.385 } },
      { id: 'nyk-pf-1', name: 'Josh Hart', position: 'PF', isStarter: true, jersey: '3', earlyShotShare: 0.10, shotMix: { rim: 0.55, mid: 0.15, three: 0.30 }, rimFG: 0.64, midFG: 0.36, threeFG: 0.34, ftRate: 0.25, ftPct: 0.78, scriptedSetPlay: 'Crashing Offensive Glass Putback', roleContext: 'OREB extension specialist', seasonStats: { pointsPerGame: 11.4, usageProxy: 9.8, fgaPerGame: 8.9, threesAttemptedPerGame: 3.1, threePointPct: 0.340 } },
      { id: 'nyk-c-1',  name: 'Karl-Anthony Towns', position: 'C', isStarter: true, jersey: '32', earlyShotShare: 0.28, shotMix: { rim: 0.40, mid: 0.25, three: 0.35 }, rimFG: 0.70, midFG: 0.48, threeFG: 0.43, ftRate: 0.34, ftPct: 0.87, scriptedSetPlay: 'Trail Pop 3PT / Post Turnaround', roleContext: 'Elite shooting center; 51% tip win rate', seasonStats: { pointsPerGame: 24.5, usageProxy: 21.0, fgaPerGame: 17.2, threesAttemptedPerGame: 5.8, threePointPct: 0.425 } },
      { id: 'nyk-b-1',  name: 'Miles McBride', position: 'PG', isStarter: false, jersey: '2', seasonStats: { pointsPerGame: 9.8, usageProxy: 8.2, fgaPerGame: 7.9, threesAttemptedPerGame: 4.6, threePointPct: 0.380 } },
    ],
  },
  {
    gameId: 'nba-game-phi-mil',
    gameTime: 'Tonight · 7:00 PM ET',
    homeTeam: { id: '15', name: 'Milwaukee Bucks', abbr: 'MIL', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/mil.png', color: '00471b' },
    awayTeam: { id: '20', name: 'Philadelphia 76ers', abbr: 'PHI', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/phi.png', color: '006bb6' },
    homeJumper: 'Brook Lopez',
    awayJumper: 'Joel Embiid',
    pace: 101.2,
    lineupStatus: { confirmed: true, announcedMinutesAgo: 26, status: 'CONFIRMED' },
    homeOppDefense: { rimProtectionFactor: 0.91, threePtDefenseFactor: 0.97, orebRateAllowed: 0.27, foulTurnoverForced: 0.12 }, // PHI interior (Embiid)
    awayOppDefense: { rimProtectionFactor: 0.89, threePtDefenseFactor: 0.98, orebRateAllowed: 0.25, foulTurnoverForced: 0.13 }, // MIL drop coverage (Lopez/Giannis)
    closingLines: {
      'mil-pf-1': { opening: '+420', closing: '+380', movement: '-40' },
      'phi-c-1': { opening: '+450', closing: '+420', movement: '-30' },
    },
    marketOdds: {
      'mil-pf-1': { draftkings: '+380', fanduel: '+410', betmgm: '+370', caesars: '+380' },
      'mil-pg-1': { draftkings: '+550', fanduel: '+525', betmgm: '+575', caesars: '+550' },
      'phi-c-1':  { draftkings: '+420', fanduel: '+440', betmgm: '+400', caesars: '+420' },
      'phi-pg-1': '+600',
      'mil-c-1':  '+850',
      'phi-sf-1': '+800',
    },
    homePlayers: [
      { id: 'mil-pg-1', name: 'Damian Lillard', position: 'PG', isStarter: true, jersey: '0', earlyShotShare: 0.28, shotMix: { rim: 0.25, mid: 0.25, three: 0.50 }, rimFG: 0.62, midFG: 0.46, threeFG: 0.37, ftRate: 0.38, ftPct: 0.92, scriptedSetPlay: 'Deep Flare Screen Pull-Up 3PT', roleContext: 'Perimeter trigger', seasonStats: { pointsPerGame: 25.4, usageProxy: 22.4, fgaPerGame: 18.2, threesAttemptedPerGame: 8.6, threePointPct: 0.370 } },
      { id: 'mil-sg-1', name: 'Gary Trent Jr.', position: 'SG', isStarter: true, jersey: '5', earlyShotShare: 0.12, shotMix: { rim: 0.15, mid: 0.20, three: 0.65 }, rimFG: 0.56, midFG: 0.40, threeFG: 0.39, ftRate: 0.12, ftPct: 0.85, scriptedSetPlay: 'Corner Catch-and-Shoot', roleContext: 'Spacing release', seasonStats: { pointsPerGame: 11.8, usageProxy: 10.2, fgaPerGame: 9.8, threesAttemptedPerGame: 6.2, threePointPct: 0.385 } },
      { id: 'mil-sf-1', name: 'Taurean Prince', position: 'SF', isStarter: true, jersey: '12', earlyShotShare: 0.10, shotMix: { rim: 0.25, mid: 0.15, three: 0.60 }, rimFG: 0.60, midFG: 0.38, threeFG: 0.40, ftRate: 0.15, ftPct: 0.80, scriptedSetPlay: 'Weak-side Wing Float', roleContext: 'Corner specialist', seasonStats: { pointsPerGame: 8.9, usageProxy: 7.8, fgaPerGame: 7.1, threesAttemptedPerGame: 4.2, threePointPct: 0.395 } },
      { id: 'mil-pf-1', name: 'Giannis Antetokounmpo', position: 'PF', isStarter: true, jersey: '34', earlyShotShare: 0.36, shotMix: { rim: 0.78, mid: 0.16, three: 0.06 }, rimFG: 0.76, midFG: 0.40, threeFG: 0.28, ftRate: 0.52, ftPct: 0.68, scriptedSetPlay: 'Doc Rivers Early Pistol Rim Attack', roleContext: '36% early shot share; overwhelming paint pressure', seasonStats: { pointsPerGame: 31.2, usageProxy: 27.5, fgaPerGame: 21.8, threesAttemptedPerGame: 1.4, threePointPct: 0.280 } },
      { id: 'mil-c-1',  name: 'Brook Lopez', position: 'C', isStarter: true, jersey: '11', earlyShotShare: 0.18, shotMix: { rim: 0.40, mid: 0.15, three: 0.45 }, rimFG: 0.68, midFG: 0.44, threeFG: 0.37, ftRate: 0.22, ftPct: 0.82, scriptedSetPlay: 'Trail Pop 3PT / Post Seal', roleContext: '58% tip win rate center', seasonStats: { pointsPerGame: 13.2, usageProxy: 11.5, fgaPerGame: 10.4, threesAttemptedPerGame: 5.1, threePointPct: 0.365 } },
      { id: 'mil-b-1',  name: 'Bobby Portis', position: 'PF', isStarter: false, jersey: '9', seasonStats: { pointsPerGame: 12.8, usageProxy: 11.8, fgaPerGame: 10.8, threesAttemptedPerGame: 3.4, threePointPct: 0.380 } },
    ],
    awayPlayers: [
      { id: 'phi-pg-1', name: 'Tyrese Maxey', position: 'PG', isStarter: true, jersey: '0', earlyShotShare: 0.28, shotMix: { rim: 0.40, mid: 0.25, three: 0.35 }, rimFG: 0.64, midFG: 0.44, threeFG: 0.38, ftRate: 0.26, ftPct: 0.86, scriptedSetPlay: 'Transition Blow-by Floater / Pull-Up', roleContext: 'Lightning early transition speed', seasonStats: { pointsPerGame: 26.5, usageProxy: 23.2, fgaPerGame: 19.8, threesAttemptedPerGame: 8.1, threePointPct: 0.375 } },
      { id: 'phi-sg-1', name: 'Kelly Oubre Jr.', position: 'SG', isStarter: true, jersey: '9', earlyShotShare: 0.15, shotMix: { rim: 0.45, mid: 0.20, three: 0.35 }, rimFG: 0.62, midFG: 0.38, threeFG: 0.34, ftRate: 0.24, ftPct: 0.76, scriptedSetPlay: 'Slashing Baseline Cut', roleContext: 'Secondary cutter', seasonStats: { pointsPerGame: 14.6, usageProxy: 12.5, fgaPerGame: 11.9, threesAttemptedPerGame: 4.8, threePointPct: 0.335 } },
      { id: 'phi-sf-1', name: 'Paul George', position: 'SF', isStarter: true, jersey: '8', earlyShotShare: 0.22, shotMix: { rim: 0.25, mid: 0.35, three: 0.40 }, rimFG: 0.65, midFG: 0.46, threeFG: 0.40, ftRate: 0.25, ftPct: 0.88, scriptedSetPlay: 'Pindown Screen Elevation Mid-Range', roleContext: 'Elite shot creator', seasonStats: { pointsPerGame: 21.5, usageProxy: 18.4, fgaPerGame: 16.2, threesAttemptedPerGame: 7.5, threePointPct: 0.395 } },
      { id: 'phi-pf-1', name: 'Caleb Martin', position: 'PF', isStarter: true, jersey: '16', earlyShotShare: 0.10, shotMix: { rim: 0.40, mid: 0.20, three: 0.40 }, rimFG: 0.60, midFG: 0.38, threeFG: 0.36, ftRate: 0.18, ftPct: 0.76, scriptedSetPlay: 'Corner 3PT / Crash', roleContext: 'Connector forward', seasonStats: { pointsPerGame: 9.8, usageProxy: 8.5, fgaPerGame: 8.1, threesAttemptedPerGame: 3.5, threePointPct: 0.360 } },
      { id: 'phi-c-1',  name: 'Joel Embiid', position: 'C', isStarter: true, jersey: '21', earlyShotShare: 0.32, shotMix: { rim: 0.45, mid: 0.45, three: 0.10 }, rimFG: 0.72, midFG: 0.50, threeFG: 0.37, ftRate: 0.58, ftPct: 0.88, scriptedSetPlay: 'Left Block Duck-In / Rip-Through Foul Draw', roleContext: '59% tip win rate; monster foul drawing rate', seasonStats: { pointsPerGame: 32.4, usageProxy: 28.5, fgaPerGame: 21.5, threesAttemptedPerGame: 3.2, threePointPct: 0.370 } },
      { id: 'phi-b-1',  name: 'Andre Drummond', position: 'C', isStarter: false, jersey: '5', seasonStats: { pointsPerGame: 7.2, usageProxy: 6.8, fgaPerGame: 5.5, threesAttemptedPerGame: 0.1, threePointPct: 0.000 } },
    ],
  },
];

// Pre-score all games using the firstBasketEngine
const scoredGames = GAMES_RAW.map(g => scoreGameFirstBasket({
  gameId: g.gameId,
  gameTime: g.gameTime,
  homeTeam: g.homeTeam,
  awayTeam: g.awayTeam,
  homePlayers: g.homePlayers,
  awayPlayers: g.awayPlayers,
  homeJumper: g.homePlayers.find(p => p.name === g.homeJumper),
  awayJumper: g.awayPlayers.find(p => p.name === g.awayJumper),
  marketOdds: g.marketOdds,
  closingLines: g.closingLines,
  lineupStatus: g.lineupStatus,
  pace: g.pace,
  homeOppDefense: g.homeOppDefense,
  awayOppDefense: g.awayOppDefense,
}));

// Flatten all scored players across the slate
const allPlayers = scoredGames.flatMap(g => g.players.map(p => ({
  ...p,
  gameId: g.gameId,
  gameTime: g.gameTime,
  tipMatchup: g.tipMatchup,
})));

// Sort slate by game First Basket probability
allPlayers.sort((a, b) => b.gameProb - a.gameProb);
const slateRankedPlayers = allPlayers.map((p, idx) => ({ ...p, slateRank: idx + 1 }));

export const NBA_DEMO_SNAPSHOT = Object.freeze({
  version: 1,
  sport: 'nba',
  generatedAt: new Date().toISOString(),
  source: {
    mode: 'demo',
    provider: 'StatFax First Basket Engine',
    hasOdds: true,
  },
  meta: {
    label: 'NBA First Basket Slate',
    games: scoredGames.length,
    totalPlayers: slateRankedPlayers.length,
    tipConversionRate: 0.64,
  },
  games: scoredGames,
  players: slateRankedPlayers,
});

export default NBA_DEMO_SNAPSHOT;
