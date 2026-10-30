/**
 * teamRosters.js — 30-Team NBA Active Starter Catalog & Early Possession Profiles
 *
 * Provides starter lineups, positions, jersey numbers, early shot shares (Min 0-3),
 * scripted opening set plays, and zone make rates for all 30 NBA franchises.
 * Used by NBAService to score live ESPN scoreboards into First Basket models.
 */

export const NBA_STARTER_ROSTERS = {
  // Eastern Conference
  ATL: [
    { id: '4431680', name: 'Onyeka Okongwu', position: 'C', jersey: '17', isStarter: true, earlyShotShare: 0.16, shotMix: { rim: 0.75, mid: 0.20, three: 0.05 }, rimFG: 0.70, midFG: 0.44, threeFG: 0.31, seasonUsage: 17, scriptedSetPlay: 'Pick-and-Roll Dunk / Putback Lob' },
    { id: '4701230', name: 'Jalen Johnson', position: 'PF', jersey: '1', isStarter: true, earlyShotShare: 0.30, shotMix: { rim: 0.60, mid: 0.20, three: 0.20 }, rimFG: 0.72, midFG: 0.42, threeFG: 0.35, seasonUsage: 26, scriptedSetPlay: 'Point Forward Transition Attack / Rim Drive' },
    { id: '2490149', name: 'CJ McCollum', position: 'SG', jersey: '3', isStarter: true, earlyShotShare: 0.22, shotMix: { rim: 0.20, mid: 0.40, three: 0.40 }, rimFG: 0.60, midFG: 0.48, threeFG: 0.39, seasonUsage: 23, scriptedSetPlay: 'Elbow Mid-Range Pullup / DHO' },
    { id: '4278039', name: 'Nickeil Alexander-Walker', position: 'SF', jersey: '7', isStarter: true, earlyShotShare: 0.18, shotMix: { rim: 0.30, mid: 0.25, three: 0.45 }, rimFG: 0.62, midFG: 0.42, threeFG: 0.38, seasonUsage: 19, scriptedSetPlay: 'Corner 3PT Flare / Drive' },
    { id: '4869342', name: 'Dyson Daniels', position: 'PG', jersey: '5', isStarter: true, earlyShotShare: 0.14, shotMix: { rim: 0.45, mid: 0.20, three: 0.35 }, rimFG: 0.62, midFG: 0.40, threeFG: 0.34, seasonUsage: 16, scriptedSetPlay: 'Early Drag Screen Floater' },
  ],
  BOS: [
    { id: '4065648', name: 'Jayson Tatum', position: 'PF', jersey: '0', isStarter: true, earlyShotShare: 0.31, shotMix: { rim: 0.38, mid: 0.16, three: 0.46 }, rimFG: 0.68, midFG: 0.44, threeFG: 0.38, seasonUsage: 30, scriptedSetPlay: 'Top-of-Key Isolation / Step-Back 3PT' },
    { id: '3917376', name: 'Jaylen Brown', position: 'SF', jersey: '7', isStarter: true, earlyShotShare: 0.27, shotMix: { rim: 0.48, mid: 0.24, three: 0.28 }, rimFG: 0.70, midFG: 0.46, threeFG: 0.36, seasonUsage: 28, scriptedSetPlay: 'Cross-Screen Elbow Post-Up' },
    { id: '4277951', name: 'Luka Garza', position: 'C', jersey: '52', isStarter: true, earlyShotShare: 0.17, shotMix: { rim: 0.65, mid: 0.15, three: 0.20 }, rimFG: 0.68, midFG: 0.42, threeFG: 0.34, seasonUsage: 18, scriptedSetPlay: 'Pick-and-Pop 3PT / Roll to Rim' },
    { id: '3078284', name: 'Derrick White', position: 'SG', jersey: '9', isStarter: true, earlyShotShare: 0.13, shotMix: { rim: 0.22, mid: 0.12, three: 0.66 }, rimFG: 0.64, midFG: 0.42, threeFG: 0.40, seasonUsage: 16, scriptedSetPlay: 'Corner Catch-and-Shoot 3PT' },
    { id: '4066354', name: 'Payton Pritchard', position: 'PG', jersey: '11', isStarter: true, earlyShotShare: 0.12, shotMix: { rim: 0.24, mid: 0.18, three: 0.58 }, rimFG: 0.60, midFG: 0.42, threeFG: 0.39, seasonUsage: 15, scriptedSetPlay: 'Early Drag Screen Pullup 3PT' },
  ],
  CLE: [
    { id: '4066328', name: 'Jarrett Allen', position: 'C', jersey: '31', isStarter: true, earlyShotShare: 0.16, shotMix: { rim: 0.85, mid: 0.15, three: 0.00 }, rimFG: 0.72, midFG: 0.35, threeFG: 0.00, seasonUsage: 15, scriptedSetPlay: 'Harden Alley-Oop Rim Run' },
    { id: '4432158', name: 'Evan Mobley', position: 'PF', jersey: '4', isStarter: true, earlyShotShare: 0.22, shotMix: { rim: 0.60, mid: 0.25, three: 0.15 }, rimFG: 0.70, midFG: 0.42, threeFG: 0.34, seasonUsage: 20, scriptedSetPlay: 'Short-Roll Catch & High-Low Lob' },
    { id: '3992', name: 'James Harden', position: 'PG', jersey: '1', isStarter: true, earlyShotShare: 0.26, shotMix: { rim: 0.30, mid: 0.20, three: 0.50 }, rimFG: 0.64, midFG: 0.44, threeFG: 0.38, seasonUsage: 26, scriptedSetPlay: 'Isolation Step-Back 3PT / PnR Drive' },
    { id: '3908809', name: 'Donovan Mitchell', position: 'SG', jersey: '45', isStarter: true, earlyShotShare: 0.28, shotMix: { rim: 0.35, mid: 0.25, three: 0.40 }, rimFG: 0.66, midFG: 0.46, threeFG: 0.38, seasonUsage: 29, scriptedSetPlay: 'Wing Isolation Pullup 3PT' },
    { id: '4576087', name: 'Peyton Watson', position: 'SF', jersey: '8', isStarter: true, earlyShotShare: 0.08, shotMix: { rim: 0.45, mid: 0.15, three: 0.40 }, rimFG: 0.62, midFG: 0.38, threeFG: 0.34, seasonUsage: 12, scriptedSetPlay: 'Weakside Baseline Cut' },
  ],
  NYK: [
    { id: '3934672', name: 'Jalen Brunson', position: 'PG', jersey: '11', isStarter: true, earlyShotShare: 0.34, shotMix: { rim: 0.36, mid: 0.34, three: 0.30 }, rimFG: 0.65, midFG: 0.48, threeFG: 0.39, seasonUsage: 32, scriptedSetPlay: 'Thibs Scripted PnR Paint Deceleration' },
    { id: '3136195', name: 'Karl-Anthony Towns', position: 'C', jersey: '32', isStarter: true, earlyShotShare: 0.27, shotMix: { rim: 0.44, mid: 0.16, three: 0.40 }, rimFG: 0.70, midFG: 0.45, threeFG: 0.43, seasonUsage: 26, scriptedSetPlay: 'Top-of-Key Pick-and-Pop 3PT' },
    { id: '3147657', name: 'Mikal Bridges', position: 'SG', jersey: '25', isStarter: true, earlyShotShare: 0.17, shotMix: { rim: 0.26, mid: 0.34, three: 0.40 }, rimFG: 0.62, midFG: 0.44, threeFG: 0.37, seasonUsage: 18, scriptedSetPlay: 'Elbow Curl Jumper' },
    { id: '3934719', name: 'OG Anunoby', position: 'SF', jersey: '8', isStarter: true, earlyShotShare: 0.13, shotMix: { rim: 0.32, mid: 0.11, three: 0.57 }, rimFG: 0.66, midFG: 0.40, threeFG: 0.39, seasonUsage: 15, scriptedSetPlay: 'Corner 3PT Catch & Shoot' },
    { id: '3062679', name: 'Josh Hart', position: 'PF', jersey: '3', isStarter: true, earlyShotShare: 0.09, shotMix: { rim: 0.52, mid: 0.11, three: 0.37 }, rimFG: 0.64, midFG: 0.38, threeFG: 0.34, seasonUsage: 12, scriptedSetPlay: 'Early Fastbreak Rim Attack' },
  ],
  MIL: [
    { id: '3032977', name: 'Giannis Antetokounmpo', position: 'PF', jersey: '34', isStarter: true, earlyShotShare: 0.36, shotMix: { rim: 0.74, mid: 0.19, three: 0.07 }, rimFG: 0.76, midFG: 0.41, threeFG: 0.28, seasonUsage: 33, scriptedSetPlay: 'Doc Rivers Scripted Eurostep Rim Attack' },
    { id: '4395725', name: 'Tyler Herro', position: 'PG', jersey: '11', isStarter: true, earlyShotShare: 0.27, shotMix: { rim: 0.24, mid: 0.22, three: 0.54 }, rimFG: 0.61, midFG: 0.46, threeFG: 0.39, seasonUsage: 27, scriptedSetPlay: 'PnR Pullup 3PT / Floater' },
    { id: '3448', name: 'Brook Lopez', position: 'C', jersey: '11', isStarter: true, earlyShotShare: 0.15, shotMix: { rim: 0.36, mid: 0.14, three: 0.50 }, rimFG: 0.68, midFG: 0.42, threeFG: 0.37, seasonUsage: 16, scriptedSetPlay: 'Pick-and-Pop Trail 3PT' },
    { id: '3134907', name: 'Kyle Kuzma', position: 'SF', jersey: '18', isStarter: true, earlyShotShare: 0.13, shotMix: { rim: 0.38, mid: 0.22, three: 0.40 }, rimFG: 0.62, midFG: 0.40, threeFG: 0.35, seasonUsage: 18, scriptedSetPlay: 'Wing Slash / Trail 3PT' },
    { id: '2991043', name: 'Caris LeVert', position: 'SG', jersey: '12', isStarter: true, earlyShotShare: 0.09, shotMix: { rim: 0.35, mid: 0.30, three: 0.35 }, rimFG: 0.60, midFG: 0.40, threeFG: 0.36, seasonUsage: 14, scriptedSetPlay: 'DHO Drive / Kick' },
  ],
  PHI: [
    { id: '3059318', name: 'Joel Embiid', position: 'C', jersey: '21', isStarter: true, earlyShotShare: 0.33, shotMix: { rim: 0.42, mid: 0.44, three: 0.14 }, rimFG: 0.72, midFG: 0.50, threeFG: 0.37, seasonUsage: 36, scriptedSetPlay: 'Mid-Post Nail Isolation & Foul Draw' },
    { id: '4431678', name: 'Tyrese Maxey', position: 'PG', jersey: '0', isStarter: true, earlyShotShare: 0.27, shotMix: { rim: 0.36, mid: 0.21, three: 0.43 }, rimFG: 0.64, midFG: 0.44, threeFG: 0.38, seasonUsage: 28, scriptedSetPlay: 'Early Drag Screen Pullup 3PT' },
    { id: '4251', name: 'Paul George', position: 'SF', jersey: '8', isStarter: true, earlyShotShare: 0.21, shotMix: { rim: 0.26, mid: 0.35, three: 0.39 }, rimFG: 0.65, midFG: 0.46, threeFG: 0.40, seasonUsage: 23, scriptedSetPlay: 'Pin-Down Curl Mid-Range' },
    { id: '3133601', name: 'Kelly Oubre Jr.', position: 'SG', jersey: '9', isStarter: true, earlyShotShare: 0.11, shotMix: { rim: 0.46, mid: 0.16, three: 0.38 }, rimFG: 0.62, midFG: 0.38, threeFG: 0.33, seasonUsage: 16, scriptedSetPlay: 'Baseline Cut Layup' },
    { id: '4065668', name: 'Caleb Martin', position: 'PF', jersey: '16', isStarter: true, earlyShotShare: 0.08, shotMix: { rim: 0.36, mid: 0.16, three: 0.48 }, rimFG: 0.60, midFG: 0.38, threeFG: 0.36, seasonUsage: 12, scriptedSetPlay: 'Weakside Spacing 3PT' },
  ],

  // Western Conference
  SAS: [
    { id: '5104157', name: 'Victor Wembanyama', position: 'C', jersey: '1', isStarter: true, earlyShotShare: 0.35, shotMix: { rim: 0.45, mid: 0.15, three: 0.40 }, rimFG: 0.74, midFG: 0.44, threeFG: 0.34, seasonUsage: 32, scriptedSetPlay: 'Popovich High-Low Lob / Trail 3PT' },
    { id: '4431677', name: 'Devin Vassell', position: 'SG', jersey: '24', isStarter: true, earlyShotShare: 0.24, shotMix: { rim: 0.25, mid: 0.35, three: 0.40 }, rimFG: 0.62, midFG: 0.46, threeFG: 0.38, seasonUsage: 24, scriptedSetPlay: 'CP3 Pin-Down Mid-Range Curl' },
    { id: '4683020', name: 'Jeremy Sochan', position: 'PF', jersey: '10', isStarter: true, earlyShotShare: 0.18, shotMix: { rim: 0.65, mid: 0.20, three: 0.15 }, rimFG: 0.65, midFG: 0.40, threeFG: 0.32, seasonUsage: 18, scriptedSetPlay: 'Baseline Cut / Short Post' },
    { id: '2779', name: 'Chris Paul', position: 'PG', jersey: '3', isStarter: true, earlyShotShare: 0.13, shotMix: { rim: 0.10, mid: 0.55, three: 0.35 }, rimFG: 0.55, midFG: 0.52, threeFG: 0.38, seasonUsage: 16, scriptedSetPlay: 'Elbow Pick-and-Roll Snake Pullup' },
    { id: '4432160', name: 'Julian Champagnie', position: 'SF', jersey: '30', isStarter: true, earlyShotShare: 0.10, shotMix: { rim: 0.20, mid: 0.10, three: 0.70 }, rimFG: 0.60, midFG: 0.36, threeFG: 0.37, seasonUsage: 12, scriptedSetPlay: 'Corner Catch-and-Shoot 3PT' },
  ],
  OKC: [
    { id: '4278073', name: 'Shai Gilgeous-Alexander', position: 'PG', jersey: '2', isStarter: true, earlyShotShare: 0.32, shotMix: { rim: 0.45, mid: 0.35, three: 0.20 }, rimFG: 0.67, midFG: 0.50, threeFG: 0.36, seasonUsage: 33, scriptedSetPlay: 'Step-Back Mid-Range / Isolation Drive' },
    { id: '4433255', name: 'Chet Holmgren', position: 'C', jersey: '7', isStarter: true, earlyShotShare: 0.26, shotMix: { rim: 0.50, mid: 0.15, three: 0.35 }, rimFG: 0.72, midFG: 0.44, threeFG: 0.38, seasonUsage: 23, scriptedSetPlay: 'Pick-and-Pop 3PT / Dive to Rim' },
    { id: '4683022', name: 'Jalen Williams', position: 'SG', jersey: '8', isStarter: true, earlyShotShare: 0.20, shotMix: { rim: 0.45, mid: 0.25, three: 0.30 }, rimFG: 0.64, midFG: 0.46, threeFG: 0.40, seasonUsage: 22, scriptedSetPlay: 'Daigneault Scripted Baseline Cutter' },
    { id: '4397020', name: 'Luguentz Dort', position: 'SF', jersey: '5', isStarter: true, earlyShotShare: 0.12, shotMix: { rim: 0.30, mid: 0.10, three: 0.60 }, rimFG: 0.58, midFG: 0.38, threeFG: 0.39, seasonUsage: 15, scriptedSetPlay: 'Corner 3PT Catch & Shoot' },
    { id: '2991350', name: 'Alex Caruso', position: 'PF', jersey: '9', isStarter: true, earlyShotShare: 0.10, shotMix: { rim: 0.25, mid: 0.15, three: 0.60 }, rimFG: 0.60, midFG: 0.40, threeFG: 0.37, seasonUsage: 12, scriptedSetPlay: 'Backdoor Cut / Spot-up 3PT' },
  ],
  LAL: [
    { id: '6583', name: 'Anthony Davis', position: 'C', jersey: '3', isStarter: true, earlyShotShare: 0.34, shotMix: { rim: 0.60, mid: 0.25, three: 0.15 }, rimFG: 0.75, midFG: 0.46, threeFG: 0.32, seasonUsage: 28, scriptedSetPlay: 'JJ Redick Scripted High-Post Cross Screen' },
    { id: '1966', name: 'LeBron James', position: 'SF', jersey: '23', isStarter: true, earlyShotShare: 0.28, shotMix: { rim: 0.45, mid: 0.15, three: 0.40 }, rimFG: 0.74, midFG: 0.45, threeFG: 0.39, seasonUsage: 29, scriptedSetPlay: 'Top-of-Key PnR / Bullet Pass Post Feed' },
    { id: '4432165', name: 'Austin Reaves', position: 'SG', jersey: '15', isStarter: true, earlyShotShare: 0.18, shotMix: { rim: 0.30, mid: 0.30, three: 0.40 }, rimFG: 0.65, midFG: 0.46, threeFG: 0.37, seasonUsage: 20, scriptedSetPlay: 'DHO Wing Drive / Foul Draw' },
    { id: '3136776', name: "D'Angelo Russell", position: 'PG', jersey: '1', isStarter: true, earlyShotShare: 0.12, shotMix: { rim: 0.15, mid: 0.25, three: 0.60 }, rimFG: 0.58, midFG: 0.44, threeFG: 0.39, seasonUsage: 18, scriptedSetPlay: 'Trail 3PT Off Transition' },
    { id: '4066450', name: 'Rui Hachimura', position: 'PF', jersey: '28', isStarter: true, earlyShotShare: 0.08, shotMix: { rim: 0.50, mid: 0.20, three: 0.30 }, rimFG: 0.68, midFG: 0.44, threeFG: 0.40, seasonUsage: 15, scriptedSetPlay: 'Baseline Dunker Spot Cut' },
  ],
  DEN: [
    { id: '3112335', name: 'Nikola Jokic', position: 'C', jersey: '15', isStarter: true, earlyShotShare: 0.30, shotMix: { rim: 0.55, mid: 0.30, three: 0.15 }, rimFG: 0.71, midFG: 0.52, threeFG: 0.38, seasonUsage: 30, scriptedSetPlay: 'Low Block Sombor Shuffle / Elbow Touch' },
    { id: '3936299', name: 'Jamal Murray', position: 'PG', jersey: '27', isStarter: true, earlyShotShare: 0.28, shotMix: { rim: 0.25, mid: 0.35, three: 0.40 }, rimFG: 0.63, midFG: 0.48, threeFG: 0.41, seasonUsage: 27, scriptedSetPlay: 'Malone Two-Man Two-Side Action PnR' },
    { id: '4278104', name: 'Michael Porter Jr.', position: 'SF', jersey: '1', isStarter: true, earlyShotShare: 0.22, shotMix: { rim: 0.25, mid: 0.15, three: 0.60 }, rimFG: 0.65, midFG: 0.44, threeFG: 0.41, seasonUsage: 21, scriptedSetPlay: 'Transition Pin-Down 3PT' },
    { id: '3064290', name: 'Aaron Gordon', position: 'PF', jersey: '50', isStarter: true, earlyShotShare: 0.12, shotMix: { rim: 0.75, mid: 0.15, three: 0.10 }, rimFG: 0.70, midFG: 0.38, threeFG: 0.34, seasonUsage: 16, scriptedSetPlay: 'Jokic Backdoor Lob / Dunker Spot' },
    { id: '4432166', name: 'Christian Braun', position: 'SG', jersey: '0', isStarter: true, earlyShotShare: 0.08, shotMix: { rim: 0.55, mid: 0.15, three: 0.30 }, rimFG: 0.66, midFG: 0.40, threeFG: 0.38, seasonUsage: 13, scriptedSetPlay: 'Corner Cut Fastbreak Layup' },
  ],
  SAC: [
    { id: '3155942', name: 'Domantas Sabonis', position: 'C', jersey: '11', isStarter: true, earlyShotShare: 0.24, shotMix: { rim: 0.65, mid: 0.25, three: 0.10 }, rimFG: 0.70, midFG: 0.45, threeFG: 0.36, seasonUsage: 22, scriptedSetPlay: 'High DHO Roll / Elbow Jumper' },
    { id: '3064440', name: 'Zach LaVine', position: 'SG', jersey: '8', isStarter: true, earlyShotShare: 0.30, shotMix: { rim: 0.35, mid: 0.25, three: 0.40 }, rimFG: 0.65, midFG: 0.45, threeFG: 0.38, seasonUsage: 28, scriptedSetPlay: 'High PnR Pullup 3PT / Attack' },
    { id: '4065732', name: "De'Andre Hunter", position: 'SF', jersey: '15', isStarter: true, earlyShotShare: 0.20, shotMix: { rim: 0.30, mid: 0.35, three: 0.35 }, rimFG: 0.64, midFG: 0.44, threeFG: 0.38, seasonUsage: 20, scriptedSetPlay: 'Mid-Range Post-Up Fade' },
    { id: '4431679', name: 'Precious Achiuwa', position: 'PF', jersey: '9', isStarter: true, earlyShotShare: 0.14, shotMix: { rim: 0.70, mid: 0.15, three: 0.15 }, rimFG: 0.64, midFG: 0.36, threeFG: 0.30, seasonUsage: 15, scriptedSetPlay: 'Rim Run Cut / Dunk' },
    { id: '5142620', name: 'Darius Acuff Jr.', position: 'PG', jersey: '5', isStarter: true, earlyShotShare: 0.12, shotMix: { rim: 0.40, mid: 0.25, three: 0.35 }, rimFG: 0.58, midFG: 0.40, threeFG: 0.35, seasonUsage: 16, scriptedSetPlay: 'Transition Drive / Kick' },
  ],
  NOP: [
    { id: '5061589', name: 'Yves Missi', position: 'C', jersey: '21', isStarter: true, earlyShotShare: 0.13, shotMix: { rim: 0.88, mid: 0.12, three: 0.00 }, rimFG: 0.68, midFG: 0.35, threeFG: 0.00, seasonUsage: 14, scriptedSetPlay: 'High PnR Roll / Putback Lob' },
    { id: '4395628', name: 'Zion Williamson', position: 'PF', jersey: '1', isStarter: true, earlyShotShare: 0.26, shotMix: { rim: 0.82, mid: 0.16, three: 0.02 }, rimFG: 0.72, midFG: 0.42, threeFG: 0.25, seasonUsage: 28, scriptedSetPlay: 'Point Zion Bully-Ball Rim Attack' },
    { id: '4397688', name: 'Trey Murphy III', position: 'SF', jersey: '25', isStarter: true, earlyShotShare: 0.25, shotMix: { rim: 0.25, mid: 0.15, three: 0.60 }, rimFG: 0.66, midFG: 0.44, threeFG: 0.41, seasonUsage: 24, scriptedSetPlay: 'Deep Transition Pull-Up 3PT' },
    { id: '4277813', name: 'Herbert Jones', position: 'SG', jersey: '2', isStarter: true, earlyShotShare: 0.18, shotMix: { rim: 0.45, mid: 0.20, three: 0.35 }, rimFG: 0.62, midFG: 0.40, threeFG: 0.36, seasonUsage: 18, scriptedSetPlay: 'Baseline Cut / Corner 3PT' },
    { id: '5144091', name: 'Jeremiah Fears', position: 'PG', jersey: '0', isStarter: true, earlyShotShare: 0.18, shotMix: { rim: 0.35, mid: 0.25, three: 0.40 }, rimFG: 0.58, midFG: 0.40, threeFG: 0.35, seasonUsage: 17, scriptedSetPlay: 'PnR Deceleration Drive' },
  ],
  MEM: [
    { id: '4600663', name: 'Zach Edey', position: 'C', jersey: '14', isStarter: true, earlyShotShare: 0.22, shotMix: { rim: 0.90, mid: 0.10, three: 0.00 }, rimFG: 0.72, midFG: 0.35, threeFG: 0.00, seasonUsage: 18, scriptedSetPlay: 'Deep Seal Hook Shot / Putback' },
    { id: '5041935', name: 'Cameron Boozer', position: 'PF', jersey: '27', isStarter: true, earlyShotShare: 0.28, shotMix: { rim: 0.55, mid: 0.25, three: 0.20 }, rimFG: 0.68, midFG: 0.46, threeFG: 0.36, seasonUsage: 26, scriptedSetPlay: 'Face-Up High Post Drive / Mid-Jumper' },
    { id: '4903027', name: 'Cedric Coward', position: 'SF', jersey: '23', isStarter: true, earlyShotShare: 0.18, shotMix: { rim: 0.40, mid: 0.20, three: 0.40 }, rimFG: 0.62, midFG: 0.42, threeFG: 0.37, seasonUsage: 19, scriptedSetPlay: 'Wing Flare 3PT / DHO' },
    { id: '5112087', name: 'Jaylen Wells', position: 'SG', jersey: '0', isStarter: true, earlyShotShare: 0.14, shotMix: { rim: 0.25, mid: 0.15, three: 0.60 }, rimFG: 0.62, midFG: 0.40, threeFG: 0.39, seasonUsage: 16, scriptedSetPlay: 'Corner Spacing 3PT' },
    { id: '4065733', name: 'Ty Jerome', position: 'PG', jersey: '2', isStarter: true, earlyShotShare: 0.18, shotMix: { rim: 0.25, mid: 0.40, three: 0.35 }, rimFG: 0.60, midFG: 0.45, threeFG: 0.38, seasonUsage: 20, scriptedSetPlay: 'Pick-and-Roll Floater' },
  ],
  POR: [
    { id: '5105565', name: 'Donovan Clingan', position: 'C', jersey: '23', isStarter: true, earlyShotShare: 0.16, shotMix: { rim: 0.90, mid: 0.10, three: 0.00 }, rimFG: 0.70, midFG: 0.30, threeFG: 0.00, seasonUsage: 16, scriptedSetPlay: 'Morant Alley-Oop Lob / Rim Seal' },
    { id: '4431736', name: 'Toumani Camara', position: 'PF', jersey: '33', isStarter: true, earlyShotShare: 0.10, shotMix: { rim: 0.40, mid: 0.15, three: 0.45 }, rimFG: 0.60, midFG: 0.36, threeFG: 0.35, seasonUsage: 12, scriptedSetPlay: 'Baseline Cut Layup' },
    { id: '4683021', name: 'Deni Avdija', position: 'SF', jersey: '8', isStarter: true, earlyShotShare: 0.20, shotMix: { rim: 0.50, mid: 0.20, three: 0.30 }, rimFG: 0.66, midFG: 0.44, threeFG: 0.37, seasonUsage: 22, scriptedSetPlay: 'Early Fastbreak Rim Attack' },
    { id: '6606', name: 'Damian Lillard', position: 'PG', jersey: '0', isStarter: true, earlyShotShare: 0.26, shotMix: { rim: 0.25, mid: 0.20, three: 0.55 }, rimFG: 0.62, midFG: 0.45, threeFG: 0.38, seasonUsage: 27, scriptedSetPlay: 'Deep Logo Pullup 3PT' },
    { id: '4279888', name: 'Ja Morant', position: 'SG', jersey: '1', isStarter: true, earlyShotShare: 0.28, shotMix: { rim: 0.60, mid: 0.20, three: 0.20 }, rimFG: 0.69, midFG: 0.42, threeFG: 0.34, seasonUsage: 30, scriptedSetPlay: 'High Screen Explosive Paint Penetration' },
  ],
  BKN: [
    { id: '4431687', name: 'Nic Claxton', position: 'C', jersey: '33', isStarter: true, earlyShotShare: 0.14, shotMix: { rim: 0.90, mid: 0.10, three: 0.00 }, rimFG: 0.70, midFG: 0.35, threeFG: 0.00, seasonUsage: 15, scriptedSetPlay: 'High PnR Roll / Putback Lob' },
    { id: '4432170', name: 'Cam Thomas', position: 'SG', jersey: '24', isStarter: true, earlyShotShare: 0.32, shotMix: { rim: 0.30, mid: 0.35, three: 0.35 }, rimFG: 0.65, midFG: 0.45, threeFG: 0.37, seasonUsage: 31, scriptedSetPlay: 'Top Isolation Step-Back / Attack' },
    { id: '3032976', name: 'Dennis Schroder', position: 'PG', jersey: '17', isStarter: true, earlyShotShare: 0.22, shotMix: { rim: 0.45, mid: 0.25, three: 0.30 }, rimFG: 0.60, midFG: 0.42, threeFG: 0.35, seasonUsage: 22, scriptedSetPlay: 'Quick PnR Paint Penetration' },
    { id: '4431681', name: 'Cameron Johnson', position: 'SF', jersey: '2', isStarter: true, earlyShotShare: 0.18, shotMix: { rim: 0.20, mid: 0.20, three: 0.60 }, rimFG: 0.65, midFG: 0.44, threeFG: 0.40, seasonUsage: 18, scriptedSetPlay: 'Transition Trail 3PT / Flare' },
    { id: '3064432', name: 'Dorian Finney-Smith', position: 'PF', jersey: '28', isStarter: true, earlyShotShare: 0.14, shotMix: { rim: 0.30, mid: 0.10, three: 0.60 }, rimFG: 0.62, midFG: 0.38, threeFG: 0.36, seasonUsage: 14, scriptedSetPlay: 'Corner Catch-and-Shoot 3PT' },
  ],
  CHA: [
    { id: '4683023', name: 'Mark Williams', position: 'C', jersey: '5', isStarter: true, earlyShotShare: 0.16, shotMix: { rim: 0.88, mid: 0.12, three: 0.00 }, rimFG: 0.72, midFG: 0.36, threeFG: 0.00, seasonUsage: 16, scriptedSetPlay: 'LaMelo Alley-Oop Lob' },
    { id: '4432816', name: 'LaMelo Ball', position: 'PG', jersey: '1', isStarter: true, earlyShotShare: 0.32, shotMix: { rim: 0.25, mid: 0.25, three: 0.50 }, rimFG: 0.62, midFG: 0.44, threeFG: 0.37, seasonUsage: 32, scriptedSetPlay: 'Early Pull-Up 3PT / Floater' },
    { id: '4903025', name: 'Brandon Miller', position: 'SF', jersey: '24', isStarter: true, earlyShotShare: 0.24, shotMix: { rim: 0.30, mid: 0.30, three: 0.40 }, rimFG: 0.64, midFG: 0.46, threeFG: 0.38, seasonUsage: 24, scriptedSetPlay: 'Off-Ball Stagger Screen Curl' },
    { id: '4066383', name: 'Miles Bridges', position: 'PF', jersey: '0', isStarter: true, earlyShotShare: 0.18, shotMix: { rim: 0.50, mid: 0.20, three: 0.30 }, rimFG: 0.66, midFG: 0.42, threeFG: 0.35, seasonUsage: 20, scriptedSetPlay: 'Baseline Bully Rim Attack' },
    { id: '4432817', name: 'Josh Green', position: 'SG', jersey: '10', isStarter: true, earlyShotShare: 0.10, shotMix: { rim: 0.35, mid: 0.15, three: 0.50 }, rimFG: 0.60, midFG: 0.38, threeFG: 0.36, seasonUsage: 12, scriptedSetPlay: 'Corner Spot-Up 3PT' },
  ],
  CHI: [
    { id: '6478', name: 'Nikola Vucevic', position: 'C', jersey: '9', isStarter: true, earlyShotShare: 0.22, shotMix: { rim: 0.50, mid: 0.30, three: 0.20 }, rimFG: 0.68, midFG: 0.48, threeFG: 0.34, seasonUsage: 22, scriptedSetPlay: 'Pick-and-Pop Mid-Range / Hook' },
    { id: '4395651', name: 'Coby White', position: 'PG', jersey: '0', isStarter: true, earlyShotShare: 0.26, shotMix: { rim: 0.35, mid: 0.25, three: 0.40 }, rimFG: 0.62, midFG: 0.44, threeFG: 0.38, seasonUsage: 26, scriptedSetPlay: 'High Drag Pull-Up 3PT' },
    { id: '4397022', name: 'Ayo Dosunmu', position: 'SG', jersey: '12', isStarter: true, earlyShotShare: 0.18, shotMix: { rim: 0.50, mid: 0.20, three: 0.30 }, rimFG: 0.64, midFG: 0.42, threeFG: 0.36, seasonUsage: 18, scriptedSetPlay: 'Transition Blow-By Drive' },
    { id: '4683024', name: 'Josh Giddey', position: 'SF', jersey: '3', isStarter: true, earlyShotShare: 0.20, shotMix: { rim: 0.45, mid: 0.30, three: 0.25 }, rimFG: 0.60, midFG: 0.44, threeFG: 0.34, seasonUsage: 21, scriptedSetPlay: 'Elbow Post-Up / Floater' },
    { id: '4432820', name: 'Patrick Williams', position: 'PF', jersey: '44', isStarter: true, earlyShotShare: 0.14, shotMix: { rim: 0.35, mid: 0.20, three: 0.45 }, rimFG: 0.62, midFG: 0.40, threeFG: 0.37, seasonUsage: 14, scriptedSetPlay: 'Weakside Spacing 3PT' },
  ],
  DET: [
    { id: '4683025', name: 'Jalen Duren', position: 'C', jersey: '0', isStarter: true, earlyShotShare: 0.17, shotMix: { rim: 0.90, mid: 0.10, three: 0.00 }, rimFG: 0.72, midFG: 0.36, threeFG: 0.00, seasonUsage: 17, scriptedSetPlay: 'Cade PnR Alley-Oop' },
    { id: '4432167', name: 'Cade Cunningham', position: 'PG', jersey: '2', isStarter: true, earlyShotShare: 0.31, shotMix: { rim: 0.35, mid: 0.35, three: 0.30 }, rimFG: 0.65, midFG: 0.48, threeFG: 0.37, seasonUsage: 31, scriptedSetPlay: 'Horns Isolation Mid-Range Pullup' },
    { id: '4683026', name: 'Jaden Ivey', position: 'SG', jersey: '23', isStarter: true, earlyShotShare: 0.24, shotMix: { rim: 0.55, mid: 0.15, three: 0.30 }, rimFG: 0.66, midFG: 0.40, threeFG: 0.35, seasonUsage: 24, scriptedSetPlay: 'Early Fastbreak Paint Attack' },
    { id: '6440', name: 'Tobias Harris', position: 'PF', jersey: '12', isStarter: true, earlyShotShare: 0.18, shotMix: { rim: 0.40, mid: 0.35, three: 0.25 }, rimFG: 0.64, midFG: 0.46, threeFG: 0.36, seasonUsage: 19, scriptedSetPlay: 'Mid-Post Fadeaway Jumper' },
    { id: '2528210', name: 'Tim Hardaway Jr.', position: 'SF', jersey: '5', isStarter: true, earlyShotShare: 0.10, shotMix: { rim: 0.15, mid: 0.15, three: 0.70 }, rimFG: 0.58, midFG: 0.40, threeFG: 0.37, seasonUsage: 14, scriptedSetPlay: 'Pin-Down Catch-and-Shoot 3PT' },
  ],
  IND: [
    { id: '3133628', name: 'Myles Turner', position: 'C', jersey: '33', isStarter: true, earlyShotShare: 0.18, shotMix: { rim: 0.45, mid: 0.15, three: 0.40 }, rimFG: 0.70, midFG: 0.42, threeFG: 0.37, seasonUsage: 19, scriptedSetPlay: 'Haliburton Pick-and-Pop 3PT' },
    { id: '3149673', name: 'Pascal Siakam', position: 'PF', jersey: '43', isStarter: true, earlyShotShare: 0.28, shotMix: { rim: 0.55, mid: 0.30, three: 0.15 }, rimFG: 0.70, midFG: 0.46, threeFG: 0.35, seasonUsage: 27, scriptedSetPlay: 'Elbow Isolation Spin Move' },
    { id: '4395627', name: 'Tyrese Haliburton', position: 'PG', jersey: '0', isStarter: true, earlyShotShare: 0.24, shotMix: { rim: 0.25, mid: 0.25, three: 0.50 }, rimFG: 0.65, midFG: 0.48, threeFG: 0.39, seasonUsage: 25, scriptedSetPlay: 'Early Transition Step-Back 3PT' },
    { id: '4431688', name: 'Andrew Nembhard', position: 'SG', jersey: '2', isStarter: true, earlyShotShare: 0.16, shotMix: { rim: 0.40, mid: 0.35, three: 0.25 }, rimFG: 0.62, midFG: 0.44, threeFG: 0.36, seasonUsage: 17, scriptedSetPlay: 'PnR Mid-Range Floater' },
    { id: '4397023', name: 'Aaron Nesmith', position: 'SF', jersey: '23', isStarter: true, earlyShotShare: 0.14, shotMix: { rim: 0.30, mid: 0.15, three: 0.55 }, rimFG: 0.64, midFG: 0.42, threeFG: 0.41, seasonUsage: 15, scriptedSetPlay: 'Corner Flare 3PT' },
  ],
  MIA: [
    { id: '4066261', name: 'Bam Adebayo', position: 'C', jersey: '13', isStarter: true, earlyShotShare: 0.26, shotMix: { rim: 0.55, mid: 0.40, three: 0.05 }, rimFG: 0.68, midFG: 0.47, threeFG: 0.33, seasonUsage: 25, scriptedSetPlay: 'Elbow Hub DHO / Short Roll Touch' },
    { id: '6430', name: 'Jimmy Butler', position: 'SF', jersey: '22', isStarter: true, earlyShotShare: 0.27, shotMix: { rim: 0.55, mid: 0.35, three: 0.10 }, rimFG: 0.68, midFG: 0.46, threeFG: 0.36, seasonUsage: 27, scriptedSetPlay: 'Isolation Post-Up Foul Draw' },
    { id: '3078469', name: 'Terry Rozier', position: 'PG', jersey: '2', isStarter: true, earlyShotShare: 0.22, shotMix: { rim: 0.30, mid: 0.30, three: 0.40 }, rimFG: 0.60, midFG: 0.44, threeFG: 0.36, seasonUsage: 22, scriptedSetPlay: 'High Screen Pull-Up 3PT' },
    { id: '4683027', name: 'Nikola Jovic', position: 'PF', jersey: '5', isStarter: true, earlyShotShare: 0.14, shotMix: { rim: 0.35, mid: 0.15, three: 0.50 }, rimFG: 0.64, midFG: 0.40, threeFG: 0.38, seasonUsage: 15, scriptedSetPlay: 'Trail Spacing 3PT' },
    { id: '4431689', name: 'Jaime Jaquez Jr.', position: 'SG', jersey: '11', isStarter: true, earlyShotShare: 0.11, shotMix: { rim: 0.55, mid: 0.30, three: 0.15 }, rimFG: 0.64, midFG: 0.44, threeFG: 0.33, seasonUsage: 16, scriptedSetPlay: 'Baseline Post Footwork Spin' },
  ],
  ORL: [
    { id: '4277847', name: 'Wendell Carter Jr.', position: 'C', jersey: '34', isStarter: true, earlyShotShare: 0.15, shotMix: { rim: 0.60, mid: 0.15, three: 0.25 }, rimFG: 0.68, midFG: 0.40, threeFG: 0.35, seasonUsage: 16, scriptedSetPlay: 'Pick-and-Pop 3PT / Roll' },
    { id: '4432168', name: 'Paolo Banchero', position: 'PF', jersey: '5', isStarter: true, earlyShotShare: 0.33, shotMix: { rim: 0.48, mid: 0.32, three: 0.20 }, rimFG: 0.68, midFG: 0.44, threeFG: 0.35, seasonUsage: 32, scriptedSetPlay: 'Moseley Scripted Nail Isolation Drive' },
    { id: '4431690', name: 'Franz Wagner', position: 'SF', jersey: '22', isStarter: true, earlyShotShare: 0.27, shotMix: { rim: 0.52, mid: 0.20, three: 0.28 }, rimFG: 0.68, midFG: 0.44, threeFG: 0.36, seasonUsage: 27, scriptedSetPlay: 'Eurostep Slashing Rim Attack' },
    { id: '4432169', name: 'Jalen Suggs', position: 'SG', jersey: '4', isStarter: true, earlyShotShare: 0.15, shotMix: { rim: 0.35, mid: 0.15, three: 0.50 }, rimFG: 0.62, midFG: 0.40, threeFG: 0.38, seasonUsage: 17, scriptedSetPlay: 'Transition Wing 3PT' },
    { id: '2595516', name: 'Kentavious Caldwell-Pope', position: 'PG', jersey: '3', isStarter: true, earlyShotShare: 0.10, shotMix: { rim: 0.15, mid: 0.20, three: 0.65 }, rimFG: 0.60, midFG: 0.42, threeFG: 0.39, seasonUsage: 12, scriptedSetPlay: 'Corner Catch-and-Shoot 3PT' },
  ],
  TOR: [
    { id: '3934671', name: 'Jakob Poeltl', position: 'C', jersey: '19', isStarter: true, earlyShotShare: 0.16, shotMix: { rim: 0.90, mid: 0.10, three: 0.00 }, rimFG: 0.70, midFG: 0.35, threeFG: 0.00, seasonUsage: 16, scriptedSetPlay: 'Quick Slip Screen Hook Shot' },
    { id: '4432821', name: 'Scottie Barnes', position: 'PF', jersey: '4', isStarter: true, earlyShotShare: 0.28, shotMix: { rim: 0.50, mid: 0.25, three: 0.25 }, rimFG: 0.68, midFG: 0.44, threeFG: 0.35, seasonUsage: 28, scriptedSetPlay: 'Point Forward Cross-Match Rim Attack' },
    { id: '4395630', name: 'RJ Barrett', position: 'SF', jersey: '9', isStarter: true, earlyShotShare: 0.25, shotMix: { rim: 0.58, mid: 0.18, three: 0.24 }, rimFG: 0.67, midFG: 0.40, threeFG: 0.35, seasonUsage: 26, scriptedSetPlay: 'Left-Hand Downhill Drive' },
    { id: '4395629', name: 'Immanuel Quickley', position: 'PG', jersey: '5', isStarter: true, earlyShotShare: 0.19, shotMix: { rim: 0.30, mid: 0.30, three: 0.40 }, rimFG: 0.62, midFG: 0.46, threeFG: 0.38, seasonUsage: 22, scriptedSetPlay: 'High PnR Floater / 3PT' },
    { id: '4683028', name: 'Gradey Dick', position: 'SG', jersey: '1', isStarter: true, earlyShotShare: 0.12, shotMix: { rim: 0.20, mid: 0.20, three: 0.60 }, rimFG: 0.62, midFG: 0.42, threeFG: 0.39, seasonUsage: 15, scriptedSetPlay: 'Off-Screen Curl 3PT' },
  ],
  WAS: [
    { id: '6477', name: 'Jonas Valanciunas', position: 'C', jersey: '17', isStarter: true, earlyShotShare: 0.20, shotMix: { rim: 0.70, mid: 0.25, three: 0.05 }, rimFG: 0.68, midFG: 0.45, threeFG: 0.32, seasonUsage: 20, scriptedSetPlay: 'Low Post Seal & Hook Shot' },
    { id: '4277956', name: 'Jordan Poole', position: 'SG', jersey: '13', isStarter: true, earlyShotShare: 0.30, shotMix: { rim: 0.30, mid: 0.25, three: 0.45 }, rimFG: 0.62, midFG: 0.44, threeFG: 0.36, seasonUsage: 30, scriptedSetPlay: 'Early Isolation Step-Back 3PT' },
    { id: '5105567', name: 'Alex Sarr', position: 'PF', jersey: '20', isStarter: true, earlyShotShare: 0.19, shotMix: { rim: 0.50, mid: 0.20, three: 0.30 }, rimFG: 0.64, midFG: 0.40, threeFG: 0.33, seasonUsage: 20, scriptedSetPlay: 'High Pick-and-Pop / Lob' },
    { id: '4903026', name: 'Bilal Coulibaly', position: 'SF', jersey: '0', isStarter: true, earlyShotShare: 0.17, shotMix: { rim: 0.55, mid: 0.15, three: 0.30 }, rimFG: 0.65, midFG: 0.38, threeFG: 0.35, seasonUsage: 18, scriptedSetPlay: 'Baseline Slashing Rim Drive' },
    { id: '5105568', name: 'Bub Carrington', position: 'PG', jersey: '8', isStarter: true, earlyShotShare: 0.14, shotMix: { rim: 0.30, mid: 0.35, three: 0.35 }, rimFG: 0.58, midFG: 0.42, threeFG: 0.36, seasonUsage: 16, scriptedSetPlay: 'PnR Pull-Up Mid-Range' },
  ],
  DAL: [
    { id: '4683029', name: 'Dereck Lively II', position: 'C', jersey: '2', isStarter: true, earlyShotShare: 0.14, shotMix: { rim: 0.95, mid: 0.05, three: 0.00 }, rimFG: 0.74, midFG: 0.30, threeFG: 0.00, seasonUsage: 14, scriptedSetPlay: 'Luka Alley-Oop Lob Finish' },
    { id: '3945274', name: 'Luka Doncic', position: 'PG', jersey: '77', isStarter: true, earlyShotShare: 0.36, shotMix: { rim: 0.30, mid: 0.30, three: 0.40 }, rimFG: 0.72, midFG: 0.50, threeFG: 0.38, seasonUsage: 36, scriptedSetPlay: 'Step-Back 3PT / Paint Deceleration' },
    { id: '6442', name: 'Kyrie Irving', position: 'SG', jersey: '11', isStarter: true, earlyShotShare: 0.26, shotMix: { rim: 0.35, mid: 0.35, three: 0.30 }, rimFG: 0.66, midFG: 0.50, threeFG: 0.41, seasonUsage: 27, scriptedSetPlay: 'Isolation Crossover Pullup Jumper' },
    { id: '6475', name: 'Klay Thompson', position: 'SF', jersey: '31', isStarter: true, earlyShotShare: 0.16, shotMix: { rim: 0.10, mid: 0.25, three: 0.65 }, rimFG: 0.58, midFG: 0.44, threeFG: 0.39, seasonUsage: 18, scriptedSetPlay: 'Pin-Down Flare Catch-and-Shoot 3PT' },
    { id: '4278078', name: 'P.J. Washington', position: 'PF', jersey: '25', isStarter: true, earlyShotShare: 0.08, shotMix: { rim: 0.40, mid: 0.15, three: 0.45 }, rimFG: 0.62, midFG: 0.38, threeFG: 0.36, seasonUsage: 13, scriptedSetPlay: 'Corner Spacing 3PT / Cut' },
  ],
  GSW: [
    { id: '6589', name: 'Draymond Green', position: 'C', jersey: '23', isStarter: true, earlyShotShare: 0.10, shotMix: { rim: 0.50, mid: 0.20, three: 0.30 }, rimFG: 0.60, midFG: 0.38, threeFG: 0.33, seasonUsage: 12, scriptedSetPlay: 'Top DHO Hub / Pocket Pass' },
    { id: '3975', name: 'Stephen Curry', position: 'PG', jersey: '30', isStarter: true, earlyShotShare: 0.35, shotMix: { rim: 0.25, mid: 0.20, three: 0.55 }, rimFG: 0.68, midFG: 0.48, threeFG: 0.42, seasonUsage: 32, scriptedSetPlay: 'Kerr Elevator Screen Deep 3PT' },
    { id: '4432171', name: 'Jonathan Kuminga', position: 'PF', jersey: '0', isStarter: true, earlyShotShare: 0.25, shotMix: { rim: 0.65, mid: 0.15, three: 0.20 }, rimFG: 0.70, midFG: 0.40, threeFG: 0.33, seasonUsage: 25, scriptedSetPlay: 'High Isolation Explosive Rim Attack' },
    { id: '3064427', name: 'Andrew Wiggins', position: 'SF', jersey: '22', isStarter: true, earlyShotShare: 0.18, shotMix: { rim: 0.40, mid: 0.25, three: 0.35 }, rimFG: 0.64, midFG: 0.42, threeFG: 0.37, seasonUsage: 20, scriptedSetPlay: 'Mid-Post Turnaround Jumper' },
    { id: '4683030', name: 'Brandin Podziemski', position: 'SG', jersey: '2', isStarter: true, earlyShotShare: 0.12, shotMix: { rim: 0.40, mid: 0.25, three: 0.35 }, rimFG: 0.60, midFG: 0.42, threeFG: 0.37, seasonUsage: 15, scriptedSetPlay: 'Floater in the Lane / Kick' },
  ],
  HOU: [
    { id: '4432822', name: 'Alperen Sengun', position: 'C', jersey: '28', isStarter: true, earlyShotShare: 0.28, shotMix: { rim: 0.65, mid: 0.25, three: 0.10 }, rimFG: 0.68, midFG: 0.46, threeFG: 0.31, seasonUsage: 28, scriptedSetPlay: 'Udoka Low Block Post-Up Touch' },
    { id: '4432823', name: 'Jalen Green', position: 'SG', jersey: '4', isStarter: true, earlyShotShare: 0.30, shotMix: { rim: 0.35, mid: 0.25, three: 0.40 }, rimFG: 0.64, midFG: 0.42, threeFG: 0.36, seasonUsage: 29, scriptedSetPlay: 'Early Drag Screen Pullup 3PT' },
    { id: '2991230', name: 'Fred VanVleet', position: 'PG', jersey: '5', isStarter: true, earlyShotShare: 0.18, shotMix: { rim: 0.20, mid: 0.20, three: 0.60 }, rimFG: 0.56, midFG: 0.42, threeFG: 0.38, seasonUsage: 19, scriptedSetPlay: 'Deep Logo 3PT Off PnR' },
    { id: '4683031', name: 'Jabari Smith Jr.', position: 'PF', jersey: '10', isStarter: true, earlyShotShare: 0.14, shotMix: { rim: 0.30, mid: 0.30, three: 0.40 }, rimFG: 0.65, midFG: 0.44, threeFG: 0.37, seasonUsage: 16, scriptedSetPlay: 'Pick-and-Pop Trail 3PT' },
    { id: '3155526', name: 'Dillon Brooks', position: 'SF', jersey: '9', isStarter: true, earlyShotShare: 0.10, shotMix: { rim: 0.35, mid: 0.30, three: 0.35 }, rimFG: 0.60, midFG: 0.40, threeFG: 0.35, seasonUsage: 15, scriptedSetPlay: 'Baseline Cut / Spot 3PT' },
  ],
  LAC: [
    { id: '4066262', name: 'Ivica Zubac', position: 'C', jersey: '40', isStarter: true, earlyShotShare: 0.24, shotMix: { rim: 0.90, mid: 0.10, three: 0.00 }, rimFG: 0.70, midFG: 0.40, threeFG: 0.00, seasonUsage: 22, scriptedSetPlay: 'Harden Pocket Pass Hook Shot' },
    { id: '3155527', name: 'Norman Powell', position: 'SG', jersey: '24', isStarter: true, earlyShotShare: 0.30, shotMix: { rim: 0.35, mid: 0.25, three: 0.40 }, rimFG: 0.66, midFG: 0.46, threeFG: 0.42, seasonUsage: 28, scriptedSetPlay: 'Catch-and-Shoot Flare 3PT / Drive' },
    { id: '3992', name: 'James Harden', position: 'PG', jersey: '1', isStarter: true, earlyShotShare: 0.26, shotMix: { rim: 0.30, mid: 0.20, three: 0.50 }, rimFG: 0.64, midFG: 0.44, threeFG: 0.37, seasonUsage: 28, scriptedSetPlay: 'Step-Back Isolation 3PT / Floater' },
    { id: '3936099', name: 'Derrick Jones Jr.', position: 'SF', jersey: '55', isStarter: true, earlyShotShare: 0.12, shotMix: { rim: 0.60, mid: 0.10, three: 0.30 }, rimFG: 0.68, midFG: 0.36, threeFG: 0.35, seasonUsage: 14, scriptedSetPlay: 'Baseline Cut / Alley-Oop Lob' },
    { id: '4066384', name: 'Terance Mann', position: 'PF', jersey: '14', isStarter: true, earlyShotShare: 0.08, shotMix: { rim: 0.50, mid: 0.15, three: 0.35 }, rimFG: 0.62, midFG: 0.40, threeFG: 0.36, seasonUsage: 12, scriptedSetPlay: 'Corner Spacing 3PT' },
  ],
  MIN: [
    { id: '3032978', name: 'Rudy Gobert', position: 'C', jersey: '27', isStarter: true, earlyShotShare: 0.14, shotMix: { rim: 0.95, mid: 0.05, three: 0.00 }, rimFG: 0.72, midFG: 0.25, threeFG: 0.00, seasonUsage: 14, scriptedSetPlay: 'Conley PnR High Lob Dunk' },
    { id: '4594268', name: 'Anthony Edwards', position: 'SG', jersey: '5', isStarter: true, earlyShotShare: 0.36, shotMix: { rim: 0.38, mid: 0.22, three: 0.40 }, rimFG: 0.68, midFG: 0.46, threeFG: 0.38, seasonUsage: 34, scriptedSetPlay: 'Finch Scripted High PnR Explosive Attack' },
    { id: '3064514', name: 'Julius Randle', position: 'PF', jersey: '30', isStarter: true, earlyShotShare: 0.24, shotMix: { rim: 0.48, mid: 0.28, three: 0.24 }, rimFG: 0.65, midFG: 0.44, threeFG: 0.35, seasonUsage: 26, scriptedSetPlay: 'Elbow Bully Drive / Mid Fade' },
    { id: '3195', name: 'Mike Conley', position: 'PG', jersey: '10', isStarter: true, earlyShotShare: 0.14, shotMix: { rim: 0.20, mid: 0.25, three: 0.55 }, rimFG: 0.60, midFG: 0.44, threeFG: 0.39, seasonUsage: 15, scriptedSetPlay: 'Trail Pull-Up 3PT / Floater' },
    { id: '4432172', name: 'Jaden McDaniels', position: 'SF', jersey: '3', isStarter: true, earlyShotShare: 0.12, shotMix: { rim: 0.40, mid: 0.20, three: 0.40 }, rimFG: 0.64, midFG: 0.40, threeFG: 0.36, seasonUsage: 14, scriptedSetPlay: 'Corner Spot 3PT / Baseline Drive' },
  ],
  PHX: [
    { id: '3102530', name: 'Jusuf Nurkic', position: 'C', jersey: '20', isStarter: true, earlyShotShare: 0.14, shotMix: { rim: 0.75, mid: 0.15, three: 0.10 }, rimFG: 0.66, midFG: 0.38, threeFG: 0.28, seasonUsage: 16, scriptedSetPlay: 'Low Post Hook / Pocket Pass' },
    { id: '3202', name: 'Kevin Durant', position: 'PF', jersey: '35', isStarter: true, earlyShotShare: 0.34, shotMix: { rim: 0.25, mid: 0.45, three: 0.30 }, rimFG: 0.74, midFG: 0.54, threeFG: 0.42, seasonUsage: 31, scriptedSetPlay: 'High Post Isolation Mid-Range Pullup' },
    { id: '3136193', name: 'Devin Booker', position: 'SG', jersey: '1', isStarter: true, earlyShotShare: 0.28, shotMix: { rim: 0.30, mid: 0.38, three: 0.32 }, rimFG: 0.66, midFG: 0.50, threeFG: 0.38, seasonUsage: 29, scriptedSetPlay: 'Elbow Curl Jumper / Attack' },
    { id: '6429', name: 'Bradley Beal', position: 'PG', jersey: '3', isStarter: true, earlyShotShare: 0.16, shotMix: { rim: 0.35, mid: 0.30, three: 0.35 }, rimFG: 0.64, midFG: 0.46, threeFG: 0.37, seasonUsage: 20, scriptedSetPlay: 'Wing Slash / Corner 3PT' },
    { id: '5105569', name: 'Ryan Dunn', position: 'SF', jersey: '0', isStarter: true, earlyShotShare: 0.08, shotMix: { rim: 0.45, mid: 0.10, three: 0.45 }, rimFG: 0.62, midFG: 0.36, threeFG: 0.35, seasonUsage: 11, scriptedSetPlay: 'Weakside Spacing 3PT' },
  ],
  UTA: [
    { id: '4683032', name: 'Walker Kessler', position: 'C', jersey: '24', isStarter: true, earlyShotShare: 0.14, shotMix: { rim: 0.92, mid: 0.08, three: 0.00 }, rimFG: 0.72, midFG: 0.32, threeFG: 0.00, seasonUsage: 14, scriptedSetPlay: 'Pick-and-Roll Dunk / Putback' },
    { id: '4066336', name: 'Lauri Markkanen', position: 'PF', jersey: '23', isStarter: true, earlyShotShare: 0.32, shotMix: { rim: 0.35, mid: 0.25, three: 0.40 }, rimFG: 0.70, midFG: 0.48, threeFG: 0.40, seasonUsage: 29, scriptedSetPlay: 'Pin-Down Curl 3PT / Drive' },
    { id: '4277883', name: 'Collin Sexton', position: 'SG', jersey: '2', isStarter: true, earlyShotShare: 0.24, shotMix: { rim: 0.50, mid: 0.25, three: 0.25 }, rimFG: 0.65, midFG: 0.45, threeFG: 0.36, seasonUsage: 25, scriptedSetPlay: 'Transition Bulldozer Paint Attack' },
    { id: '4683033', name: 'Keyonte George', position: 'PG', jersey: '3', isStarter: true, earlyShotShare: 0.18, shotMix: { rim: 0.25, mid: 0.25, three: 0.50 }, rimFG: 0.58, midFG: 0.42, threeFG: 0.36, seasonUsage: 22, scriptedSetPlay: 'High Drag Step-Back 3PT' },
    { id: '3908802', name: 'John Collins', position: 'SF', jersey: '20', isStarter: true, earlyShotShare: 0.12, shotMix: { rim: 0.55, mid: 0.15, three: 0.30 }, rimFG: 0.68, midFG: 0.40, threeFG: 0.35, seasonUsage: 16, scriptedSetPlay: 'Baseline Cut / Spacing 3PT' },
  ],
};

export const NOP_JORDAN_STARTER = {
  id: '3442',
  name: 'DeAndre Jordan',
  position: 'C',
  jersey: '6',
  isStarter: true,
  earlyShotShare: 0.07,
  shotMix: { rim: 0.95, mid: 0.05, three: 0.00 },
  rimFG: 0.68,
  midFG: 0.20,
  threeFG: 0.00,
  seasonUsage: 10,
  scriptedSetPlay: 'Alley-Oop Lob / Screen Roll',
};

export const NOP_QUEEN_STARTER = {
  id: '4869780',
  name: 'Derik Queen',
  position: 'C',
  jersey: '22',
  isStarter: true,
  earlyShotShare: 0.14,
  shotMix: { rim: 0.80, mid: 0.15, three: 0.05 },
  rimFG: 0.65,
  midFG: 0.38,
  threeFG: 0.28,
  seasonUsage: 16,
  scriptedSetPlay: 'High PnR Roll / Short Post Touch',
};

export const TEAM_ABBR_ALIASES = {
  NO: 'NOP',
  GS: 'GSW',
  NY: 'NYK',
  SA: 'SAS',
  UTAH: 'UTA',
  WSH: 'WAS',
  PHO: 'PHX',
  BK: 'BKN',
};

/**
 * Helper to get starters for any team abbreviation with optional center override
 */
export function getStartersForTeam(teamAbbr, { centerChoice = 'missi' } = {}) {
  let t = (teamAbbr || '').toUpperCase().trim();
  t = TEAM_ABBR_ALIASES[t] || t;
  const roster = NBA_STARTER_ROSTERS[t];
  if (!roster) return null;

  if (t === 'NOP' && centerChoice === 'queen') {
    return [
      NOP_QUEEN_STARTER,
      ...roster.slice(1).map((p) => p.name === 'Zion Williamson' ? { ...p, earlyShotShare: 0.26 } : p),
    ].map((p) => ({ ...p, team: t }));
  }

  if (t === 'NOP' && centerChoice === 'jordan') {
    return [
      NOP_JORDAN_STARTER,
      ...roster.slice(1).map((p) => p.name === 'Zion Williamson' ? { ...p, earlyShotShare: 0.28 } : p),
    ].map((p) => ({ ...p, team: t }));
  }

  return roster.map((p) => ({ ...p, team: t }));
}
