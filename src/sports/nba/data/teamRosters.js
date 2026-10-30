/**
 * teamRosters.js — 30-Team NBA Active Starter Catalog & Early Possession Profiles (2026-27 Season)
 *
 * Provides starter lineups, positions, jersey numbers, early shot shares (Min 0-3),
 * scripted opening set plays, and zone make rates for all 30 NBA franchises.
 * Used by NBAService to score live ESPN scoreboards into First Basket models.
 */

export const NBA_STARTER_ROSTERS = {
  "ATL": [
    {
      "id": "4431680",
      "name": "Onyeka Okongwu",
      "position": "C",
      "jersey": "17",
      "isStarter": true,
      "earlyShotShare": 0.16,
      "shotMix": {
        "rim": 0.75,
        "mid": 0.2,
        "three": 0.05
      },
      "rimFG": 0.7,
      "midFG": 0.44,
      "threeFG": 0.31,
      "seasonUsage": 17,
      "scriptedSetPlay": "Pick-and-Roll Dunk / Putback Lob"
    },
    {
      "id": "4701230",
      "name": "Jalen Johnson",
      "position": "PF",
      "jersey": "1",
      "isStarter": true,
      "earlyShotShare": 0.3,
      "shotMix": {
        "rim": 0.6,
        "mid": 0.2,
        "three": 0.2
      },
      "rimFG": 0.72,
      "midFG": 0.42,
      "threeFG": 0.35,
      "seasonUsage": 26,
      "scriptedSetPlay": "Point Forward Transition Attack / Rim Drive"
    },
    {
      "id": "2490149",
      "name": "CJ McCollum",
      "position": "SG",
      "jersey": "3",
      "isStarter": true,
      "earlyShotShare": 0.22,
      "shotMix": {
        "rim": 0.2,
        "mid": 0.4,
        "three": 0.4
      },
      "rimFG": 0.6,
      "midFG": 0.48,
      "threeFG": 0.39,
      "seasonUsage": 23,
      "scriptedSetPlay": "Elbow Mid-Range Pullup / DHO"
    },
    {
      "id": "4278039",
      "name": "Nickeil Alexander-Walker",
      "position": "SF",
      "jersey": "7",
      "isStarter": true,
      "earlyShotShare": 0.18,
      "shotMix": {
        "rim": 0.3,
        "mid": 0.25,
        "three": 0.45
      },
      "rimFG": 0.62,
      "midFG": 0.42,
      "threeFG": 0.38,
      "seasonUsage": 19,
      "scriptedSetPlay": "Corner 3PT Flare / Drive"
    },
    {
      "id": "4869342",
      "name": "Dyson Daniels",
      "position": "PG",
      "jersey": "5",
      "isStarter": true,
      "earlyShotShare": 0.14,
      "shotMix": {
        "rim": 0.45,
        "mid": 0.2,
        "three": 0.35
      },
      "rimFG": 0.62,
      "midFG": 0.4,
      "threeFG": 0.34,
      "seasonUsage": 16,
      "scriptedSetPlay": "Early Drag Screen Floater"
    }
  ],
  "BOS": [
    {
      "id": "4065648",
      "name": "Jayson Tatum",
      "position": "PF",
      "jersey": "0",
      "isStarter": true,
      "earlyShotShare": 0.32,
      "shotMix": {
        "rim": 0.38,
        "mid": 0.16,
        "three": 0.46
      },
      "rimFG": 0.68,
      "midFG": 0.44,
      "threeFG": 0.38,
      "seasonUsage": 31,
      "scriptedSetPlay": "Top-of-Key Isolation / Step-Back 3PT"
    },
    {
      "id": "4251",
      "name": "Paul George",
      "position": "SF",
      "jersey": "8",
      "isStarter": true,
      "earlyShotShare": 0.24,
      "shotMix": {
        "rim": 0.28,
        "mid": 0.32,
        "three": 0.4
      },
      "rimFG": 0.66,
      "midFG": 0.46,
      "threeFG": 0.39,
      "seasonUsage": 25,
      "scriptedSetPlay": "Pin-Down Curl Mid-Range"
    },
    {
      "id": "4277951",
      "name": "Luka Garza",
      "position": "C",
      "jersey": "52",
      "isStarter": true,
      "earlyShotShare": 0.17,
      "shotMix": {
        "rim": 0.65,
        "mid": 0.15,
        "three": 0.2
      },
      "rimFG": 0.68,
      "midFG": 0.42,
      "threeFG": 0.34,
      "seasonUsage": 18,
      "scriptedSetPlay": "Pick-and-Pop 3PT / Roll to Rim"
    },
    {
      "id": "3078284",
      "name": "Derrick White",
      "position": "SG",
      "jersey": "9",
      "isStarter": true,
      "earlyShotShare": 0.15,
      "shotMix": {
        "rim": 0.22,
        "mid": 0.12,
        "three": 0.66
      },
      "rimFG": 0.64,
      "midFG": 0.42,
      "threeFG": 0.4,
      "seasonUsage": 18,
      "scriptedSetPlay": "Corner Catch-and-Shoot 3PT"
    },
    {
      "id": "4066354",
      "name": "Payton Pritchard",
      "position": "PG",
      "jersey": "11",
      "isStarter": true,
      "earlyShotShare": 0.12,
      "shotMix": {
        "rim": 0.24,
        "mid": 0.18,
        "three": 0.58
      },
      "rimFG": 0.6,
      "midFG": 0.42,
      "threeFG": 0.39,
      "seasonUsage": 16,
      "scriptedSetPlay": "Early Drag Screen Pullup 3PT"
    }
  ],
  "CLE": [
    {
      "id": "4066328",
      "name": "Jarrett Allen",
      "position": "C",
      "jersey": "31",
      "isStarter": true,
      "earlyShotShare": 0.16,
      "shotMix": {
        "rim": 0.85,
        "mid": 0.15,
        "three": 0
      },
      "rimFG": 0.72,
      "midFG": 0.35,
      "threeFG": 0,
      "seasonUsage": 15,
      "scriptedSetPlay": "Harden Alley-Oop Rim Run"
    },
    {
      "id": "4432158",
      "name": "Evan Mobley",
      "position": "PF",
      "jersey": "4",
      "isStarter": true,
      "earlyShotShare": 0.22,
      "shotMix": {
        "rim": 0.6,
        "mid": 0.25,
        "three": 0.15
      },
      "rimFG": 0.7,
      "midFG": 0.42,
      "threeFG": 0.34,
      "seasonUsage": 20,
      "scriptedSetPlay": "Short-Roll Catch & High-Low Lob"
    },
    {
      "id": "3992",
      "name": "James Harden",
      "position": "PG",
      "jersey": "1",
      "isStarter": true,
      "earlyShotShare": 0.26,
      "shotMix": {
        "rim": 0.3,
        "mid": 0.2,
        "three": 0.5
      },
      "rimFG": 0.64,
      "midFG": 0.44,
      "threeFG": 0.38,
      "seasonUsage": 26,
      "scriptedSetPlay": "Isolation Step-Back 3PT / PnR Drive"
    },
    {
      "id": "3908809",
      "name": "Donovan Mitchell",
      "position": "SG",
      "jersey": "45",
      "isStarter": true,
      "earlyShotShare": 0.28,
      "shotMix": {
        "rim": 0.35,
        "mid": 0.25,
        "three": 0.4
      },
      "rimFG": 0.66,
      "midFG": 0.46,
      "threeFG": 0.38,
      "seasonUsage": 29,
      "scriptedSetPlay": "Wing Isolation Pullup 3PT"
    },
    {
      "id": "4576087",
      "name": "Peyton Watson",
      "position": "SF",
      "jersey": "8",
      "isStarter": true,
      "earlyShotShare": 0.08,
      "shotMix": {
        "rim": 0.45,
        "mid": 0.15,
        "three": 0.4
      },
      "rimFG": 0.62,
      "midFG": 0.38,
      "threeFG": 0.34,
      "seasonUsage": 12,
      "scriptedSetPlay": "Weakside Baseline Cut"
    }
  ],
  "NYK": [
    {
      "id": "3934672",
      "name": "Jalen Brunson",
      "position": "PG",
      "jersey": "11",
      "isStarter": true,
      "earlyShotShare": 0.34,
      "shotMix": {
        "rim": 0.36,
        "mid": 0.34,
        "three": 0.3
      },
      "rimFG": 0.65,
      "midFG": 0.48,
      "threeFG": 0.39,
      "seasonUsage": 32,
      "scriptedSetPlay": "Thibs Scripted PnR Paint Deceleration"
    },
    {
      "id": "3136195",
      "name": "Karl-Anthony Towns",
      "position": "C",
      "jersey": "32",
      "isStarter": true,
      "earlyShotShare": 0.27,
      "shotMix": {
        "rim": 0.44,
        "mid": 0.16,
        "three": 0.4
      },
      "rimFG": 0.7,
      "midFG": 0.45,
      "threeFG": 0.43,
      "seasonUsage": 26,
      "scriptedSetPlay": "Top-of-Key Pick-and-Pop 3PT"
    },
    {
      "id": "3147657",
      "name": "Mikal Bridges",
      "position": "SG",
      "jersey": "25",
      "isStarter": true,
      "earlyShotShare": 0.17,
      "shotMix": {
        "rim": 0.26,
        "mid": 0.34,
        "three": 0.4
      },
      "rimFG": 0.62,
      "midFG": 0.44,
      "threeFG": 0.37,
      "seasonUsage": 18,
      "scriptedSetPlay": "Elbow Curl Jumper"
    },
    {
      "id": "3934719",
      "name": "OG Anunoby",
      "position": "SF",
      "jersey": "8",
      "isStarter": true,
      "earlyShotShare": 0.13,
      "shotMix": {
        "rim": 0.32,
        "mid": 0.11,
        "three": 0.57
      },
      "rimFG": 0.66,
      "midFG": 0.4,
      "threeFG": 0.39,
      "seasonUsage": 15,
      "scriptedSetPlay": "Corner 3PT Catch & Shoot"
    },
    {
      "id": "3062679",
      "name": "Josh Hart",
      "position": "PF",
      "jersey": "3",
      "isStarter": true,
      "earlyShotShare": 0.09,
      "shotMix": {
        "rim": 0.52,
        "mid": 0.11,
        "three": 0.37
      },
      "rimFG": 0.64,
      "midFG": 0.38,
      "threeFG": 0.34,
      "seasonUsage": 12,
      "scriptedSetPlay": "Early Fastbreak Rim Attack"
    }
  ],
  "MIL": [
    {
      "id": "3133628",
      "name": "Myles Turner",
      "position": "C",
      "jersey": "3",
      "isStarter": true,
      "earlyShotShare": 0.18,
      "shotMix": {
        "rim": 0.45,
        "mid": 0.15,
        "three": 0.4
      },
      "rimFG": 0.7,
      "midFG": 0.42,
      "threeFG": 0.37,
      "seasonUsage": 19,
      "scriptedSetPlay": "Pick-and-Pop 3PT / Roll"
    },
    {
      "id": "4395725",
      "name": "Tyler Herro",
      "position": "PG",
      "jersey": "11",
      "isStarter": true,
      "earlyShotShare": 0.32,
      "shotMix": {
        "rim": 0.24,
        "mid": 0.22,
        "three": 0.54
      },
      "rimFG": 0.61,
      "midFG": 0.46,
      "threeFG": 0.39,
      "seasonUsage": 30,
      "scriptedSetPlay": "PnR Pullup 3PT / Floater"
    },
    {
      "id": "3134907",
      "name": "Kyle Kuzma",
      "position": "PF",
      "jersey": "18",
      "isStarter": true,
      "earlyShotShare": 0.22,
      "shotMix": {
        "rim": 0.38,
        "mid": 0.22,
        "three": 0.4
      },
      "rimFG": 0.62,
      "midFG": 0.4,
      "threeFG": 0.35,
      "seasonUsage": 23,
      "scriptedSetPlay": "Wing Slash / Trail 3PT"
    },
    {
      "id": "4432848",
      "name": "Jaime Jaquez Jr.",
      "position": "SF",
      "jersey": "24",
      "isStarter": true,
      "earlyShotShare": 0.16,
      "shotMix": {
        "rim": 0.55,
        "mid": 0.3,
        "three": 0.15
      },
      "rimFG": 0.64,
      "midFG": 0.44,
      "threeFG": 0.33,
      "seasonUsage": 18,
      "scriptedSetPlay": "Baseline Post Footwork Spin"
    },
    {
      "id": "2991043",
      "name": "Caris LeVert",
      "position": "SG",
      "jersey": "12",
      "isStarter": true,
      "earlyShotShare": 0.12,
      "shotMix": {
        "rim": 0.35,
        "mid": 0.3,
        "three": 0.35
      },
      "rimFG": 0.6,
      "midFG": 0.4,
      "threeFG": 0.36,
      "seasonUsage": 16,
      "scriptedSetPlay": "DHO Drive / Kick"
    }
  ],
  "PHI": [
    {
      "id": "3059318",
      "name": "Joel Embiid",
      "position": "C",
      "jersey": "21",
      "isStarter": true,
      "earlyShotShare": 0.3,
      "shotMix": {
        "rim": 0.42,
        "mid": 0.44,
        "three": 0.14
      },
      "rimFG": 0.72,
      "midFG": 0.5,
      "threeFG": 0.37,
      "seasonUsage": 33,
      "scriptedSetPlay": "Mid-Post Nail Isolation & Foul Draw"
    },
    {
      "id": "4431678",
      "name": "Tyrese Maxey",
      "position": "PG",
      "jersey": "0",
      "isStarter": true,
      "earlyShotShare": 0.26,
      "shotMix": {
        "rim": 0.36,
        "mid": 0.21,
        "three": 0.43
      },
      "rimFG": 0.64,
      "midFG": 0.44,
      "threeFG": 0.38,
      "seasonUsage": 27,
      "scriptedSetPlay": "Early Drag Screen Pullup 3PT"
    },
    {
      "id": "1966",
      "name": "LeBron James",
      "position": "PF",
      "jersey": "23",
      "isStarter": true,
      "earlyShotShare": 0.24,
      "shotMix": {
        "rim": 0.48,
        "mid": 0.18,
        "three": 0.34
      },
      "rimFG": 0.73,
      "midFG": 0.45,
      "threeFG": 0.38,
      "seasonUsage": 27,
      "scriptedSetPlay": "Top PnR / High-Low Feed to Embiid"
    },
    {
      "id": "3917376",
      "name": "Jaylen Brown",
      "position": "SF",
      "jersey": "7",
      "isStarter": true,
      "earlyShotShare": 0.2,
      "shotMix": {
        "rim": 0.46,
        "mid": 0.26,
        "three": 0.28
      },
      "rimFG": 0.69,
      "midFG": 0.45,
      "threeFG": 0.36,
      "seasonUsage": 25,
      "scriptedSetPlay": "Cross-Screen Elbow Post-Up"
    },
    {
      "id": "2581018",
      "name": "Kentavious Caldwell-Pope",
      "position": "SG",
      "jersey": "1",
      "isStarter": true,
      "earlyShotShare": 0.08,
      "shotMix": {
        "rim": 0.15,
        "mid": 0.2,
        "three": 0.65
      },
      "rimFG": 0.6,
      "midFG": 0.42,
      "threeFG": 0.39,
      "seasonUsage": 12,
      "scriptedSetPlay": "Corner Catch-and-Shoot 3PT"
    }
  ],
  "BKN": [
    {
      "id": "4712896",
      "name": "Noah Clowney",
      "position": "C",
      "jersey": "21",
      "isStarter": true,
      "earlyShotShare": 0.14,
      "shotMix": {
        "rim": 0.75,
        "mid": 0.1,
        "three": 0.15
      },
      "rimFG": 0.68,
      "midFG": 0.38,
      "threeFG": 0.32,
      "seasonUsage": 15,
      "scriptedSetPlay": "PnR Lob Dunk / Putback"
    },
    {
      "id": "3064514",
      "name": "Julius Randle",
      "position": "PF",
      "jersey": "30",
      "isStarter": true,
      "earlyShotShare": 0.3,
      "shotMix": {
        "rim": 0.48,
        "mid": 0.28,
        "three": 0.24
      },
      "rimFG": 0.65,
      "midFG": 0.44,
      "threeFG": 0.35,
      "seasonUsage": 28,
      "scriptedSetPlay": "Elbow Bully Drive / Mid Fade"
    },
    {
      "id": "4278104",
      "name": "Michael Porter Jr.",
      "position": "SF",
      "jersey": "17",
      "isStarter": true,
      "earlyShotShare": 0.26,
      "shotMix": {
        "rim": 0.25,
        "mid": 0.15,
        "three": 0.6
      },
      "rimFG": 0.65,
      "midFG": 0.44,
      "threeFG": 0.41,
      "seasonUsage": 24,
      "scriptedSetPlay": "Transition Pin-Down 3PT"
    },
    {
      "id": "3907823",
      "name": "Terance Mann",
      "position": "SG",
      "jersey": "14",
      "isStarter": true,
      "earlyShotShare": 0.16,
      "shotMix": {
        "rim": 0.5,
        "mid": 0.15,
        "three": 0.35
      },
      "rimFG": 0.62,
      "midFG": 0.4,
      "threeFG": 0.36,
      "seasonUsage": 17,
      "scriptedSetPlay": "Corner Spacing 3PT / Slashing Drive"
    },
    {
      "id": "4702177",
      "name": "Keon Ellis",
      "position": "PG",
      "jersey": "1",
      "isStarter": true,
      "earlyShotShare": 0.14,
      "shotMix": {
        "rim": 0.3,
        "mid": 0.15,
        "three": 0.55
      },
      "rimFG": 0.6,
      "midFG": 0.4,
      "threeFG": 0.38,
      "seasonUsage": 15,
      "scriptedSetPlay": "Top PnR Distribute / Spot 3PT"
    }
  ],
  "CHA": [
    {
      "id": "4701232",
      "name": "Mark Williams",
      "position": "C",
      "jersey": "25",
      "isStarter": true,
      "earlyShotShare": 0.16,
      "shotMix": {
        "rim": 0.88,
        "mid": 0.12,
        "three": 0
      },
      "rimFG": 0.72,
      "midFG": 0.36,
      "threeFG": 0,
      "seasonUsage": 16,
      "scriptedSetPlay": "Alley-Oop Lob Finish"
    },
    {
      "id": "4433287",
      "name": "Brandon Miller",
      "position": "SF",
      "jersey": "24",
      "isStarter": true,
      "earlyShotShare": 0.28,
      "shotMix": {
        "rim": 0.3,
        "mid": 0.3,
        "three": 0.4
      },
      "rimFG": 0.64,
      "midFG": 0.46,
      "threeFG": 0.38,
      "seasonUsage": 27,
      "scriptedSetPlay": "Off-Ball Stagger Screen Curl"
    },
    {
      "id": "4395651",
      "name": "Coby White",
      "position": "PG",
      "jersey": "3",
      "isStarter": true,
      "earlyShotShare": 0.26,
      "shotMix": {
        "rim": 0.35,
        "mid": 0.25,
        "three": 0.4
      },
      "rimFG": 0.62,
      "midFG": 0.44,
      "threeFG": 0.38,
      "seasonUsage": 26,
      "scriptedSetPlay": "High Drag Pull-Up 3PT"
    },
    {
      "id": "3135045",
      "name": "Grayson Allen",
      "position": "SG",
      "jersey": "8",
      "isStarter": true,
      "earlyShotShare": 0.18,
      "shotMix": {
        "rim": 0.2,
        "mid": 0.15,
        "three": 0.65
      },
      "rimFG": 0.62,
      "midFG": 0.42,
      "threeFG": 0.42,
      "seasonUsage": 18,
      "scriptedSetPlay": "Corner Catch-and-Shoot 3PT"
    },
    {
      "id": "3032979",
      "name": "Dennis Schroder",
      "position": "SG",
      "jersey": "17",
      "isStarter": true,
      "earlyShotShare": 0.12,
      "shotMix": {
        "rim": 0.45,
        "mid": 0.25,
        "three": 0.3
      },
      "rimFG": 0.6,
      "midFG": 0.42,
      "threeFG": 0.35,
      "seasonUsage": 16,
      "scriptedSetPlay": "Quick PnR Paint Penetration"
    }
  ],
  "CHI": [
    {
      "id": "4278067",
      "name": "Nic Claxton",
      "position": "C",
      "jersey": "9",
      "isStarter": true,
      "earlyShotShare": 0.16,
      "shotMix": {
        "rim": 0.9,
        "mid": 0.1,
        "three": 0
      },
      "rimFG": 0.7,
      "midFG": 0.35,
      "threeFG": 0,
      "seasonUsage": 16,
      "scriptedSetPlay": "High PnR Roll / Putback Lob"
    },
    {
      "id": "4711294",
      "name": "Matas Buzelis",
      "position": "PF",
      "jersey": "14",
      "isStarter": true,
      "earlyShotShare": 0.22,
      "shotMix": {
        "rim": 0.5,
        "mid": 0.2,
        "three": 0.3
      },
      "rimFG": 0.64,
      "midFG": 0.4,
      "threeFG": 0.35,
      "seasonUsage": 22,
      "scriptedSetPlay": "Trailing Face-Up Drive"
    },
    {
      "id": "2595516",
      "name": "Norman Powell",
      "position": "SF",
      "jersey": "24",
      "isStarter": true,
      "earlyShotShare": 0.28,
      "shotMix": {
        "rim": 0.35,
        "mid": 0.25,
        "three": 0.4
      },
      "rimFG": 0.66,
      "midFG": 0.46,
      "threeFG": 0.42,
      "seasonUsage": 28,
      "scriptedSetPlay": "Catch-and-Shoot Flare 3PT / Drive"
    },
    {
      "id": "4871145",
      "name": "Josh Giddey",
      "position": "SG",
      "jersey": "3",
      "isStarter": true,
      "earlyShotShare": 0.2,
      "shotMix": {
        "rim": 0.45,
        "mid": 0.3,
        "three": 0.25
      },
      "rimFG": 0.6,
      "midFG": 0.44,
      "threeFG": 0.34,
      "seasonUsage": 21,
      "scriptedSetPlay": "Elbow Post-Up / Floater"
    },
    {
      "id": "4431687",
      "name": "Patrick Williams",
      "position": "PF",
      "jersey": "44",
      "isStarter": true,
      "earlyShotShare": 0.14,
      "shotMix": {
        "rim": 0.35,
        "mid": 0.2,
        "three": 0.45
      },
      "rimFG": 0.62,
      "midFG": 0.4,
      "threeFG": 0.37,
      "seasonUsage": 14,
      "scriptedSetPlay": "Weakside Spacing 3PT"
    }
  ],
  "DET": [
    {
      "id": "4433621",
      "name": "Jalen Duren",
      "position": "C",
      "jersey": "0",
      "isStarter": true,
      "earlyShotShare": 0.18,
      "shotMix": {
        "rim": 0.9,
        "mid": 0.1,
        "three": 0
      },
      "rimFG": 0.72,
      "midFG": 0.36,
      "threeFG": 0,
      "seasonUsage": 18,
      "scriptedSetPlay": "Cade PnR Alley-Oop Dunk"
    },
    {
      "id": "4432166",
      "name": "Cade Cunningham",
      "position": "PG",
      "jersey": "2",
      "isStarter": true,
      "earlyShotShare": 0.32,
      "shotMix": {
        "rim": 0.35,
        "mid": 0.35,
        "three": 0.3
      },
      "rimFG": 0.65,
      "midFG": 0.48,
      "threeFG": 0.37,
      "seasonUsage": 31,
      "scriptedSetPlay": "Horns Isolation Mid-Range Pullup"
    },
    {
      "id": "3908845",
      "name": "John Collins",
      "position": "PF",
      "jersey": "20",
      "isStarter": true,
      "earlyShotShare": 0.2,
      "shotMix": {
        "rim": 0.55,
        "mid": 0.15,
        "three": 0.3
      },
      "rimFG": 0.68,
      "midFG": 0.4,
      "threeFG": 0.35,
      "seasonUsage": 21,
      "scriptedSetPlay": "Pick-and-Pop 3PT / Roll Dunk"
    },
    {
      "id": "4066372",
      "name": "Kevin Huerter",
      "position": "SG",
      "jersey": "27",
      "isStarter": true,
      "earlyShotShare": 0.16,
      "shotMix": {
        "rim": 0.2,
        "mid": 0.2,
        "three": 0.6
      },
      "rimFG": 0.6,
      "midFG": 0.42,
      "threeFG": 0.38,
      "seasonUsage": 17,
      "scriptedSetPlay": "Pin-Down Curl 3PT"
    },
    {
      "id": "4683771",
      "name": "Ronald Holland II",
      "position": "SF",
      "jersey": "5",
      "isStarter": true,
      "earlyShotShare": 0.14,
      "shotMix": {
        "rim": 0.6,
        "mid": 0.15,
        "three": 0.25
      },
      "rimFG": 0.64,
      "midFG": 0.38,
      "threeFG": 0.33,
      "seasonUsage": 16,
      "scriptedSetPlay": "Slashing Fastbreak Layup"
    }
  ],
  "IND": [
    {
      "id": "4017837",
      "name": "Ivica Zubac",
      "position": "C",
      "jersey": "40",
      "isStarter": true,
      "earlyShotShare": 0.16,
      "shotMix": {
        "rim": 0.9,
        "mid": 0.1,
        "three": 0
      },
      "rimFG": 0.7,
      "midFG": 0.4,
      "threeFG": 0,
      "seasonUsage": 17,
      "scriptedSetPlay": "Haliburton Pocket Pass Hook Shot"
    },
    {
      "id": "3149673",
      "name": "Pascal Siakam",
      "position": "PF",
      "jersey": "43",
      "isStarter": true,
      "earlyShotShare": 0.28,
      "shotMix": {
        "rim": 0.55,
        "mid": 0.3,
        "three": 0.15
      },
      "rimFG": 0.7,
      "midFG": 0.46,
      "threeFG": 0.35,
      "seasonUsage": 27,
      "scriptedSetPlay": "Elbow Isolation Spin Move"
    },
    {
      "id": "4396993",
      "name": "Tyrese Haliburton",
      "position": "PG",
      "jersey": "0",
      "isStarter": true,
      "earlyShotShare": 0.24,
      "shotMix": {
        "rim": 0.25,
        "mid": 0.25,
        "three": 0.5
      },
      "rimFG": 0.65,
      "midFG": 0.48,
      "threeFG": 0.39,
      "seasonUsage": 25,
      "scriptedSetPlay": "Early Transition Step-Back 3PT"
    },
    {
      "id": "4395712",
      "name": "Andrew Nembhard",
      "position": "SG",
      "jersey": "2",
      "isStarter": true,
      "earlyShotShare": 0.18,
      "shotMix": {
        "rim": 0.4,
        "mid": 0.35,
        "three": 0.25
      },
      "rimFG": 0.62,
      "midFG": 0.44,
      "threeFG": 0.36,
      "seasonUsage": 18,
      "scriptedSetPlay": "PnR Mid-Range Floater"
    },
    {
      "id": "4396909",
      "name": "Aaron Nesmith",
      "position": "SF",
      "jersey": "23",
      "isStarter": true,
      "earlyShotShare": 0.14,
      "shotMix": {
        "rim": 0.3,
        "mid": 0.15,
        "three": 0.55
      },
      "rimFG": 0.64,
      "midFG": 0.42,
      "threeFG": 0.41,
      "seasonUsage": 15,
      "scriptedSetPlay": "Corner Flare 3PT"
    }
  ],
  "MIA": [
    {
      "id": "4066261",
      "name": "Bam Adebayo",
      "position": "C",
      "jersey": "13",
      "isStarter": true,
      "earlyShotShare": 0.24,
      "shotMix": {
        "rim": 0.55,
        "mid": 0.4,
        "three": 0.05
      },
      "rimFG": 0.68,
      "midFG": 0.47,
      "threeFG": 0.33,
      "seasonUsage": 23,
      "scriptedSetPlay": "Elbow Hub DHO / Short Roll Touch"
    },
    {
      "id": "3032977",
      "name": "Giannis Antetokounmpo",
      "position": "PF",
      "jersey": "7",
      "isStarter": true,
      "earlyShotShare": 0.36,
      "shotMix": {
        "rim": 0.74,
        "mid": 0.19,
        "three": 0.07
      },
      "rimFG": 0.76,
      "midFG": 0.41,
      "threeFG": 0.28,
      "seasonUsage": 34,
      "scriptedSetPlay": "Spoelstra Scripted Downhill Rim Attack"
    },
    {
      "id": "6475",
      "name": "Klay Thompson",
      "position": "SG",
      "jersey": "11",
      "isStarter": true,
      "earlyShotShare": 0.18,
      "shotMix": {
        "rim": 0.1,
        "mid": 0.25,
        "three": 0.65
      },
      "rimFG": 0.58,
      "midFG": 0.44,
      "threeFG": 0.39,
      "seasonUsage": 19,
      "scriptedSetPlay": "Pin-Down Flare Catch-and-Shoot 3PT"
    },
    {
      "id": "3059319",
      "name": "Andrew Wiggins",
      "position": "SF",
      "jersey": "22",
      "isStarter": true,
      "earlyShotShare": 0.14,
      "shotMix": {
        "rim": 0.4,
        "mid": 0.25,
        "three": 0.35
      },
      "rimFG": 0.64,
      "midFG": 0.42,
      "threeFG": 0.37,
      "seasonUsage": 17,
      "scriptedSetPlay": "Mid-Post Turnaround Jumper"
    },
    {
      "id": "4278053",
      "name": "Davion Mitchell",
      "position": "PG",
      "jersey": "2",
      "isStarter": true,
      "earlyShotShare": 0.08,
      "shotMix": {
        "rim": 0.35,
        "mid": 0.25,
        "three": 0.4
      },
      "rimFG": 0.58,
      "midFG": 0.4,
      "threeFG": 0.35,
      "seasonUsage": 13,
      "scriptedSetPlay": "Lead Guard PnR Deceleration"
    }
  ],
  "ORL": [
    {
      "id": "4277847",
      "name": "Wendell Carter Jr.",
      "position": "C",
      "jersey": "34",
      "isStarter": true,
      "earlyShotShare": 0.14,
      "shotMix": {
        "rim": 0.6,
        "mid": 0.15,
        "three": 0.25
      },
      "rimFG": 0.68,
      "midFG": 0.4,
      "threeFG": 0.35,
      "seasonUsage": 15,
      "scriptedSetPlay": "Pick-and-Pop 3PT / Roll"
    },
    {
      "id": "4432573",
      "name": "Paolo Banchero",
      "position": "PF",
      "jersey": "5",
      "isStarter": true,
      "earlyShotShare": 0.3,
      "shotMix": {
        "rim": 0.48,
        "mid": 0.32,
        "three": 0.2
      },
      "rimFG": 0.68,
      "midFG": 0.44,
      "threeFG": 0.35,
      "seasonUsage": 31,
      "scriptedSetPlay": "Moseley Scripted Nail Isolation Drive"
    },
    {
      "id": "4566434",
      "name": "Franz Wagner",
      "position": "SF",
      "jersey": "22",
      "isStarter": true,
      "earlyShotShare": 0.26,
      "shotMix": {
        "rim": 0.52,
        "mid": 0.2,
        "three": 0.28
      },
      "rimFG": 0.68,
      "midFG": 0.44,
      "threeFG": 0.36,
      "seasonUsage": 26,
      "scriptedSetPlay": "Eurostep Slashing Rim Attack"
    },
    {
      "id": "4066320",
      "name": "Desmond Bane",
      "position": "SG",
      "jersey": "3",
      "isStarter": true,
      "earlyShotShare": 0.2,
      "shotMix": {
        "rim": 0.25,
        "mid": 0.25,
        "three": 0.5
      },
      "rimFG": 0.64,
      "midFG": 0.46,
      "threeFG": 0.41,
      "seasonUsage": 22,
      "scriptedSetPlay": "Off-Screen Curl Pullup 3PT"
    },
    {
      "id": "4432165",
      "name": "Jalen Suggs",
      "position": "PG",
      "jersey": "4",
      "isStarter": true,
      "earlyShotShare": 0.1,
      "shotMix": {
        "rim": 0.35,
        "mid": 0.15,
        "three": 0.5
      },
      "rimFG": 0.62,
      "midFG": 0.4,
      "threeFG": 0.38,
      "seasonUsage": 14,
      "scriptedSetPlay": "Transition Wing 3PT"
    }
  ],
  "TOR": [
    {
      "id": "3134908",
      "name": "Jakob Poeltl",
      "position": "C",
      "jersey": "19",
      "isStarter": true,
      "earlyShotShare": 0.15,
      "shotMix": {
        "rim": 0.9,
        "mid": 0.1,
        "three": 0
      },
      "rimFG": 0.7,
      "midFG": 0.35,
      "threeFG": 0,
      "seasonUsage": 15,
      "scriptedSetPlay": "Quick Slip Screen Hook Shot"
    },
    {
      "id": "4433134",
      "name": "Scottie Barnes",
      "position": "PF",
      "jersey": "4",
      "isStarter": true,
      "earlyShotShare": 0.26,
      "shotMix": {
        "rim": 0.5,
        "mid": 0.25,
        "three": 0.25
      },
      "rimFG": 0.68,
      "midFG": 0.44,
      "threeFG": 0.35,
      "seasonUsage": 26,
      "scriptedSetPlay": "Point Forward Cross-Match Rim Attack"
    },
    {
      "id": "6450",
      "name": "Kawhi Leonard",
      "position": "SF",
      "jersey": "2",
      "isStarter": true,
      "earlyShotShare": 0.28,
      "shotMix": {
        "rim": 0.35,
        "mid": 0.4,
        "three": 0.25
      },
      "rimFG": 0.7,
      "midFG": 0.5,
      "threeFG": 0.39,
      "seasonUsage": 28,
      "scriptedSetPlay": "Mid-Post Isolation Turnaround Jumper"
    },
    {
      "id": "4395625",
      "name": "RJ Barrett",
      "position": "SG",
      "jersey": "9",
      "isStarter": true,
      "earlyShotShare": 0.18,
      "shotMix": {
        "rim": 0.58,
        "mid": 0.18,
        "three": 0.24
      },
      "rimFG": 0.67,
      "midFG": 0.4,
      "threeFG": 0.35,
      "seasonUsage": 22,
      "scriptedSetPlay": "Left-Hand Downhill Drive"
    },
    {
      "id": "4395724",
      "name": "Immanuel Quickley",
      "position": "PG",
      "jersey": "5",
      "isStarter": true,
      "earlyShotShare": 0.13,
      "shotMix": {
        "rim": 0.3,
        "mid": 0.3,
        "three": 0.4
      },
      "rimFG": 0.62,
      "midFG": 0.46,
      "threeFG": 0.38,
      "seasonUsage": 18,
      "scriptedSetPlay": "High PnR Floater / 3PT"
    }
  ],
  "WAS": [
    {
      "id": "6583",
      "name": "Anthony Davis",
      "position": "C",
      "jersey": "23",
      "isStarter": true,
      "earlyShotShare": 0.32,
      "shotMix": {
        "rim": 0.6,
        "mid": 0.25,
        "three": 0.15
      },
      "rimFG": 0.75,
      "midFG": 0.46,
      "threeFG": 0.32,
      "seasonUsage": 31,
      "scriptedSetPlay": "Trae Young High Lob / Post Cross Screen"
    },
    {
      "id": "4277905",
      "name": "Trae Young",
      "position": "PG",
      "jersey": "3",
      "isStarter": true,
      "earlyShotShare": 0.28,
      "shotMix": {
        "rim": 0.25,
        "mid": 0.25,
        "three": 0.5
      },
      "rimFG": 0.62,
      "midFG": 0.45,
      "threeFG": 0.38,
      "seasonUsage": 30,
      "scriptedSetPlay": "Logo Pullup 3PT / PnR Floater"
    },
    {
      "id": "4278129",
      "name": "Deandre Ayton",
      "position": "C",
      "jersey": "8",
      "isStarter": true,
      "earlyShotShare": 0.18,
      "shotMix": {
        "rim": 0.7,
        "mid": 0.25,
        "three": 0.05
      },
      "rimFG": 0.68,
      "midFG": 0.46,
      "threeFG": 0.3,
      "seasonUsage": 19,
      "scriptedSetPlay": "Short-Roll Mid Jumper / Dunk"
    },
    {
      "id": "5104155",
      "name": "Bilal Coulibaly",
      "position": "SF",
      "jersey": "0",
      "isStarter": true,
      "earlyShotShare": 0.12,
      "shotMix": {
        "rim": 0.55,
        "mid": 0.15,
        "three": 0.3
      },
      "rimFG": 0.65,
      "midFG": 0.38,
      "threeFG": 0.35,
      "seasonUsage": 15,
      "scriptedSetPlay": "Baseline Slashing Rim Drive"
    },
    {
      "id": "4845374",
      "name": "Bub Carrington",
      "position": "SG",
      "jersey": "7",
      "isStarter": true,
      "earlyShotShare": 0.1,
      "shotMix": {
        "rim": 0.3,
        "mid": 0.35,
        "three": 0.35
      },
      "rimFG": 0.58,
      "midFG": 0.42,
      "threeFG": 0.36,
      "seasonUsage": 13,
      "scriptedSetPlay": "Corner Spacing Spot 3PT"
    }
  ],
  "SAS": [
    {
      "id": "5104157",
      "name": "Victor Wembanyama",
      "position": "C",
      "jersey": "1",
      "isStarter": true,
      "earlyShotShare": 0.35,
      "shotMix": {
        "rim": 0.45,
        "mid": 0.15,
        "three": 0.4
      },
      "rimFG": 0.74,
      "midFG": 0.44,
      "threeFG": 0.34,
      "seasonUsage": 33,
      "scriptedSetPlay": "Popovich High-Low Lob / Trail 3PT"
    },
    {
      "id": "4066259",
      "name": "De'Aaron Fox",
      "position": "PG",
      "jersey": "4",
      "isStarter": true,
      "earlyShotShare": 0.26,
      "shotMix": {
        "rim": 0.45,
        "mid": 0.25,
        "three": 0.3
      },
      "rimFG": 0.67,
      "midFG": 0.46,
      "threeFG": 0.37,
      "seasonUsage": 28,
      "scriptedSetPlay": "Early Drag Step-Back / Downhill Drive"
    },
    {
      "id": "4395630",
      "name": "Devin Vassell",
      "position": "SG",
      "jersey": "24",
      "isStarter": true,
      "earlyShotShare": 0.2,
      "shotMix": {
        "rim": 0.25,
        "mid": 0.35,
        "three": 0.4
      },
      "rimFG": 0.62,
      "midFG": 0.46,
      "threeFG": 0.38,
      "seasonUsage": 22,
      "scriptedSetPlay": "Pin-Down Mid-Range Curl"
    },
    {
      "id": "4845367",
      "name": "Stephon Castle",
      "position": "SF",
      "jersey": "5",
      "isStarter": true,
      "earlyShotShare": 0.11,
      "shotMix": {
        "rim": 0.5,
        "mid": 0.25,
        "three": 0.25
      },
      "rimFG": 0.63,
      "midFG": 0.41,
      "threeFG": 0.33,
      "seasonUsage": 15,
      "scriptedSetPlay": "Slashing Rim Cut"
    },
    {
      "id": "4395723",
      "name": "Keldon Johnson",
      "position": "PF",
      "jersey": "3",
      "isStarter": true,
      "earlyShotShare": 0.08,
      "shotMix": {
        "rim": 0.55,
        "mid": 0.15,
        "three": 0.3
      },
      "rimFG": 0.65,
      "midFG": 0.38,
      "threeFG": 0.35,
      "seasonUsage": 14,
      "scriptedSetPlay": "Corner Spot 3PT / Transition Drive"
    }
  ],
  "OKC": [
    {
      "id": "4278073",
      "name": "Shai Gilgeous-Alexander",
      "position": "PG",
      "jersey": "2",
      "isStarter": true,
      "earlyShotShare": 0.32,
      "shotMix": {
        "rim": 0.45,
        "mid": 0.35,
        "three": 0.2
      },
      "rimFG": 0.67,
      "midFG": 0.5,
      "threeFG": 0.36,
      "seasonUsage": 33,
      "scriptedSetPlay": "Step-Back Mid-Range / Isolation Drive"
    },
    {
      "id": "4433255",
      "name": "Chet Holmgren",
      "position": "C",
      "jersey": "7",
      "isStarter": true,
      "earlyShotShare": 0.26,
      "shotMix": {
        "rim": 0.5,
        "mid": 0.15,
        "three": 0.35
      },
      "rimFG": 0.72,
      "midFG": 0.44,
      "threeFG": 0.38,
      "seasonUsage": 23,
      "scriptedSetPlay": "Pick-and-Pop 3PT / Dive to Rim"
    },
    {
      "id": "4593803",
      "name": "Jalen Williams",
      "position": "SG",
      "jersey": "8",
      "isStarter": true,
      "earlyShotShare": 0.2,
      "shotMix": {
        "rim": 0.45,
        "mid": 0.25,
        "three": 0.3
      },
      "rimFG": 0.64,
      "midFG": 0.46,
      "threeFG": 0.4,
      "seasonUsage": 22,
      "scriptedSetPlay": "Daigneault Scripted Baseline Cutter"
    },
    {
      "id": "2991350",
      "name": "Alex Caruso",
      "position": "PF",
      "jersey": "9",
      "isStarter": true,
      "earlyShotShare": 0.12,
      "shotMix": {
        "rim": 0.25,
        "mid": 0.15,
        "three": 0.6
      },
      "rimFG": 0.6,
      "midFG": 0.4,
      "threeFG": 0.37,
      "seasonUsage": 13,
      "scriptedSetPlay": "Backdoor Cut / Spot-up 3PT"
    },
    {
      "id": "4683692",
      "name": "Cason Wallace",
      "position": "SF",
      "jersey": "22",
      "isStarter": true,
      "earlyShotShare": 0.1,
      "shotMix": {
        "rim": 0.3,
        "mid": 0.15,
        "three": 0.55
      },
      "rimFG": 0.6,
      "midFG": 0.38,
      "threeFG": 0.38,
      "seasonUsage": 12,
      "scriptedSetPlay": "Corner 3PT Catch & Shoot"
    }
  ],
  "LAL": [
    {
      "id": "4433136",
      "name": "Walker Kessler",
      "position": "C",
      "jersey": "14",
      "isStarter": true,
      "earlyShotShare": 0.12,
      "shotMix": {
        "rim": 0.92,
        "mid": 0.08,
        "three": 0
      },
      "rimFG": 0.72,
      "midFG": 0.32,
      "threeFG": 0,
      "seasonUsage": 13,
      "scriptedSetPlay": "Luka Alley-Oop PnR Dunk"
    },
    {
      "id": "3945274",
      "name": "Luka Doncic",
      "position": "PG",
      "jersey": "77",
      "isStarter": true,
      "earlyShotShare": 0.36,
      "shotMix": {
        "rim": 0.3,
        "mid": 0.3,
        "three": 0.4
      },
      "rimFG": 0.72,
      "midFG": 0.5,
      "threeFG": 0.38,
      "seasonUsage": 36,
      "scriptedSetPlay": "Step-Back 3PT / Paint Deceleration"
    },
    {
      "id": "4066457",
      "name": "Austin Reaves",
      "position": "SG",
      "jersey": "15",
      "isStarter": true,
      "earlyShotShare": 0.22,
      "shotMix": {
        "rim": 0.3,
        "mid": 0.3,
        "three": 0.4
      },
      "rimFG": 0.65,
      "midFG": 0.46,
      "threeFG": 0.37,
      "seasonUsage": 22,
      "scriptedSetPlay": "DHO Wing Drive / Foul Draw"
    },
    {
      "id": "4277811",
      "name": "Collin Sexton",
      "position": "SF",
      "jersey": "10",
      "isStarter": true,
      "earlyShotShare": 0.2,
      "shotMix": {
        "rim": 0.5,
        "mid": 0.25,
        "three": 0.25
      },
      "rimFG": 0.65,
      "midFG": 0.45,
      "threeFG": 0.36,
      "seasonUsage": 23,
      "scriptedSetPlay": "Transition Bulldozer Paint Attack"
    },
    {
      "id": "4278077",
      "name": "Jarred Vanderbilt",
      "position": "PF",
      "jersey": "2",
      "isStarter": true,
      "earlyShotShare": 0.1,
      "shotMix": {
        "rim": 0.65,
        "mid": 0.15,
        "three": 0.2
      },
      "rimFG": 0.64,
      "midFG": 0.36,
      "threeFG": 0.3,
      "seasonUsage": 12,
      "scriptedSetPlay": "Baseline Dunker Spot Cut"
    }
  ],
  "DEN": [
    {
      "id": "3112335",
      "name": "Nikola Jokic",
      "position": "C",
      "jersey": "15",
      "isStarter": true,
      "earlyShotShare": 0.3,
      "shotMix": {
        "rim": 0.55,
        "mid": 0.3,
        "three": 0.15
      },
      "rimFG": 0.71,
      "midFG": 0.52,
      "threeFG": 0.38,
      "seasonUsage": 30,
      "scriptedSetPlay": "Low Block Sombor Shuffle / Elbow Touch"
    },
    {
      "id": "3936299",
      "name": "Jamal Murray",
      "position": "PG",
      "jersey": "27",
      "isStarter": true,
      "earlyShotShare": 0.28,
      "shotMix": {
        "rim": 0.25,
        "mid": 0.35,
        "three": 0.4
      },
      "rimFG": 0.63,
      "midFG": 0.48,
      "threeFG": 0.41,
      "seasonUsage": 27,
      "scriptedSetPlay": "Malone Two-Man Two-Side Action PnR"
    },
    {
      "id": "3138196",
      "name": "Cameron Johnson",
      "position": "SF",
      "jersey": "23",
      "isStarter": true,
      "earlyShotShare": 0.18,
      "shotMix": {
        "rim": 0.2,
        "mid": 0.2,
        "three": 0.6
      },
      "rimFG": 0.65,
      "midFG": 0.44,
      "threeFG": 0.4,
      "seasonUsage": 18,
      "scriptedSetPlay": "Transition Trail 3PT / Flare"
    },
    {
      "id": "3064290",
      "name": "Aaron Gordon",
      "position": "PF",
      "jersey": "32",
      "isStarter": true,
      "earlyShotShare": 0.14,
      "shotMix": {
        "rim": 0.75,
        "mid": 0.15,
        "three": 0.1
      },
      "rimFG": 0.7,
      "midFG": 0.38,
      "threeFG": 0.34,
      "seasonUsage": 16,
      "scriptedSetPlay": "Jokic Backdoor Lob / Dunker Spot"
    },
    {
      "id": "4431767",
      "name": "Christian Braun",
      "position": "SG",
      "jersey": "0",
      "isStarter": true,
      "earlyShotShare": 0.1,
      "shotMix": {
        "rim": 0.55,
        "mid": 0.15,
        "three": 0.3
      },
      "rimFG": 0.66,
      "midFG": 0.4,
      "threeFG": 0.38,
      "seasonUsage": 14,
      "scriptedSetPlay": "Corner Cut Fastbreak Layup"
    }
  ],
  "SAC": [
    {
      "id": "3155942",
      "name": "Domantas Sabonis",
      "position": "C",
      "jersey": "11",
      "isStarter": true,
      "earlyShotShare": 0.24,
      "shotMix": {
        "rim": 0.65,
        "mid": 0.25,
        "three": 0.1
      },
      "rimFG": 0.7,
      "midFG": 0.45,
      "threeFG": 0.36,
      "seasonUsage": 22,
      "scriptedSetPlay": "High DHO Roll / Elbow Jumper"
    },
    {
      "id": "3064440",
      "name": "Zach LaVine",
      "position": "SG",
      "jersey": "8",
      "isStarter": true,
      "earlyShotShare": 0.3,
      "shotMix": {
        "rim": 0.35,
        "mid": 0.25,
        "three": 0.4
      },
      "rimFG": 0.65,
      "midFG": 0.45,
      "threeFG": 0.38,
      "seasonUsage": 28,
      "scriptedSetPlay": "High PnR Pullup 3PT / Attack"
    },
    {
      "id": "4065732",
      "name": "De'Andre Hunter",
      "position": "SF",
      "jersey": "15",
      "isStarter": true,
      "earlyShotShare": 0.2,
      "shotMix": {
        "rim": 0.3,
        "mid": 0.35,
        "three": 0.35
      },
      "rimFG": 0.64,
      "midFG": 0.44,
      "threeFG": 0.38,
      "seasonUsage": 20,
      "scriptedSetPlay": "Mid-Range Post-Up Fade"
    },
    {
      "id": "4594327",
      "name": "Keegan Murray",
      "position": "PF",
      "jersey": "13",
      "isStarter": true,
      "earlyShotShare": 0.16,
      "shotMix": {
        "rim": 0.3,
        "mid": 0.2,
        "three": 0.5
      },
      "rimFG": 0.64,
      "midFG": 0.42,
      "threeFG": 0.38,
      "seasonUsage": 17,
      "scriptedSetPlay": "Pick-and-Pop 3PT / Wing Flare"
    },
    {
      "id": "5142620",
      "name": "Darius Acuff Jr.",
      "position": "PG",
      "jersey": "5",
      "isStarter": true,
      "earlyShotShare": 0.1,
      "shotMix": {
        "rim": 0.4,
        "mid": 0.25,
        "three": 0.35
      },
      "rimFG": 0.58,
      "midFG": 0.4,
      "threeFG": 0.35,
      "seasonUsage": 15,
      "scriptedSetPlay": "Transition Drive / Kick"
    }
  ],
  "NOP": [
    {
      "id": "5061589",
      "name": "Yves Missi",
      "position": "C",
      "jersey": "21",
      "isStarter": true,
      "earlyShotShare": 0.13,
      "shotMix": {
        "rim": 0.88,
        "mid": 0.12,
        "three": 0
      },
      "rimFG": 0.68,
      "midFG": 0.35,
      "threeFG": 0,
      "seasonUsage": 14,
      "scriptedSetPlay": "High PnR Roll / Putback Lob"
    },
    {
      "id": "4395628",
      "name": "Zion Williamson",
      "position": "PF",
      "jersey": "1",
      "isStarter": true,
      "earlyShotShare": 0.28,
      "shotMix": {
        "rim": 0.82,
        "mid": 0.16,
        "three": 0.02
      },
      "rimFG": 0.72,
      "midFG": 0.42,
      "threeFG": 0.25,
      "seasonUsage": 30,
      "scriptedSetPlay": "Point Zion Bully-Ball Rim Attack"
    },
    {
      "id": "4397688",
      "name": "Trey Murphy III",
      "position": "SF",
      "jersey": "25",
      "isStarter": true,
      "earlyShotShare": 0.24,
      "shotMix": {
        "rim": 0.25,
        "mid": 0.15,
        "three": 0.6
      },
      "rimFG": 0.66,
      "midFG": 0.44,
      "threeFG": 0.41,
      "seasonUsage": 23,
      "scriptedSetPlay": "Deep Transition Pull-Up 3PT"
    },
    {
      "id": "4277956",
      "name": "Jordan Poole",
      "position": "SG",
      "jersey": "3",
      "isStarter": true,
      "earlyShotShare": 0.2,
      "shotMix": {
        "rim": 0.3,
        "mid": 0.25,
        "three": 0.45
      },
      "rimFG": 0.62,
      "midFG": 0.44,
      "threeFG": 0.36,
      "seasonUsage": 25,
      "scriptedSetPlay": "Early Isolation Step-Back 3PT"
    },
    {
      "id": "3907497",
      "name": "Dejounte Murray",
      "position": "PG",
      "jersey": "5",
      "isStarter": true,
      "earlyShotShare": 0.15,
      "shotMix": {
        "rim": 0.35,
        "mid": 0.35,
        "three": 0.3
      },
      "rimFG": 0.62,
      "midFG": 0.45,
      "threeFG": 0.36,
      "seasonUsage": 22,
      "scriptedSetPlay": "High PnR Pull-Up Mid Jumper"
    }
  ],
  "MEM": [
    {
      "id": "4600663",
      "name": "Zach Edey",
      "position": "C",
      "jersey": "14",
      "isStarter": true,
      "earlyShotShare": 0.22,
      "shotMix": {
        "rim": 0.9,
        "mid": 0.1,
        "three": 0
      },
      "rimFG": 0.72,
      "midFG": 0.35,
      "threeFG": 0,
      "seasonUsage": 18,
      "scriptedSetPlay": "Deep Seal Hook Shot / Putback"
    },
    {
      "id": "5041935",
      "name": "Cameron Boozer",
      "position": "PF",
      "jersey": "27",
      "isStarter": true,
      "earlyShotShare": 0.28,
      "shotMix": {
        "rim": 0.55,
        "mid": 0.25,
        "three": 0.2
      },
      "rimFG": 0.68,
      "midFG": 0.46,
      "threeFG": 0.36,
      "seasonUsage": 26,
      "scriptedSetPlay": "Face-Up High Post Drive / Mid-Jumper"
    },
    {
      "id": "4903027",
      "name": "Cedric Coward",
      "position": "SF",
      "jersey": "23",
      "isStarter": true,
      "earlyShotShare": 0.18,
      "shotMix": {
        "rim": 0.4,
        "mid": 0.2,
        "three": 0.4
      },
      "rimFG": 0.62,
      "midFG": 0.42,
      "threeFG": 0.37,
      "seasonUsage": 19,
      "scriptedSetPlay": "Wing Flare 3PT / DHO"
    },
    {
      "id": "5112087",
      "name": "Jaylen Wells",
      "position": "SG",
      "jersey": "0",
      "isStarter": true,
      "earlyShotShare": 0.14,
      "shotMix": {
        "rim": 0.25,
        "mid": 0.15,
        "three": 0.6
      },
      "rimFG": 0.62,
      "midFG": 0.4,
      "threeFG": 0.39,
      "seasonUsage": 16,
      "scriptedSetPlay": "Corner Spacing 3PT"
    },
    {
      "id": "4065733",
      "name": "Ty Jerome",
      "position": "PG",
      "jersey": "2",
      "isStarter": true,
      "earlyShotShare": 0.18,
      "shotMix": {
        "rim": 0.25,
        "mid": 0.4,
        "three": 0.35
      },
      "rimFG": 0.6,
      "midFG": 0.45,
      "threeFG": 0.38,
      "seasonUsage": 20,
      "scriptedSetPlay": "Pick-and-Roll Floater"
    }
  ],
  "POR": [
    {
      "id": "5105565",
      "name": "Donovan Clingan",
      "position": "C",
      "jersey": "23",
      "isStarter": true,
      "earlyShotShare": 0.16,
      "shotMix": {
        "rim": 0.9,
        "mid": 0.1,
        "three": 0
      },
      "rimFG": 0.7,
      "midFG": 0.3,
      "threeFG": 0,
      "seasonUsage": 16,
      "scriptedSetPlay": "Morant Alley-Oop Lob / Rim Seal"
    },
    {
      "id": "4431736",
      "name": "Toumani Camara",
      "position": "PF",
      "jersey": "33",
      "isStarter": true,
      "earlyShotShare": 0.1,
      "shotMix": {
        "rim": 0.4,
        "mid": 0.15,
        "three": 0.45
      },
      "rimFG": 0.6,
      "midFG": 0.36,
      "threeFG": 0.35,
      "seasonUsage": 12,
      "scriptedSetPlay": "Baseline Cut Layup"
    },
    {
      "id": "4683021",
      "name": "Deni Avdija",
      "position": "SF",
      "jersey": "8",
      "isStarter": true,
      "earlyShotShare": 0.2,
      "shotMix": {
        "rim": 0.5,
        "mid": 0.2,
        "three": 0.3
      },
      "rimFG": 0.66,
      "midFG": 0.44,
      "threeFG": 0.37,
      "seasonUsage": 22,
      "scriptedSetPlay": "Early Fastbreak Rim Attack"
    },
    {
      "id": "6606",
      "name": "Damian Lillard",
      "position": "PG",
      "jersey": "0",
      "isStarter": true,
      "earlyShotShare": 0.26,
      "shotMix": {
        "rim": 0.25,
        "mid": 0.2,
        "three": 0.55
      },
      "rimFG": 0.62,
      "midFG": 0.45,
      "threeFG": 0.38,
      "seasonUsage": 27,
      "scriptedSetPlay": "Deep Logo Pullup 3PT"
    },
    {
      "id": "4279888",
      "name": "Ja Morant",
      "position": "SG",
      "jersey": "1",
      "isStarter": true,
      "earlyShotShare": 0.28,
      "shotMix": {
        "rim": 0.6,
        "mid": 0.2,
        "three": 0.2
      },
      "rimFG": 0.69,
      "midFG": 0.42,
      "threeFG": 0.34,
      "seasonUsage": 30,
      "scriptedSetPlay": "High Screen Explosive Paint Penetration"
    }
  ],
  "DAL": [
    {
      "id": "4683688",
      "name": "Dereck Lively II",
      "position": "C",
      "jersey": "2",
      "isStarter": true,
      "earlyShotShare": 0.14,
      "shotMix": {
        "rim": 0.95,
        "mid": 0.05,
        "three": 0
      },
      "rimFG": 0.74,
      "midFG": 0.3,
      "threeFG": 0,
      "seasonUsage": 14,
      "scriptedSetPlay": "Kyrie Alley-Oop Lob Finish"
    },
    {
      "id": "5041939",
      "name": "Cooper Flagg",
      "position": "PF",
      "jersey": "32",
      "isStarter": true,
      "earlyShotShare": 0.3,
      "shotMix": {
        "rim": 0.55,
        "mid": 0.25,
        "three": 0.2
      },
      "rimFG": 0.69,
      "midFG": 0.46,
      "threeFG": 0.36,
      "seasonUsage": 28,
      "scriptedSetPlay": "Kidd Scripted Horns Post-Up / Rim Drive"
    },
    {
      "id": "6442",
      "name": "Kyrie Irving",
      "position": "PG",
      "jersey": "11",
      "isStarter": true,
      "earlyShotShare": 0.28,
      "shotMix": {
        "rim": 0.35,
        "mid": 0.35,
        "three": 0.3
      },
      "rimFG": 0.66,
      "midFG": 0.5,
      "threeFG": 0.41,
      "seasonUsage": 29,
      "scriptedSetPlay": "Isolation Crossover Pullup Jumper"
    },
    {
      "id": "4278078",
      "name": "P.J. Washington",
      "position": "SF",
      "jersey": "25",
      "isStarter": true,
      "earlyShotShare": 0.16,
      "shotMix": {
        "rim": 0.4,
        "mid": 0.15,
        "three": 0.45
      },
      "rimFG": 0.62,
      "midFG": 0.38,
      "threeFG": 0.36,
      "seasonUsage": 16,
      "scriptedSetPlay": "Corner Spacing 3PT / Cut"
    },
    {
      "id": "4278049",
      "name": "Daniel Gafford",
      "position": "C",
      "jersey": "21",
      "isStarter": true,
      "earlyShotShare": 0.12,
      "shotMix": {
        "rim": 0.9,
        "mid": 0.1,
        "three": 0
      },
      "rimFG": 0.72,
      "midFG": 0.35,
      "threeFG": 0,
      "seasonUsage": 14,
      "scriptedSetPlay": "Pick-and-Roll Dunker Spot Finish"
    }
  ],
  "GSW": [
    {
      "id": "3102531",
      "name": "Kristaps Porzingis",
      "position": "C",
      "jersey": "7",
      "isStarter": true,
      "earlyShotShare": 0.22,
      "shotMix": {
        "rim": 0.45,
        "mid": 0.15,
        "three": 0.4
      },
      "rimFG": 0.7,
      "midFG": 0.46,
      "threeFG": 0.38,
      "seasonUsage": 24,
      "scriptedSetPlay": "Pick-and-Pop 3PT / Trail Screen"
    },
    {
      "id": "3975",
      "name": "Stephen Curry",
      "position": "PG",
      "jersey": "30",
      "isStarter": true,
      "earlyShotShare": 0.34,
      "shotMix": {
        "rim": 0.25,
        "mid": 0.2,
        "three": 0.55
      },
      "rimFG": 0.68,
      "midFG": 0.48,
      "threeFG": 0.42,
      "seasonUsage": 32,
      "scriptedSetPlay": "Kerr Elevator Screen Deep 3PT"
    },
    {
      "id": "6430",
      "name": "Jimmy Butler III",
      "position": "SF",
      "jersey": "10",
      "isStarter": true,
      "earlyShotShare": 0.26,
      "shotMix": {
        "rim": 0.55,
        "mid": 0.35,
        "three": 0.1
      },
      "rimFG": 0.68,
      "midFG": 0.46,
      "threeFG": 0.36,
      "seasonUsage": 27,
      "scriptedSetPlay": "Isolation Post-Up Foul Draw"
    },
    {
      "id": "6589",
      "name": "Draymond Green",
      "position": "PF",
      "jersey": "23",
      "isStarter": true,
      "earlyShotShare": 0.08,
      "shotMix": {
        "rim": 0.5,
        "mid": 0.2,
        "three": 0.3
      },
      "rimFG": 0.6,
      "midFG": 0.38,
      "threeFG": 0.33,
      "seasonUsage": 12,
      "scriptedSetPlay": "Top DHO Hub / Pocket Pass"
    },
    {
      "id": "4709138",
      "name": "Brandin Podziemski",
      "position": "SG",
      "jersey": "2",
      "isStarter": true,
      "earlyShotShare": 0.1,
      "shotMix": {
        "rim": 0.4,
        "mid": 0.25,
        "three": 0.35
      },
      "rimFG": 0.6,
      "midFG": 0.42,
      "threeFG": 0.37,
      "seasonUsage": 14,
      "scriptedSetPlay": "Floater in the Lane / Kick"
    }
  ],
  "HOU": [
    {
      "id": "4871144",
      "name": "Alperen Sengun",
      "position": "C",
      "jersey": "28",
      "isStarter": true,
      "earlyShotShare": 0.26,
      "shotMix": {
        "rim": 0.65,
        "mid": 0.25,
        "three": 0.1
      },
      "rimFG": 0.68,
      "midFG": 0.46,
      "threeFG": 0.31,
      "seasonUsage": 26,
      "scriptedSetPlay": "Udoka Low Block Post-Up Touch"
    },
    {
      "id": "3202",
      "name": "Kevin Durant",
      "position": "PF",
      "jersey": "7",
      "isStarter": true,
      "earlyShotShare": 0.32,
      "shotMix": {
        "rim": 0.25,
        "mid": 0.45,
        "three": 0.3
      },
      "rimFG": 0.74,
      "midFG": 0.54,
      "threeFG": 0.42,
      "seasonUsage": 31,
      "scriptedSetPlay": "High Post Isolation Mid-Range Pullup"
    },
    {
      "id": "2991230",
      "name": "Fred VanVleet",
      "position": "PG",
      "jersey": "5",
      "isStarter": true,
      "earlyShotShare": 0.18,
      "shotMix": {
        "rim": 0.2,
        "mid": 0.2,
        "three": 0.6
      },
      "rimFG": 0.56,
      "midFG": 0.42,
      "threeFG": 0.38,
      "seasonUsage": 19,
      "scriptedSetPlay": "Deep Logo 3PT Off PnR"
    },
    {
      "id": "4684740",
      "name": "Amen Thompson",
      "position": "SF",
      "jersey": "1",
      "isStarter": true,
      "earlyShotShare": 0.14,
      "shotMix": {
        "rim": 0.65,
        "mid": 0.2,
        "three": 0.15
      },
      "rimFG": 0.66,
      "midFG": 0.4,
      "threeFG": 0.28,
      "seasonUsage": 18,
      "scriptedSetPlay": "Baseline Cut / Explosive Dunk"
    },
    {
      "id": "4711272",
      "name": "Reed Sheppard",
      "position": "SG",
      "jersey": "15",
      "isStarter": true,
      "earlyShotShare": 0.1,
      "shotMix": {
        "rim": 0.2,
        "mid": 0.2,
        "three": 0.6
      },
      "rimFG": 0.6,
      "midFG": 0.42,
      "threeFG": 0.41,
      "seasonUsage": 14,
      "scriptedSetPlay": "Corner Catch-and-Shoot 3PT"
    }
  ],
  "LAC": [
    {
      "id": "3448",
      "name": "Brook Lopez",
      "position": "C",
      "jersey": "11",
      "isStarter": true,
      "earlyShotShare": 0.14,
      "shotMix": {
        "rim": 0.36,
        "mid": 0.14,
        "three": 0.5
      },
      "rimFG": 0.68,
      "midFG": 0.42,
      "threeFG": 0.37,
      "seasonUsage": 16,
      "scriptedSetPlay": "Pick-and-Pop Trail 3PT"
    },
    {
      "id": "3913176",
      "name": "Brandon Ingram",
      "position": "SF",
      "jersey": "7",
      "isStarter": true,
      "earlyShotShare": 0.3,
      "shotMix": {
        "rim": 0.35,
        "mid": 0.45,
        "three": 0.2
      },
      "rimFG": 0.66,
      "midFG": 0.48,
      "threeFG": 0.36,
      "seasonUsage": 29,
      "scriptedSetPlay": "Mid-Range Isolation Pullup"
    },
    {
      "id": "4396907",
      "name": "Darius Garland",
      "position": "PG",
      "jersey": "10",
      "isStarter": true,
      "earlyShotShare": 0.28,
      "shotMix": {
        "rim": 0.3,
        "mid": 0.3,
        "three": 0.4
      },
      "rimFG": 0.63,
      "midFG": 0.46,
      "threeFG": 0.39,
      "seasonUsage": 27,
      "scriptedSetPlay": "High Drag Screen Pullup 3PT"
    },
    {
      "id": "6580",
      "name": "Bradley Beal",
      "position": "SG",
      "jersey": "3",
      "isStarter": true,
      "earlyShotShare": 0.18,
      "shotMix": {
        "rim": 0.35,
        "mid": 0.3,
        "three": 0.35
      },
      "rimFG": 0.64,
      "midFG": 0.46,
      "threeFG": 0.37,
      "seasonUsage": 22,
      "scriptedSetPlay": "Wing Slash / Corner 3PT"
    },
    {
      "id": "4066648",
      "name": "Rui Hachimura",
      "position": "PF",
      "jersey": "28",
      "isStarter": true,
      "earlyShotShare": 0.1,
      "shotMix": {
        "rim": 0.5,
        "mid": 0.2,
        "three": 0.3
      },
      "rimFG": 0.68,
      "midFG": 0.44,
      "threeFG": 0.4,
      "seasonUsage": 15,
      "scriptedSetPlay": "Baseline Dunker Spot Cut"
    }
  ],
  "MIN": [
    {
      "id": "3032976",
      "name": "Rudy Gobert",
      "position": "C",
      "jersey": "27",
      "isStarter": true,
      "earlyShotShare": 0.14,
      "shotMix": {
        "rim": 0.95,
        "mid": 0.05,
        "three": 0
      },
      "rimFG": 0.72,
      "midFG": 0.25,
      "threeFG": 0,
      "seasonUsage": 14,
      "scriptedSetPlay": "LaMelo PnR High Lob Dunk"
    },
    {
      "id": "4594268",
      "name": "Anthony Edwards",
      "position": "SG",
      "jersey": "5",
      "isStarter": true,
      "earlyShotShare": 0.36,
      "shotMix": {
        "rim": 0.38,
        "mid": 0.22,
        "three": 0.4
      },
      "rimFG": 0.68,
      "midFG": 0.46,
      "threeFG": 0.38,
      "seasonUsage": 34,
      "scriptedSetPlay": "Finch Scripted High PnR Explosive Attack"
    },
    {
      "id": "4432816",
      "name": "LaMelo Ball",
      "position": "PG",
      "jersey": "1",
      "isStarter": true,
      "earlyShotShare": 0.26,
      "shotMix": {
        "rim": 0.25,
        "mid": 0.25,
        "three": 0.5
      },
      "rimFG": 0.62,
      "midFG": 0.44,
      "threeFG": 0.37,
      "seasonUsage": 28,
      "scriptedSetPlay": "Early Pull-Up 3PT / Floater"
    },
    {
      "id": "4433247",
      "name": "Jonathan Kuminga",
      "position": "PF",
      "jersey": "24",
      "isStarter": true,
      "earlyShotShare": 0.14,
      "shotMix": {
        "rim": 0.65,
        "mid": 0.15,
        "three": 0.2
      },
      "rimFG": 0.7,
      "midFG": 0.4,
      "threeFG": 0.33,
      "seasonUsage": 20,
      "scriptedSetPlay": "High Isolation Explosive Rim Attack"
    },
    {
      "id": "4431671",
      "name": "Jaden McDaniels",
      "position": "SF",
      "jersey": "3",
      "isStarter": true,
      "earlyShotShare": 0.1,
      "shotMix": {
        "rim": 0.4,
        "mid": 0.2,
        "three": 0.4
      },
      "rimFG": 0.64,
      "midFG": 0.4,
      "threeFG": 0.36,
      "seasonUsage": 13,
      "scriptedSetPlay": "Corner Spot 3PT / Baseline Drive"
    }
  ],
  "PHX": [
    {
      "id": "4701232",
      "name": "Mark Williams",
      "position": "C",
      "jersey": "25",
      "isStarter": true,
      "earlyShotShare": 0.14,
      "shotMix": {
        "rim": 0.88,
        "mid": 0.12,
        "three": 0
      },
      "rimFG": 0.72,
      "midFG": 0.36,
      "threeFG": 0,
      "seasonUsage": 15,
      "scriptedSetPlay": "Pick-and-Roll Dunk / Putback"
    },
    {
      "id": "3136193",
      "name": "Devin Booker",
      "position": "PG",
      "jersey": "15",
      "isStarter": true,
      "earlyShotShare": 0.34,
      "shotMix": {
        "rim": 0.3,
        "mid": 0.38,
        "three": 0.32
      },
      "rimFG": 0.66,
      "midFG": 0.5,
      "threeFG": 0.38,
      "seasonUsage": 32,
      "scriptedSetPlay": "Elbow Curl Jumper / Attack"
    },
    {
      "id": "4437244",
      "name": "Jalen Green",
      "position": "SG",
      "jersey": "4",
      "isStarter": true,
      "earlyShotShare": 0.28,
      "shotMix": {
        "rim": 0.35,
        "mid": 0.25,
        "three": 0.4
      },
      "rimFG": 0.64,
      "midFG": 0.42,
      "threeFG": 0.36,
      "seasonUsage": 28,
      "scriptedSetPlay": "Early Drag Screen Pullup 3PT"
    },
    {
      "id": "4066383",
      "name": "Miles Bridges",
      "position": "PF",
      "jersey": "22",
      "isStarter": true,
      "earlyShotShare": 0.14,
      "shotMix": {
        "rim": 0.5,
        "mid": 0.2,
        "three": 0.3
      },
      "rimFG": 0.66,
      "midFG": 0.42,
      "threeFG": 0.35,
      "seasonUsage": 17,
      "scriptedSetPlay": "Baseline Bully Rim Attack"
    },
    {
      "id": "3155526",
      "name": "Dillon Brooks",
      "position": "SF",
      "jersey": "3",
      "isStarter": true,
      "earlyShotShare": 0.1,
      "shotMix": {
        "rim": 0.35,
        "mid": 0.3,
        "three": 0.35
      },
      "rimFG": 0.6,
      "midFG": 0.4,
      "threeFG": 0.35,
      "seasonUsage": 14,
      "scriptedSetPlay": "Baseline Cut / Spot 3PT"
    }
  ],
  "UTA": [
    {
      "id": "3102530",
      "name": "Jusuf Nurkic",
      "position": "C",
      "jersey": "30",
      "isStarter": true,
      "earlyShotShare": 0.14,
      "shotMix": {
        "rim": 0.75,
        "mid": 0.15,
        "three": 0.1
      },
      "rimFG": 0.66,
      "midFG": 0.38,
      "threeFG": 0.28,
      "seasonUsage": 16,
      "scriptedSetPlay": "Low Post Hook / Pocket Pass"
    },
    {
      "id": "4066336",
      "name": "Lauri Markkanen",
      "position": "PF",
      "jersey": "23",
      "isStarter": true,
      "earlyShotShare": 0.32,
      "shotMix": {
        "rim": 0.35,
        "mid": 0.25,
        "three": 0.4
      },
      "rimFG": 0.7,
      "midFG": 0.48,
      "threeFG": 0.4,
      "seasonUsage": 29,
      "scriptedSetPlay": "Pin-Down Curl 3PT / Drive"
    },
    {
      "id": "4277961",
      "name": "Jaren Jackson Jr.",
      "position": "SF",
      "jersey": "20",
      "isStarter": true,
      "earlyShotShare": 0.26,
      "shotMix": {
        "rim": 0.45,
        "mid": 0.25,
        "three": 0.3
      },
      "rimFG": 0.68,
      "midFG": 0.44,
      "threeFG": 0.35,
      "seasonUsage": 26,
      "scriptedSetPlay": "Face-Up High Post Drive / 3PT"
    },
    {
      "id": "4433627",
      "name": "Keyonte George",
      "position": "SG",
      "jersey": "3",
      "isStarter": true,
      "earlyShotShare": 0.18,
      "shotMix": {
        "rim": 0.25,
        "mid": 0.25,
        "three": 0.5
      },
      "rimFG": 0.58,
      "midFG": 0.42,
      "threeFG": 0.36,
      "seasonUsage": 22,
      "scriptedSetPlay": "High Drag Step-Back 3PT"
    },
    {
      "id": "4683766",
      "name": "Isaiah Collier",
      "position": "PG",
      "jersey": "8",
      "isStarter": true,
      "earlyShotShare": 0.1,
      "shotMix": {
        "rim": 0.45,
        "mid": 0.25,
        "three": 0.3
      },
      "rimFG": 0.6,
      "midFG": 0.4,
      "threeFG": 0.33,
      "seasonUsage": 16,
      "scriptedSetPlay": "Downhill Paint Penetration"
    }
  ]
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
