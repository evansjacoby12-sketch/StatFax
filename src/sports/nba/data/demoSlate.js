/**
 * demoSlate.js — Realistic NBA First Basket demo slate for offline testing & rich fallback (2026-27 Season)
 *
 * Featured Marquee Matchups:
 * 1. SAS @ OKC: Victor Wembanyama (74% tip win) vs Chet Holmgren (66% tip win)
 * 2. LAL @ DEN: Walker Kessler (30% tip win) vs Nikola Jokic (46% tip win)
 * 3. NYK @ BOS: Karl-Anthony Towns (51% tip win) vs Luka Garza (50% tip win)
 * 4. PHI @ MIL: Joel Embiid (59% tip win) vs Myles Turner (57% tip win)
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
      '5104157': { opening: '+550', closing: '+450', movement: '-100 (Steam)' },
      'sas-c-1': { opening: '+550', closing: '+450', movement: '-100 (Steam)' },
      'victor wembanyama': { opening: '+550', closing: '+450', movement: '-100 (Steam)' },
      '4278073': { opening: '+600', closing: '+550', movement: '-50' },
      'okc-pg-1': { opening: '+600', closing: '+550', movement: '-50' },
      '4433255': { opening: '+700', closing: '+750', movement: '+50 (Drift)' },
      'okc-c-1': { opening: '+700', closing: '+750', movement: '+50 (Drift)' },
    },
    marketOdds: {
      '5104157': { draftkings: '+450', fanduel: '+480', betmgm: '+425', caesars: '+440' },
      'sas-c-1': { draftkings: '+450', fanduel: '+480', betmgm: '+425', caesars: '+440' },
      'victor wembanyama': { draftkings: '+450', fanduel: '+480', betmgm: '+425', caesars: '+440' },
      '4278073': { draftkings: '+550', fanduel: '+525', betmgm: '+575', caesars: '+550' },
      'okc-pg-1': { draftkings: '+550', fanduel: '+525', betmgm: '+575', caesars: '+550' },
      '4433255': { draftkings: '+750', fanduel: '+700', betmgm: '+750', caesars: '+800' },
      'okc-c-1': { draftkings: '+750', fanduel: '+700', betmgm: '+750', caesars: '+800' },
      '4066259': '+750',
      '4395630': '+850',
      '4593803': '+800',
    },
    homePlayers: [
      { id: '4278073', name: 'Shai Gilgeous-Alexander', position: 'PG', isStarter: true, jersey: '2', earlyShotShare: 0.32, shotMix: { rim: 0.45, mid: 0.40, three: 0.15 }, rimFG: 0.67, midFG: 0.50, threeFG: 0.36, ftRate: 0.44, ftPct: 0.88, scriptedSetPlay: 'Spain PnR Drive / Elbow Floater', roleContext: 'Lead initiator; 38% early touch rate', seasonStats: { pointsPerGame: 30.5, usageProxy: 25.2, fgaPerGame: 20.8, threesAttemptedPerGame: 4.9, threePointPct: 0.360 } },
      { id: '4593803', name: 'Jalen Williams', position: 'SG', isStarter: true, jersey: '8', earlyShotShare: 0.20, shotMix: { rim: 0.45, mid: 0.25, three: 0.30 }, rimFG: 0.64, midFG: 0.46, threeFG: 0.40, ftRate: 0.28, ftPct: 0.82, scriptedSetPlay: 'Daigneault Scripted Baseline Cutter', roleContext: 'Secondary slasher', seasonStats: { pointsPerGame: 20.2, usageProxy: 16.8, fgaPerGame: 14.5, threesAttemptedPerGame: 4.1, threePointPct: 0.400 } },
      { id: '2991350', name: 'Alex Caruso', position: 'PF', isStarter: true, jersey: '9', earlyShotShare: 0.12, shotMix: { rim: 0.25, mid: 0.15, three: 0.60 }, rimFG: 0.60, midFG: 0.40, threeFG: 0.37, ftRate: 0.18, ftPct: 0.80, scriptedSetPlay: 'Backdoor Cut / Spot-up 3PT', roleContext: 'Defensive connector', seasonStats: { pointsPerGame: 8.8, usageProxy: 8.1, fgaPerGame: 7.1, threesAttemptedPerGame: 3.6, threePointPct: 0.370 } },
      { id: '4683692', name: 'Cason Wallace', position: 'SF', jersey: '22', isStarter: true, earlyShotShare: 0.10, shotMix: { rim: 0.30, mid: 0.15, three: 0.55 }, rimFG: 0.60, midFG: 0.38, threeFG: 0.38, ftRate: 0.15, ftPct: 0.82, scriptedSetPlay: 'Corner 3PT Catch & Shoot', roleContext: 'Spacing wing', seasonStats: { pointsPerGame: 9.4, usageProxy: 8.2, fgaPerGame: 7.6, threesAttemptedPerGame: 4.2, threePointPct: 0.380 } },
      { id: '4433255', name: 'Chet Holmgren', position: 'C', isStarter: true, jersey: '7', earlyShotShare: 0.26, shotMix: { rim: 0.50, mid: 0.15, three: 0.35 }, rimFG: 0.72, midFG: 0.44, threeFG: 0.38, ftRate: 0.32, ftPct: 0.81, scriptedSetPlay: 'Pick-and-Pop 3PT / Dive to Rim', roleContext: 'Primary pick-and-pop anchor', seasonStats: { pointsPerGame: 18.6, usageProxy: 15.2, fgaPerGame: 13.1, threesAttemptedPerGame: 4.4, threePointPct: 0.380 } },
    ],
    awayPlayers: [
      { id: '4066259', name: "De'Aaron Fox", position: 'PG', isStarter: true, jersey: '4', earlyShotShare: 0.26, shotMix: { rim: 0.45, mid: 0.25, three: 0.30 }, rimFG: 0.67, midFG: 0.46, threeFG: 0.37, ftRate: 0.30, ftPct: 0.78, scriptedSetPlay: 'Early Drag Step-Back / Downhill Drive', roleContext: 'Floor general downhill speed', seasonStats: { pointsPerGame: 26.2, usageProxy: 23.4, fgaPerGame: 19.5, threesAttemptedPerGame: 7.2, threePointPct: 0.370 } },
      { id: '4395630', name: 'Devin Vassell', position: 'SG', isStarter: true, jersey: '24', earlyShotShare: 0.20, shotMix: { rim: 0.25, mid: 0.35, three: 0.40 }, rimFG: 0.62, midFG: 0.46, threeFG: 0.38, ftRate: 0.22, ftPct: 0.82, scriptedSetPlay: 'Pin-Down Mid-Range Curl', roleContext: 'Perimeter shot creator', seasonStats: { pointsPerGame: 19.5, usageProxy: 16.8, fgaPerGame: 15.4, threesAttemptedPerGame: 6.6, threePointPct: 0.380 } },
      { id: '4845367', name: 'Stephon Castle', position: 'SF', isStarter: true, jersey: '5', earlyShotShare: 0.11, shotMix: { rim: 0.50, mid: 0.25, three: 0.25 }, rimFG: 0.63, midFG: 0.41, threeFG: 0.33, ftRate: 0.22, ftPct: 0.75, scriptedSetPlay: 'Slashing Rim Cut', roleContext: 'Perimeter defender / cutter', seasonStats: { pointsPerGame: 12.8, usageProxy: 11.2, fgaPerGame: 10.4, threesAttemptedPerGame: 3.2, threePointPct: 0.330 } },
      { id: '4395723', name: 'Keldon Johnson', position: 'PF', jersey: '3', isStarter: true, earlyShotShare: 0.08, shotMix: { rim: 0.55, mid: 0.15, three: 0.30 }, rimFG: 0.65, midFG: 0.38, threeFG: 0.35, ftRate: 0.24, ftPct: 0.78, scriptedSetPlay: 'Corner Spot 3PT / Transition Drive', roleContext: 'Physical energy wing', seasonStats: { pointsPerGame: 14.1, usageProxy: 12.2, fgaPerGame: 11.0, threesAttemptedPerGame: 3.8, threePointPct: 0.350 } },
      { id: '5104157', name: 'Victor Wembanyama', position: 'C', isStarter: true, jersey: '1', earlyShotShare: 0.35, shotMix: { rim: 0.45, mid: 0.15, three: 0.40 }, rimFG: 0.74, midFG: 0.44, threeFG: 0.34, ftRate: 0.38, ftPct: 0.82, scriptedSetPlay: 'Popovich High-Low Lob / Trail 3PT', roleContext: 'Focal point; 74% tip win rate advantage', seasonStats: { pointsPerGame: 26.8, usageProxy: 24.2, fgaPerGame: 19.8, threesAttemptedPerGame: 7.2, threePointPct: 0.340 } },
    ],
  },
  {
    gameId: 'nba-game-lal-den',
    gameTime: 'Tonight · 10:00 PM ET',
    homeTeam: { id: '7', name: 'Denver Nuggets', abbr: 'DEN', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/den.png', color: '0e2240' },
    awayTeam: { id: '13', name: 'Los Angeles Lakers', abbr: 'LAL', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/lal.png', color: '552583' },
    homeJumper: 'Nikola Jokic',
    awayJumper: 'Walker Kessler',
    pace: 98.4,
    lineupStatus: { confirmed: true, announcedMinutesAgo: 28, status: 'CONFIRMED' },
    homeOppDefense: { rimProtectionFactor: 0.90, threePtDefenseFactor: 0.96, orebRateAllowed: 0.25, foulTurnoverForced: 0.12 },
    awayOppDefense: { rimProtectionFactor: 1.02, threePtDefenseFactor: 0.98, orebRateAllowed: 0.27, foulTurnoverForced: 0.11 },
    closingLines: {
      '3945274': { opening: '+450', closing: '+400', movement: '-50 (Steam)' },
      '3112335': { opening: '+550', closing: '+525', movement: '-25' },
    },
    marketOdds: {
      '3945274': { draftkings: '+400', fanduel: '+420', betmgm: '+380', caesars: '+390' },
      '3112335': { draftkings: '+550', fanduel: '+525', betmgm: '+575', caesars: '+550' },
      '3936299': '+650',
      '4066457': '+850',
    },
    homePlayers: [
      { id: '3936299', name: 'Jamal Murray', position: 'PG', isStarter: true, jersey: '27', earlyShotShare: 0.28, shotMix: { rim: 0.25, mid: 0.35, three: 0.40 }, rimFG: 0.63, midFG: 0.48, threeFG: 0.41, ftRate: 0.24, ftPct: 0.88, scriptedSetPlay: 'Malone Two-Man Two-Side Action PnR', roleContext: 'Lead ball-handler with Jokic', seasonStats: { pointsPerGame: 21.8, usageProxy: 18.6, fgaPerGame: 17.2, threesAttemptedPerGame: 6.5, threePointPct: 0.410 } },
      { id: '4431767', name: 'Christian Braun', position: 'SG', isStarter: true, jersey: '0', earlyShotShare: 0.10, shotMix: { rim: 0.55, mid: 0.15, three: 0.30 }, rimFG: 0.66, midFG: 0.40, threeFG: 0.38, ftRate: 0.20, ftPct: 0.74, scriptedSetPlay: 'Corner Cut Fastbreak Layup', roleContext: 'Transition cutter', seasonStats: { pointsPerGame: 13.8, usageProxy: 11.2, fgaPerGame: 10.1, threesAttemptedPerGame: 3.4, threePointPct: 0.380 } },
      { id: '3138196', name: 'Cameron Johnson', position: 'SF', jersey: '23', isStarter: true, earlyShotShare: 0.18, shotMix: { rim: 0.20, mid: 0.20, three: 0.60 }, rimFG: 0.65, midFG: 0.44, threeFG: 0.40, ftRate: 0.18, ftPct: 0.85, scriptedSetPlay: 'Transition Trail 3PT / Flare', roleContext: 'Elite floor spacer', seasonStats: { pointsPerGame: 16.5, usageProxy: 14.1, fgaPerGame: 12.8, threesAttemptedPerGame: 6.8, threePointPct: 0.400 } },
      { id: '3064290', name: 'Aaron Gordon', position: 'PF', jersey: '32', isStarter: true, earlyShotShare: 0.14, shotMix: { rim: 0.75, mid: 0.15, three: 0.10 }, rimFG: 0.70, midFG: 0.38, threeFG: 0.34, ftRate: 0.32, ftPct: 0.72, scriptedSetPlay: 'Jokic Backdoor Lob / Dunker Spot', roleContext: 'Vertical spacer', seasonStats: { pointsPerGame: 14.2, usageProxy: 12.0, fgaPerGame: 10.4, threesAttemptedPerGame: 2.2, threePointPct: 0.340 } },
      { id: '3112335', name: 'Nikola Jokic', position: 'C', jersey: '15', earlyShotShare: 0.30, shotMix: { rim: 0.55, mid: 0.30, three: 0.15 }, rimFG: 0.71, midFG: 0.52, threeFG: 0.38, ftRate: 0.36, ftPct: 0.83, scriptedSetPlay: 'Low Block Sombor Shuffle / Elbow Touch', roleContext: 'Offensive fulcrum; 46% tip win rate', isStarter: true, seasonStats: { pointsPerGame: 28.8, usageProxy: 23.2, fgaPerGame: 19.5, threesAttemptedPerGame: 4.4, threePointPct: 0.380 } },
    ],
    awayPlayers: [
      { id: '3945274', name: 'Luka Doncic', position: 'PG', jersey: '77', isStarter: true, earlyShotShare: 0.36, shotMix: { rim: 0.30, mid: 0.30, three: 0.40 }, rimFG: 0.72, midFG: 0.50, threeFG: 0.38, ftRate: 0.40, ftPct: 0.80, scriptedSetPlay: 'Step-Back 3PT / Paint Deceleration', roleContext: 'Primary orchestrator and isolation master', seasonStats: { pointsPerGame: 33.5, usageProxy: 28.2, fgaPerGame: 23.4, threesAttemptedPerGame: 9.8, threePointPct: 0.380 } },
      { id: '4066457', name: 'Austin Reaves', position: 'SG', jersey: '15', isStarter: true, earlyShotShare: 0.22, shotMix: { rim: 0.30, mid: 0.30, three: 0.40 }, rimFG: 0.65, midFG: 0.46, threeFG: 0.37, ftRate: 0.34, ftPct: 0.87, scriptedSetPlay: 'DHO Wing Drive / Foul Draw', roleContext: 'Secondary creator', seasonStats: { pointsPerGame: 18.2, usageProxy: 15.4, fgaPerGame: 13.8, threesAttemptedPerGame: 5.8, threePointPct: 0.370 } },
      { id: '4277811', name: 'Collin Sexton', position: 'SF', jersey: '10', isStarter: true, earlyShotShare: 0.20, shotMix: { rim: 0.50, mid: 0.25, three: 0.25 }, rimFG: 0.65, midFG: 0.45, threeFG: 0.36, ftRate: 0.30, ftPct: 0.85, scriptedSetPlay: 'Transition Bulldozer Paint Attack', roleContext: 'High-motor downhill slasher', seasonStats: { pointsPerGame: 17.5, usageProxy: 15.0, fgaPerGame: 13.2, threesAttemptedPerGame: 4.0, threePointPct: 0.360 } },
      { id: '4278077', name: 'Jarred Vanderbilt', position: 'PF', jersey: '2', isStarter: true, earlyShotShare: 0.10, shotMix: { rim: 0.65, mid: 0.15, three: 0.20 }, rimFG: 0.64, midFG: 0.36, threeFG: 0.30, ftRate: 0.15, ftPct: 0.70, scriptedSetPlay: 'Baseline Dunker Spot Cut', roleContext: 'Offensive rebound / defensive anchor', seasonStats: { pointsPerGame: 7.2, usageProxy: 6.8, fgaPerGame: 5.8, threesAttemptedPerGame: 1.2, threePointPct: 0.300 } },
      { id: '4433136', name: 'Walker Kessler', position: 'C', jersey: '14', isStarter: true, earlyShotShare: 0.12, shotMix: { rim: 0.92, mid: 0.08, three: 0.00 }, rimFG: 0.72, midFG: 0.32, threeFG: 0.00, ftRate: 0.28, ftPct: 0.65, scriptedSetPlay: 'Luka Alley-Oop PnR Dunk', roleContext: 'Rim protecting starting center', seasonStats: { pointsPerGame: 10.4, usageProxy: 8.5, fgaPerGame: 7.2, threesAttemptedPerGame: 0.0, threePointPct: 0.000 } },
    ],
  },
  {
    gameId: 'nba-game-nyk-bos',
    gameTime: 'Tonight · 7:30 PM ET',
    homeTeam: { id: '2', name: 'Boston Celtics', abbr: 'BOS', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/bos.png', color: '007a33' },
    awayTeam: { id: '18', name: 'New York Knicks', abbr: 'NYK', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/nyk.png', color: '006bb6' },
    homeJumper: 'Luka Garza',
    awayJumper: 'Karl-Anthony Towns',
    pace: 99.8,
    lineupStatus: { confirmed: true, announcedMinutesAgo: 20, status: 'CONFIRMED' },
    homeOppDefense: { rimProtectionFactor: 0.95, threePtDefenseFactor: 0.98, orebRateAllowed: 0.29, foulTurnoverForced: 0.11 },
    awayOppDefense: { rimProtectionFactor: 0.92, threePtDefenseFactor: 0.92, orebRateAllowed: 0.23, foulTurnoverForced: 0.14 },
    closingLines: {
      '4065648': { opening: '+500', closing: '+475', movement: '-25' },
      '3934672': { opening: '+525', closing: '+500', movement: '-25' },
    },
    marketOdds: {
      '4065648': { draftkings: '+475', fanduel: '+500', betmgm: '+460', caesars: '+480' },
      '3934672': { draftkings: '+500', fanduel: '+525', betmgm: '+480', caesars: '+510' },
      '3136195': '+600',
      '4251': '+650',
    },
    homePlayers: [
      { id: '4066354', name: 'Payton Pritchard', position: 'PG', jersey: '11', isStarter: true, earlyShotShare: 0.12, shotMix: { rim: 0.24, mid: 0.18, three: 0.58 }, rimFG: 0.60, midFG: 0.42, threeFG: 0.39, ftRate: 0.18, ftPct: 0.85, scriptedSetPlay: 'Early Drag Screen Pullup 3PT', roleContext: 'Lead guard perimeter shooter', seasonStats: { pointsPerGame: 15.2, usageProxy: 12.5, fgaPerGame: 11.2, threesAttemptedPerGame: 7.0, threePointPct: 0.390 } },
      { id: '3078284', name: 'Derrick White', position: 'SG', jersey: '9', isStarter: true, earlyShotShare: 0.15, shotMix: { rim: 0.22, mid: 0.12, three: 0.66 }, rimFG: 0.64, midFG: 0.42, threeFG: 0.40, ftRate: 0.22, ftPct: 0.88, scriptedSetPlay: 'Corner Catch-and-Shoot 3PT', roleContext: 'Two-way shooter', seasonStats: { pointsPerGame: 16.5, usageProxy: 13.8, fgaPerGame: 12.2, threesAttemptedPerGame: 7.5, threePointPct: 0.400 } },
      { id: '4251', name: 'Paul George', position: 'SF', jersey: '8', isStarter: true, earlyShotShare: 0.24, shotMix: { rim: 0.28, mid: 0.32, three: 0.40 }, rimFG: 0.66, midFG: 0.46, threeFG: 0.39, ftRate: 0.28, ftPct: 0.88, scriptedSetPlay: 'Pin-Down Curl Mid-Range', roleContext: 'Perimeter isolation scorer', seasonStats: { pointsPerGame: 21.0, usageProxy: 18.2, fgaPerGame: 16.0, threesAttemptedPerGame: 7.2, threePointPct: 0.390 } },
      { id: '4065648', name: 'Jayson Tatum', position: 'PF', jersey: '0', isStarter: true, earlyShotShare: 0.32, shotMix: { rim: 0.38, mid: 0.16, three: 0.46 }, rimFG: 0.68, midFG: 0.44, threeFG: 0.38, ftRate: 0.36, ftPct: 0.84, scriptedSetPlay: 'Top-of-Key Isolation / Step-Back 3PT', roleContext: 'Primary scoring anchor', seasonStats: { pointsPerGame: 28.5, usageProxy: 24.2, fgaPerGame: 20.1, threesAttemptedPerGame: 8.5, threePointPct: 0.380 } },
      { id: '4277951', name: 'Luka Garza', position: 'C', jersey: '52', isStarter: true, earlyShotShare: 0.17, shotMix: { rim: 0.65, mid: 0.15, three: 0.20 }, rimFG: 0.68, midFG: 0.42, threeFG: 0.34, ftRate: 0.30, ftPct: 0.78, scriptedSetPlay: 'Pick-and-Pop 3PT / Roll to Rim', roleContext: 'Inside-outside big', seasonStats: { pointsPerGame: 12.2, usageProxy: 10.5, fgaPerGame: 9.4, threesAttemptedPerGame: 3.2, threePointPct: 0.340 } },
    ],
    awayPlayers: [
      { id: '3934672', name: 'Jalen Brunson', position: 'PG', jersey: '11', isStarter: true, earlyShotShare: 0.34, shotMix: { rim: 0.36, mid: 0.34, three: 0.30 }, rimFG: 0.65, midFG: 0.48, threeFG: 0.39, ftRate: 0.32, ftPct: 0.84, scriptedSetPlay: 'Thibs Scripted PnR Paint Deceleration', roleContext: 'Primary ballhandler', seasonStats: { pointsPerGame: 28.2, usageProxy: 24.8, fgaPerGame: 20.8, threesAttemptedPerGame: 7.0, threePointPct: 0.390 } },
      { id: '3147657', name: 'Mikal Bridges', position: 'SG', jersey: '25', isStarter: true, earlyShotShare: 0.17, shotMix: { rim: 0.26, mid: 0.34, three: 0.40 }, rimFG: 0.62, midFG: 0.44, threeFG: 0.37, ftRate: 0.22, ftPct: 0.82, scriptedSetPlay: 'Elbow Curl Jumper', roleContext: 'Off-ball scorer', seasonStats: { pointsPerGame: 17.5, usageProxy: 14.8, fgaPerGame: 14.0, threesAttemptedPerGame: 6.5, threePointPct: 0.370 } },
      { id: '3934719', name: 'OG Anunoby', position: 'SF', jersey: '8', isStarter: true, earlyShotShare: 0.13, shotMix: { rim: 0.32, mid: 0.11, three: 0.57 }, rimFG: 0.66, midFG: 0.40, threeFG: 0.39, ftRate: 0.20, ftPct: 0.78, scriptedSetPlay: 'Corner 3PT Catch & Shoot', roleContext: 'Two-way wing', seasonStats: { pointsPerGame: 15.8, usageProxy: 13.4, fgaPerGame: 12.2, threesAttemptedPerGame: 5.5, threePointPct: 0.390 } },
      { id: '3062679', name: 'Josh Hart', position: 'PF', jersey: '3', isStarter: true, earlyShotShare: 0.09, shotMix: { rim: 0.52, mid: 0.11, three: 0.37 }, rimFG: 0.64, midFG: 0.38, threeFG: 0.34, ftRate: 0.25, ftPct: 0.78, scriptedSetPlay: 'Early Fastbreak Rim Attack', roleContext: 'Rebounder and connector', seasonStats: { pointsPerGame: 11.6, usageProxy: 10.0, fgaPerGame: 9.0, threesAttemptedPerGame: 3.2, threePointPct: 0.340 } },
      { id: '3136195', name: 'Karl-Anthony Towns', position: 'C', jersey: '32', isStarter: true, earlyShotShare: 0.27, shotMix: { rim: 0.44, mid: 0.16, three: 0.40 }, rimFG: 0.70, midFG: 0.45, threeFG: 0.43, ftRate: 0.34, ftPct: 0.87, scriptedSetPlay: 'Top-of-Key Pick-and-Pop 3PT', roleContext: 'Shooting 5; 51% tip win rate', seasonStats: { pointsPerGame: 24.8, usageProxy: 21.2, fgaPerGame: 17.5, threesAttemptedPerGame: 6.0, threePointPct: 0.430 } },
    ],
  },
  {
    gameId: 'nba-game-phi-mil',
    gameTime: 'Tonight · 7:00 PM ET',
    homeTeam: { id: '15', name: 'Milwaukee Bucks', abbr: 'MIL', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/mil.png', color: '00471b' },
    awayTeam: { id: '20', name: 'Philadelphia 76ers', abbr: 'PHI', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/phi.png', color: '006bb6' },
    homeJumper: 'Myles Turner',
    awayJumper: 'Joel Embiid',
    pace: 101.2,
    lineupStatus: { confirmed: true, announcedMinutesAgo: 26, status: 'CONFIRMED' },
    homeOppDefense: { rimProtectionFactor: 0.91, threePtDefenseFactor: 0.97, orebRateAllowed: 0.27, foulTurnoverForced: 0.12 },
    awayOppDefense: { rimProtectionFactor: 0.89, threePtDefenseFactor: 0.98, orebRateAllowed: 0.25, foulTurnoverForced: 0.13 },
    closingLines: {
      '3059318': { opening: '+420', closing: '+380', movement: '-40' },
      '4395725': { opening: '+550', closing: '+525', movement: '-25' },
    },
    marketOdds: {
      '3059318': { draftkings: '+380', fanduel: '+400', betmgm: '+370', caesars: '+380' },
      '4395725': { draftkings: '+525', fanduel: '+550', betmgm: '+500', caesars: '+525' },
      '4431678': '+550',
      '1966': '+600',
    },
    homePlayers: [
      { id: '4395725', name: 'Tyler Herro', position: 'PG', jersey: '11', isStarter: true, earlyShotShare: 0.32, shotMix: { rim: 0.24, mid: 0.22, three: 0.54 }, rimFG: 0.61, midFG: 0.46, threeFG: 0.39, ftRate: 0.26, ftPct: 0.88, scriptedSetPlay: 'PnR Pullup 3PT / Floater', roleContext: 'Lead perimeter creator', seasonStats: { pointsPerGame: 24.2, usageProxy: 22.0, fgaPerGame: 18.5, threesAttemptedPerGame: 8.2, threePointPct: 0.390 } },
      { id: '2991043', name: 'Caris LeVert', position: 'SG', jersey: '12', isStarter: true, earlyShotShare: 0.12, shotMix: { rim: 0.35, mid: 0.30, three: 0.35 }, rimFG: 0.60, midFG: 0.40, threeFG: 0.36, ftRate: 0.20, ftPct: 0.78, scriptedSetPlay: 'DHO Drive / Kick', roleContext: 'Secondary ballhandler', seasonStats: { pointsPerGame: 12.8, usageProxy: 11.2, fgaPerGame: 10.4, threesAttemptedPerGame: 4.5, threePointPct: 0.360 } },
      { id: '4432848', name: 'Jaime Jaquez Jr.', position: 'SF', jersey: '24', isStarter: true, earlyShotShare: 0.16, shotMix: { rim: 0.55, mid: 0.30, three: 0.15 }, rimFG: 0.64, midFG: 0.44, threeFG: 0.33, ftRate: 0.24, ftPct: 0.82, scriptedSetPlay: 'Baseline Post Footwork Spin', roleContext: 'Mid-post footwork wing', seasonStats: { pointsPerGame: 14.5, usageProxy: 12.8, fgaPerGame: 11.5, threesAttemptedPerGame: 3.0, threePointPct: 0.330 } },
      { id: '3134907', name: 'Kyle Kuzma', position: 'PF', jersey: '18', isStarter: true, earlyShotShare: 0.22, shotMix: { rim: 0.38, mid: 0.22, three: 0.40 }, rimFG: 0.62, midFG: 0.40, threeFG: 0.35, ftRate: 0.28, ftPct: 0.78, scriptedSetPlay: 'Wing Slash / Trail 3PT', roleContext: 'Scoring forward', seasonStats: { pointsPerGame: 18.5, usageProxy: 16.2, fgaPerGame: 15.0, threesAttemptedPerGame: 5.8, threePointPct: 0.350 } },
      { id: '3133628', name: 'Myles Turner', position: 'C', jersey: '3', isStarter: true, earlyShotShare: 0.18, shotMix: { rim: 0.45, mid: 0.15, three: 0.40 }, rimFG: 0.70, midFG: 0.42, threeFG: 0.37, ftRate: 0.26, ftPct: 0.80, scriptedSetPlay: 'Pick-and-Pop 3PT / Roll', roleContext: 'Starting center / 57% tip win rate', seasonStats: { pointsPerGame: 15.6, usageProxy: 13.5, fgaPerGame: 11.8, threesAttemptedPerGame: 4.8, threePointPct: 0.370 } },
    ],
    awayPlayers: [
      { id: '4431678', name: 'Tyrese Maxey', position: 'PG', jersey: '0', isStarter: true, earlyShotShare: 0.26, shotMix: { rim: 0.36, mid: 0.21, three: 0.43 }, rimFG: 0.64, midFG: 0.44, threeFG: 0.38, ftRate: 0.26, ftPct: 0.86, scriptedSetPlay: 'Early Drag Screen Pullup 3PT', roleContext: 'Lightning early transition speed', seasonStats: { pointsPerGame: 26.5, usageProxy: 23.2, fgaPerGame: 19.8, threesAttemptedPerGame: 8.1, threePointPct: 0.375 } },
      { id: '2581018', name: 'Kentavious Caldwell-Pope', position: 'SG', jersey: '1', isStarter: true, earlyShotShare: 0.08, shotMix: { rim: 0.15, mid: 0.20, three: 0.65 }, rimFG: 0.60, midFG: 0.42, threeFG: 0.39, ftRate: 0.15, ftPct: 0.86, scriptedSetPlay: 'Corner Catch-and-Shoot 3PT', roleContext: 'Spacing wing', seasonStats: { pointsPerGame: 10.2, usageProxy: 8.8, fgaPerGame: 8.0, threesAttemptedPerGame: 5.0, threePointPct: 0.390 } },
      { id: '3917376', name: 'Jaylen Brown', position: 'SF', jersey: '7', isStarter: true, earlyShotShare: 0.20, shotMix: { rim: 0.46, mid: 0.26, three: 0.28 }, rimFG: 0.69, midFG: 0.45, threeFG: 0.36, ftRate: 0.30, ftPct: 0.75, scriptedSetPlay: 'Cross-Screen Elbow Post-Up', roleContext: 'Primary aggressive slasher', seasonStats: { pointsPerGame: 24.0, usageProxy: 20.5, fgaPerGame: 18.2, threesAttemptedPerGame: 6.0, threePointPct: 0.360 } },
      { id: '1966', name: 'LeBron James', position: 'PF', jersey: '23', isStarter: true, earlyShotShare: 0.24, shotMix: { rim: 0.48, mid: 0.18, three: 0.34 }, rimFG: 0.73, midFG: 0.45, threeFG: 0.38, ftRate: 0.32, ftPct: 0.76, scriptedSetPlay: 'Top PnR / High-Low Feed to Embiid', roleContext: 'Primary orchestrator', seasonStats: { pointsPerGame: 22.8, usageProxy: 19.5, fgaPerGame: 16.8, threesAttemptedPerGame: 5.5, threePointPct: 0.380 } },
      { id: '3059318', name: 'Joel Embiid', position: 'C', jersey: '21', isStarter: true, earlyShotShare: 0.30, shotMix: { rim: 0.42, mid: 0.44, three: 0.14 }, rimFG: 0.72, midFG: 0.50, threeFG: 0.37, ftRate: 0.58, ftPct: 0.88, scriptedSetPlay: 'Mid-Post Nail Isolation & Foul Draw', roleContext: '59% tip win rate; monster foul drawing rate', seasonStats: { pointsPerGame: 32.0, usageProxy: 28.0, fgaPerGame: 21.0, threesAttemptedPerGame: 3.0, threePointPct: 0.370 } },
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
