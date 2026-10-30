/**
 * src/sports/nba/data/fullRosters.js
 *
 * Full 2026-27 active team rosters (all 30 NBA teams, 500+ active players) from ESPN.
 * Ordered by true NBA depth chart rotation priority (6th-man through rotational bench).
 * Powers daily injury replacements, next-man-up starting 5 depth chart promotions,
 * and backup jump ball center assignments.
 */

import { TEAM_ABBR_ALIASES } from './teamRosters.js';

export const NBA_FULL_ROSTERS = {
  "ATL": [
    {
      "id": "4397020",
      "name": "Luguentz Dort",
      "pos": "G",
      "jersey": "0"
    },
    {
      "id": "2578185",
      "name": "Dorian Finney-Smith",
      "pos": "F",
      "jersey": "8"
    },
    {
      "id": "4397183",
      "name": "Aaron Wiggins",
      "pos": "G",
      "jersey": "2"
    },
    {
      "id": "4280151",
      "name": "Corey Kispert",
      "pos": "F",
      "jersey": "24"
    },
    {
      "id": "3146557",
      "name": "Jock Landale",
      "pos": "C",
      "jersey": "31"
    },
    {
      "id": "4431714",
      "name": "Jalen Wilson",
      "pos": "F",
      "jersey": "22"
    },
    {
      "id": "4431941",
      "name": "RayJ Dennis",
      "pos": "G",
      "jersey": "10"
    },
    {
      "id": "4712863",
      "name": "Mouhamed Gueye",
      "pos": "F",
      "jersey": "18"
    },
    {
      "id": "4278039",
      "name": "Nickeil Alexander-Walker",
      "pos": "G",
      "jersey": "7"
    },
    {
      "id": "4869342",
      "name": "Dyson Daniels",
      "pos": "G",
      "jersey": "5"
    },
    {
      "id": "5106262",
      "name": "Zuby Ejiofor",
      "pos": "F",
      "jersey": "20"
    },
    {
      "id": "5149077",
      "name": "Kingston Flemings",
      "pos": "G",
      "jersey": "4"
    },
    {
      "id": "4585618",
      "name": "Keshon Gilbert",
      "pos": "G",
      "jersey": "00"
    },
    {
      "id": "4701230",
      "name": "Jalen Johnson",
      "pos": "F",
      "jersey": "1"
    },
    {
      "id": "2490149",
      "name": "CJ McCollum",
      "pos": "G",
      "jersey": "3"
    },
    {
      "id": "4873201",
      "name": "Asa Newell",
      "pos": "F",
      "jersey": "14"
    },
    {
      "id": "4431680",
      "name": "Onyeka Okongwu",
      "pos": "F",
      "jersey": "17"
    },
    {
      "id": "5105571",
      "name": "Henri Veesaar",
      "pos": "C",
      "jersey": "13"
    }
  ],
  "BOS": [
    {
      "id": "4351852",
      "name": "Mitchell Robinson",
      "pos": "C",
      "jersey": "4"
    },
    {
      "id": "3195",
      "name": "Mike Conley",
      "pos": "G",
      "jersey": "45"
    },
    {
      "id": "4433188",
      "name": "Devin Carter",
      "pos": "G",
      "jersey": "99"
    },
    {
      "id": "4065804",
      "name": "Sam Hauser",
      "pos": "F",
      "jersey": "30"
    },
    {
      "id": "4397424",
      "name": "Neemias Queta",
      "pos": "C",
      "jersey": "88"
    },
    {
      "id": "4593841",
      "name": "Baylor Scheierman",
      "pos": "G",
      "jersey": "55"
    },
    {
      "id": "4683689",
      "name": "Jordan Walsh",
      "pos": "G",
      "jersey": "27"
    },
    {
      "id": "5142621",
      "name": "Chris Cenac Jr.",
      "pos": "F",
      "jersey": "12"
    },
    {
      "id": "4277951",
      "name": "Luka Garza",
      "pos": "C",
      "jersey": "52"
    },
    {
      "id": "4251",
      "name": "Paul George",
      "pos": "F",
      "jersey": "13"
    },
    {
      "id": "5175647",
      "name": "Hugo Gonzalez",
      "pos": "G",
      "jersey": "28"
    },
    {
      "id": "4397251",
      "name": "Ron Harper Jr.",
      "pos": "G",
      "jersey": "8"
    },
    {
      "id": "5106283",
      "name": "Dillon Mitchell",
      "pos": "F",
      "jersey": "20"
    },
    {
      "id": "4066354",
      "name": "Payton Pritchard",
      "pos": "G",
      "jersey": "11"
    },
    {
      "id": "4065648",
      "name": "Jayson Tatum",
      "pos": "F",
      "jersey": "0"
    },
    {
      "id": "3078576",
      "name": "Derrick White",
      "pos": "G",
      "jersey": "9"
    },
    {
      "id": "4702745",
      "name": "Amari Williams",
      "pos": "F",
      "jersey": "77"
    }
  ],
  "BKN": [
    {
      "id": "3150844",
      "name": "Moritz Wagner",
      "pos": "C",
      "jersey": "13"
    },
    {
      "id": "4432194",
      "name": "Day'Ron Sharpe",
      "pos": "C",
      "jersey": "20"
    },
    {
      "id": "4687718",
      "name": "Josh Minott",
      "pos": "F",
      "jersey": "00"
    },
    {
      "id": "5037873",
      "name": "Drake Powell",
      "pos": "G",
      "jersey": "4"
    },
    {
      "id": "5175643",
      "name": "Egor Demin",
      "pos": "G",
      "jersey": "8"
    },
    {
      "id": "4702670",
      "name": "Grant Nelson",
      "pos": "F",
      "jersey": "16"
    },
    {
      "id": "5242502",
      "name": "Ben Saraf",
      "pos": "G",
      "jersey": "77"
    },
    {
      "id": "5105626",
      "name": "Tyler Bilodeau",
      "pos": "F",
      "jersey": "34"
    },
    {
      "id": "5101761",
      "name": "Mikel Brown Jr.",
      "pos": "G",
      "jersey": "0"
    },
    {
      "id": "4712896",
      "name": "Noah Clowney",
      "pos": "F",
      "jersey": "21"
    },
    {
      "id": "4702177",
      "name": "Keon Ellis",
      "pos": "G",
      "jersey": "1"
    },
    {
      "id": "4870564",
      "name": "Joshua Jefferson",
      "pos": "F",
      "jersey": "9"
    },
    {
      "id": "5174655",
      "name": "Chaney Johnson",
      "pos": "F",
      "jersey": "31"
    },
    {
      "id": "3907823",
      "name": "Terance Mann",
      "pos": "G",
      "jersey": "14"
    },
    {
      "id": "4278104",
      "name": "Michael Porter Jr.",
      "pos": "F",
      "jersey": "17"
    },
    {
      "id": "3064514",
      "name": "Julius Randle",
      "pos": "F",
      "jersey": "30"
    },
    {
      "id": "5279130",
      "name": "Nolan Traore",
      "pos": "G",
      "jersey": "10"
    },
    {
      "id": "5107173",
      "name": "Danny Wolf",
      "pos": "F",
      "jersey": "2"
    }
  ],
  "CHA": [
    {
      "id": "4396971",
      "name": "Naz Reid",
      "pos": "C",
      "jersey": "0"
    },
    {
      "id": "4066218",
      "name": "Grant Williams",
      "pos": "F",
      "jersey": "2"
    },
    {
      "id": "2583632",
      "name": "Royce O'Neale",
      "pos": "F",
      "jersey": "00"
    },
    {
      "id": "5061575",
      "name": "Kon Knueppel",
      "pos": "G",
      "jersey": "7"
    },
    {
      "id": "5239590",
      "name": "Liam McNeeley",
      "pos": "G",
      "jersey": "33"
    },
    {
      "id": "5211176",
      "name": "Tidjane Salaun",
      "pos": "F",
      "jersey": "31"
    },
    {
      "id": "4433249",
      "name": "Moussa Diabate",
      "pos": "F",
      "jersey": "14"
    },
    {
      "id": "3135045",
      "name": "Grayson Allen",
      "pos": "G",
      "jersey": "8"
    },
    {
      "id": "5060701",
      "name": "Christian Anderson",
      "pos": "G",
      "jersey": "5"
    },
    {
      "id": "4684269",
      "name": "Kylan Boswell",
      "pos": "G",
      "jersey": "18"
    },
    {
      "id": "4701225",
      "name": "PJ Hall",
      "pos": "C",
      "jersey": "16"
    },
    {
      "id": "4602025",
      "name": "Sion James",
      "pos": "G",
      "jersey": "4"
    },
    {
      "id": "4576060",
      "name": "Ryan Kalkbrenner",
      "pos": "C",
      "jersey": "11"
    },
    {
      "id": "4433287",
      "name": "Brandon Miller",
      "pos": "F",
      "jersey": "24"
    },
    {
      "id": "3032979",
      "name": "Dennis Schroder",
      "pos": "G",
      "jersey": "17"
    },
    {
      "id": "5281370",
      "name": "Hannes Steinbach",
      "pos": "F",
      "jersey": "22"
    },
    {
      "id": "4395651",
      "name": "Coby White",
      "pos": "G",
      "jersey": "3"
    }
  ],
  "CHI": [
    {
      "id": "4066650",
      "name": "Zach Collins",
      "pos": "C",
      "jersey": "12"
    },
    {
      "id": "4397189",
      "name": "Jalen Smith",
      "pos": "F-C",
      "jersey": "25"
    },
    {
      "id": "4432822",
      "name": "Isaac Okoro",
      "pos": "F",
      "jersey": "35"
    },
    {
      "id": "2990984",
      "name": "Buddy Hield",
      "pos": "G",
      "jersey": "7"
    },
    {
      "id": "4395626",
      "name": "Tre Jones",
      "pos": "G",
      "jersey": "30"
    },
    {
      "id": "4683750",
      "name": "Jordan Hawkins",
      "pos": "G",
      "jersey": "15"
    },
    {
      "id": "5044385",
      "name": "Leonard Miller",
      "pos": "F",
      "jersey": "11"
    },
    {
      "id": "5105555",
      "name": "Tobe Awaka",
      "pos": "F",
      "jersey": "19"
    },
    {
      "id": "4711294",
      "name": "Matas Buzelis",
      "pos": "F",
      "jersey": "14"
    },
    {
      "id": "4278067",
      "name": "Nic Claxton",
      "pos": "C",
      "jersey": "9"
    },
    {
      "id": "5242496",
      "name": "Noa Essengue",
      "pos": "F",
      "jersey": "2"
    },
    {
      "id": "4871145",
      "name": "Josh Giddey",
      "pos": "G",
      "jersey": "3"
    },
    {
      "id": "2595516",
      "name": "Norman Powell",
      "pos": "G",
      "jersey": "24"
    },
    {
      "id": "4898010",
      "name": "Jaylin Sellers",
      "pos": "G",
      "jersey": "22"
    },
    {
      "id": "4848625",
      "name": "Dailyn Swain",
      "pos": "G",
      "jersey": "5"
    },
    {
      "id": "4431687",
      "name": "Patrick Williams",
      "pos": "F",
      "jersey": "44"
    },
    {
      "id": "5095151",
      "name": "Caleb Wilson",
      "pos": "F",
      "jersey": "8"
    }
  ],
  "CLE": [
    {
      "id": "4066757",
      "name": "Sam Merrill",
      "pos": "G",
      "jersey": "5"
    },
    {
      "id": "4701233",
      "name": "Craig Porter Jr.",
      "pos": "G",
      "jersey": "9"
    },
    {
      "id": "4683747",
      "name": "Jaylon Tyson",
      "pos": "G",
      "jersey": "20"
    },
    {
      "id": "3934723",
      "name": "Thomas Bryant",
      "pos": "C",
      "jersey": "3"
    },
    {
      "id": "2995706",
      "name": "Mario Hezonja",
      "pos": "F",
      "jersey": "33"
    },
    {
      "id": "4431734",
      "name": "Tristan Enaruna",
      "pos": "F",
      "jersey": "21"
    },
    {
      "id": "4066328",
      "name": "Jarrett Allen",
      "pos": "C",
      "jersey": "31"
    },
    {
      "id": "3992",
      "name": "James Harden",
      "pos": "G",
      "jersey": "1"
    },
    {
      "id": "5177362",
      "name": "Riley Minix",
      "pos": "F",
      "jersey": "12"
    },
    {
      "id": "3908809",
      "name": "Donovan Mitchell",
      "pos": "G",
      "jersey": "45"
    },
    {
      "id": "4432158",
      "name": "Evan Mobley",
      "pos": "C",
      "jersey": "4"
    },
    {
      "id": "5023693",
      "name": "Tyrese Proctor",
      "pos": "G",
      "jersey": "24"
    },
    {
      "id": "5041951",
      "name": "Meleek Thomas",
      "pos": "G",
      "jersey": "15"
    },
    {
      "id": "5106261",
      "name": "Ernest Udeh Jr.",
      "pos": "C",
      "jersey": "88"
    },
    {
      "id": "4576087",
      "name": "Peyton Watson",
      "pos": "G",
      "jersey": "8"
    }
  ],
  "DAL": [
    {
      "id": "4278049",
      "name": "Daniel Gafford",
      "pos": "C",
      "jersey": "21"
    },
    {
      "id": "4278594",
      "name": "Naji Marshall",
      "pos": "F",
      "jersey": "3"
    },
    {
      "id": "3138160",
      "name": "Caleb Martin",
      "pos": "F",
      "jersey": "16"
    },
    {
      "id": "4593125",
      "name": "Santi Aldama",
      "pos": "F",
      "jersey": "34"
    },
    {
      "id": "5211175",
      "name": "Zaccharie Risacher",
      "pos": "F",
      "jersey": "10"
    },
    {
      "id": "4432582",
      "name": "Max Christie",
      "pos": "G",
      "jersey": "0"
    },
    {
      "id": "4432107",
      "name": "Marcus Sasser",
      "pos": "G",
      "jersey": "8"
    },
    {
      "id": "5148538",
      "name": "Tarik Biberovic",
      "pos": "F",
      "jersey": "13"
    },
    {
      "id": "4701208",
      "name": "Moussa Cisse",
      "pos": "C",
      "jersey": "30"
    },
    {
      "id": "4896372",
      "name": "Walter Clayton Jr.",
      "pos": "G",
      "jersey": "1"
    },
    {
      "id": "5279129",
      "name": "Sergio de Larrea",
      "pos": "F",
      "jersey": "55"
    },
    {
      "id": "5041939",
      "name": "Cooper Flagg",
      "pos": "F",
      "jersey": "32"
    },
    {
      "id": "5105806",
      "name": "Jett Howard",
      "pos": "G",
      "jersey": "9"
    },
    {
      "id": "6442",
      "name": "Kyrie Irving",
      "pos": "G",
      "jersey": "11"
    },
    {
      "id": "4873153",
      "name": "Morez Johnson Jr.",
      "pos": "F",
      "jersey": "14"
    },
    {
      "id": "5106040",
      "name": "Tobi Lawal",
      "pos": "F",
      "jersey": "33"
    },
    {
      "id": "4683688",
      "name": "Dereck Lively II",
      "pos": "C",
      "jersey": "2"
    },
    {
      "id": "4278078",
      "name": "P.J. Washington",
      "pos": "F",
      "jersey": "25"
    }
  ],
  "DEN": [
    {
      "id": "3978",
      "name": "DeMar DeRozan",
      "pos": "G",
      "jersey": "10"
    },
    {
      "id": "3135046",
      "name": "Tyus Jones",
      "pos": "G",
      "jersey": "5"
    },
    {
      "id": "5105592",
      "name": "Cam Whitmore",
      "pos": "F",
      "jersey": "00"
    },
    {
      "id": "4432181",
      "name": "Julian Strawther",
      "pos": "G",
      "jersey": "1"
    },
    {
      "id": "4277848",
      "name": "Marvin Bagley III",
      "pos": "F",
      "jersey": "3"
    },
    {
      "id": "4433607",
      "name": "DaRon Holmes II",
      "pos": "F",
      "jersey": "14"
    },
    {
      "id": "4431767",
      "name": "Christian Braun",
      "pos": "G",
      "jersey": "0"
    },
    {
      "id": "4698719",
      "name": "Trevon Brazile",
      "pos": "F",
      "jersey": "7"
    },
    {
      "id": "4065813",
      "name": "Alpha Diallo",
      "pos": "F",
      "jersey": "11"
    },
    {
      "id": "3064290",
      "name": "Aaron Gordon",
      "pos": "F",
      "jersey": "32"
    },
    {
      "id": "4565698",
      "name": "Bryce Hopkins",
      "pos": "F",
      "jersey": "13"
    },
    {
      "id": "3138196",
      "name": "Cameron Johnson",
      "pos": "F",
      "jersey": "23"
    },
    {
      "id": "3112335",
      "name": "Nikola Jokic",
      "pos": "C",
      "jersey": "15"
    },
    {
      "id": "4592427",
      "name": "Spencer Jones",
      "pos": "F",
      "jersey": "21"
    },
    {
      "id": "3936299",
      "name": "Jamal Murray",
      "pos": "G",
      "jersey": "27"
    },
    {
      "id": "4433629",
      "name": "Ryan Nembhard",
      "pos": "G",
      "jersey": "9"
    },
    {
      "id": "4431690",
      "name": "Zeke Nnaji",
      "pos": "F",
      "jersey": "22"
    }
  ],
  "DET": [
    {
      "id": "4278562",
      "name": "Paul Reed",
      "pos": "C",
      "jersey": "7"
    },
    {
      "id": "4684742",
      "name": "Ausar Thompson",
      "pos": "G",
      "jersey": "9"
    },
    {
      "id": "4395702",
      "name": "Isaiah Joe",
      "pos": "G",
      "jersey": "17"
    },
    {
      "id": "3157465",
      "name": "Duncan Robinson",
      "pos": "F",
      "jersey": "55"
    },
    {
      "id": "2990962",
      "name": "Taurean Prince",
      "pos": "F",
      "jersey": "12"
    },
    {
      "id": "2596112",
      "name": "Javonte Green",
      "pos": "G",
      "jersey": "31"
    },
    {
      "id": "5107818",
      "name": "Isaac Jones",
      "pos": "C",
      "jersey": "13"
    },
    {
      "id": "3908845",
      "name": "John Collins",
      "pos": "F",
      "jersey": "20"
    },
    {
      "id": "4432166",
      "name": "Cade Cunningham",
      "pos": "G",
      "jersey": "2"
    },
    {
      "id": "4433621",
      "name": "Jalen Duren",
      "pos": "C",
      "jersey": "0"
    },
    {
      "id": "4397449",
      "name": "Elijah Harkless",
      "pos": "G",
      "jersey": "94"
    },
    {
      "id": "4683771",
      "name": "Ronald Holland II",
      "pos": "F",
      "jersey": "5"
    },
    {
      "id": "4066372",
      "name": "Kevin Huerter",
      "pos": "G",
      "jersey": "27"
    },
    {
      "id": "5107199",
      "name": "Daniss Jenkins",
      "pos": "G",
      "jersey": "24"
    },
    {
      "id": "4700852",
      "name": "Chaz Lanier",
      "pos": "G",
      "jersey": "8"
    },
    {
      "id": "5258459",
      "name": "Ebuka Okorie",
      "pos": "G",
      "jersey": "23"
    },
    {
      "id": "5037878",
      "name": "Ugonna Onyenso",
      "pos": "C",
      "jersey": "34"
    },
    {
      "id": "4397882",
      "name": "Tolu Smith",
      "pos": "F",
      "jersey": "35"
    }
  ],
  "GSW": [
    {
      "id": "4432171",
      "name": "Moses Moody",
      "pos": "G-F",
      "jersey": "4"
    },
    {
      "id": "4066436",
      "name": "De'Anthony Melton",
      "pos": "G",
      "jersey": "8"
    },
    {
      "id": "3213",
      "name": "Al Horford",
      "pos": "C",
      "jersey": "20"
    },
    {
      "id": "4397886",
      "name": "Charles Bassey",
      "pos": "C",
      "jersey": "28"
    },
    {
      "id": "3134903",
      "name": "Gary Payton II",
      "pos": "G",
      "jersey": "0"
    },
    {
      "id": "2990969",
      "name": "Georges Niang",
      "pos": "F",
      "jersey": "32"
    },
    {
      "id": "4997536",
      "name": "Gui Santos",
      "pos": "F",
      "jersey": "15"
    },
    {
      "id": "6430",
      "name": "Jimmy Butler III",
      "pos": "F",
      "jersey": "10"
    },
    {
      "id": "4433149",
      "name": "LJ Cryer",
      "pos": "G",
      "jersey": "18"
    },
    {
      "id": "3975",
      "name": "Stephen Curry",
      "pos": "G",
      "jersey": "30"
    },
    {
      "id": "6589",
      "name": "Draymond Green",
      "pos": "F",
      "jersey": "23"
    },
    {
      "id": "4703396",
      "name": "Graham Ike",
      "pos": "F",
      "jersey": "0"
    },
    {
      "id": "5175737",
      "name": "Yaxel Lendeborg",
      "pos": "F",
      "jersey": "1"
    },
    {
      "id": "4897449",
      "name": "Malevy Leons",
      "pos": "F",
      "jersey": "33"
    },
    {
      "id": "4709138",
      "name": "Brandin Podziemski",
      "pos": "G",
      "jersey": "2"
    },
    {
      "id": "3102531",
      "name": "Kristaps Porzingis",
      "pos": "C",
      "jersey": "7"
    },
    {
      "id": "4897262",
      "name": "Will Richard",
      "pos": "G",
      "jersey": "3"
    },
    {
      "id": "4397040",
      "name": "Brandon Williams",
      "pos": "G",
      "jersey": "12"
    }
  ],
  "HOU": [
    {
      "id": "4432639",
      "name": "Jabari Smith Jr.",
      "pos": "F",
      "jersey": "10"
    },
    {
      "id": "4433192",
      "name": "Tari Eason",
      "pos": "F",
      "jersey": "17"
    },
    {
      "id": "2990992",
      "name": "Marcus Smart",
      "pos": "G",
      "jersey": "36"
    },
    {
      "id": "3102529",
      "name": "Clint Capela",
      "pos": "C",
      "jersey": "30"
    },
    {
      "id": "2991235",
      "name": "Steven Adams",
      "pos": "C",
      "jersey": "12"
    },
    {
      "id": "3037789",
      "name": "Bogdan Bogdanovic",
      "pos": "G",
      "jersey": "31"
    },
    {
      "id": "4683860",
      "name": "Quadir Copeland",
      "pos": "G",
      "jersey": "25"
    },
    {
      "id": "4592857",
      "name": "Isaiah Crawford",
      "pos": "F",
      "jersey": "27"
    },
    {
      "id": "3202",
      "name": "Kevin Durant",
      "pos": "F",
      "jersey": "7"
    },
    {
      "id": "5105553",
      "name": "Julian Phillips",
      "pos": "F",
      "jersey": "3"
    },
    {
      "id": "4871144",
      "name": "Alperen Sengun",
      "pos": "C",
      "jersey": "28"
    },
    {
      "id": "4711272",
      "name": "Reed Sheppard",
      "pos": "G",
      "jersey": "15"
    },
    {
      "id": "3136777",
      "name": "Jae'Sean Tate",
      "pos": "F",
      "jersey": "8"
    },
    {
      "id": "4684740",
      "name": "Amen Thompson",
      "pos": "G",
      "jersey": "1"
    },
    {
      "id": "5105837",
      "name": "Bruce Thornton",
      "pos": "G",
      "jersey": "2"
    },
    {
      "id": "4432827",
      "name": "Oscar Tshiebwe",
      "pos": "C",
      "jersey": "9"
    },
    {
      "id": "2991230",
      "name": "Fred VanVleet",
      "pos": "G",
      "jersey": "5"
    }
  ],
  "IND": [
    {
      "id": "2580365",
      "name": "Larry Nance Jr.",
      "pos": "F-C",
      "jersey": "22"
    },
    {
      "id": "3133603",
      "name": "Kelly Oubre Jr.",
      "pos": "G",
      "jersey": "10"
    },
    {
      "id": "4278355",
      "name": "Obi Toppin",
      "pos": "F",
      "jersey": "1"
    },
    {
      "id": "2530530",
      "name": "T.J. McConnell",
      "pos": "G",
      "jersey": "9"
    },
    {
      "id": "4433076",
      "name": "Ben Sheppard",
      "pos": "G",
      "jersey": "26"
    },
    {
      "id": "4065731",
      "name": "Jay Huff",
      "pos": "C",
      "jersey": "32"
    },
    {
      "id": "5157066",
      "name": "Johnny Furphy",
      "pos": "G",
      "jersey": "12"
    },
    {
      "id": "5106060",
      "name": "Jarace Walker",
      "pos": "F",
      "jersey": "5"
    },
    {
      "id": "4431752",
      "name": "Kobe Brown",
      "pos": "G",
      "jersey": "24"
    },
    {
      "id": "4396993",
      "name": "Tyrese Haliburton",
      "pos": "G",
      "jersey": "0"
    },
    {
      "id": "4592829",
      "name": "Quenton Jackson",
      "pos": "G",
      "jersey": "29"
    },
    {
      "id": "4395712",
      "name": "Andrew Nembhard",
      "pos": "G",
      "jersey": "2"
    },
    {
      "id": "4396909",
      "name": "Aaron Nesmith",
      "pos": "G",
      "jersey": "23"
    },
    {
      "id": "3149673",
      "name": "Pascal Siakam",
      "pos": "F",
      "jersey": "43"
    },
    {
      "id": "4398207",
      "name": "Jalen Slawson",
      "pos": "F",
      "jersey": "18"
    },
    {
      "id": "5105854",
      "name": "Braden Smith",
      "pos": "G",
      "jersey": "3"
    },
    {
      "id": "4017837",
      "name": "Ivica Zubac",
      "pos": "C",
      "jersey": "40"
    }
  ],
  "LAC": [
    {
      "id": "3936099",
      "name": "Derrick Jones Jr.",
      "pos": "F",
      "jersey": "5"
    },
    {
      "id": "4065778",
      "name": "Max Strus",
      "pos": "G-F",
      "jersey": "31"
    },
    {
      "id": "5106258",
      "name": "Gradey Dick",
      "pos": "G",
      "jersey": "9"
    },
    {
      "id": "2991139",
      "name": "Kris Dunn",
      "pos": "G",
      "jersey": "8"
    },
    {
      "id": "4683935",
      "name": "Blake Wesley",
      "pos": "G",
      "jersey": "20"
    },
    {
      "id": "4432170",
      "name": "Isaiah Jackson",
      "pos": "F",
      "jersey": "23"
    },
    {
      "id": "4845363",
      "name": "Cam Christie",
      "pos": "G",
      "jersey": "24"
    },
    {
      "id": "6580",
      "name": "Bradley Beal",
      "pos": "G",
      "jersey": "3"
    },
    {
      "id": "4396907",
      "name": "Darius Garland",
      "pos": "G",
      "jersey": "10"
    },
    {
      "id": "4066648",
      "name": "Rui Hachimura",
      "pos": "F",
      "jersey": "28"
    },
    {
      "id": "3913176",
      "name": "Brandon Ingram",
      "pos": "F",
      "jersey": "7"
    },
    {
      "id": "3448",
      "name": "Brook Lopez",
      "pos": "C",
      "jersey": "11"
    },
    {
      "id": "5105832",
      "name": "Nick Martinelli",
      "pos": "F",
      "jersey": "12"
    },
    {
      "id": "5075626",
      "name": "Baba Miller",
      "pos": "F",
      "jersey": "18"
    },
    {
      "id": "4396818",
      "name": "Jordan Miller",
      "pos": "G",
      "jersey": "22"
    },
    {
      "id": "5108024",
      "name": "Yanic Konan Niederhauser",
      "pos": "C",
      "jersey": "14"
    },
    {
      "id": "4398390",
      "name": "Jalen Pickett",
      "pos": "G",
      "jersey": "21"
    },
    {
      "id": "4702352",
      "name": "Kobe Sanders",
      "pos": "G",
      "jersey": "4"
    },
    {
      "id": "5254165",
      "name": "Keaton Wagler",
      "pos": "G",
      "jersey": "1"
    }
  ],
  "LAL": [
    {
      "id": "4397014",
      "name": "Quentin Grimes",
      "pos": "G",
      "jersey": "5"
    },
    {
      "id": "3155535",
      "name": "Kevon Looney",
      "pos": "F",
      "jersey": "55"
    },
    {
      "id": "3907498",
      "name": "Matisse Thybulle",
      "pos": "G",
      "jersey": "4"
    },
    {
      "id": "4868423",
      "name": "Jaden Hardy",
      "pos": "G",
      "jersey": "7"
    },
    {
      "id": "4592691",
      "name": "Jake LaRavia",
      "pos": "F",
      "jersey": "12"
    },
    {
      "id": "4278580",
      "name": "Sandro Mamukelashvili",
      "pos": "F",
      "jersey": "54"
    },
    {
      "id": "5113969",
      "name": "Cameron Carr",
      "pos": "G",
      "jersey": "43"
    },
    {
      "id": "3945274",
      "name": "Luka Doncic",
      "pos": "G",
      "jersey": "77"
    },
    {
      "id": "4683774",
      "name": "Bronny James",
      "pos": "G",
      "jersey": "9"
    },
    {
      "id": "4433599",
      "name": "Arthur Kaluma",
      "pos": "F",
      "jersey": "47"
    },
    {
      "id": "4433136",
      "name": "Walker Kessler",
      "pos": "C",
      "jersey": "14"
    },
    {
      "id": "4596528",
      "name": "Lawson Lovering",
      "pos": "C",
      "jersey": "0"
    },
    {
      "id": "4702972",
      "name": "Chris Manon",
      "pos": "G",
      "jersey": "30"
    },
    {
      "id": "5114350",
      "name": "AK Okereke",
      "pos": "F",
      "jersey": "31"
    },
    {
      "id": "4066457",
      "name": "Austin Reaves",
      "pos": "G",
      "jersey": "15"
    },
    {
      "id": "4277811",
      "name": "Collin Sexton",
      "pos": "G",
      "jersey": "10"
    },
    {
      "id": "5060631",
      "name": "Adou Thiero",
      "pos": "F",
      "jersey": "1"
    },
    {
      "id": "4278077",
      "name": "Jarred Vanderbilt",
      "pos": "F",
      "jersey": "2"
    },
    {
      "id": "4433137",
      "name": "Ziaire Williams",
      "pos": "F",
      "jersey": "11"
    }
  ],
  "MEM": [
    {
      "id": "2991070",
      "name": "Jerami Grant",
      "pos": "F",
      "jersey": "3"
    },
    {
      "id": "5105550",
      "name": "GG Jackson",
      "pos": "F",
      "jersey": "45"
    },
    {
      "id": "4431785",
      "name": "Scotty Pippen Jr.",
      "pos": "G",
      "jersey": "1"
    },
    {
      "id": "4432810",
      "name": "Isaiah Stewart",
      "pos": "C",
      "jersey": "28"
    },
    {
      "id": "4684806",
      "name": "Taylor Hendricks",
      "pos": "F",
      "jersey": "22"
    },
    {
      "id": "4594326",
      "name": "Kris Murray",
      "pos": "F",
      "jersey": "17"
    },
    {
      "id": "5041935",
      "name": "Cameron Boozer",
      "pos": "F",
      "jersey": "27"
    },
    {
      "id": "5105817",
      "name": "Carson Cooper",
      "pos": "C",
      "jersey": "20"
    },
    {
      "id": "4903027",
      "name": "Cedric Coward",
      "pos": "F",
      "jersey": "23"
    },
    {
      "id": "4600663",
      "name": "Zach Edey",
      "pos": "C",
      "jersey": "14"
    },
    {
      "id": "4065733",
      "name": "Ty Jerome",
      "pos": "G",
      "jersey": "2"
    },
    {
      "id": "5231919",
      "name": "Karim Lopez",
      "pos": "F",
      "jersey": "35"
    },
    {
      "id": "4683934",
      "name": "Jahmai Mashack",
      "pos": "G",
      "jersey": "21"
    },
    {
      "id": "4593016",
      "name": "Quinten Post",
      "pos": "C",
      "jersey": "41"
    },
    {
      "id": "4595400",
      "name": "Olivier-Maxence Prosper",
      "pos": "F",
      "jersey": "18"
    },
    {
      "id": "4781746",
      "name": "Javon Small",
      "pos": "G",
      "jersey": "10"
    },
    {
      "id": "4433083",
      "name": "Cam Spencer",
      "pos": "G",
      "jersey": "24"
    },
    {
      "id": "5112087",
      "name": "Jaylen Wells",
      "pos": "F",
      "jersey": "0"
    }
  ],
  "MIA": [
    {
      "id": "3064482",
      "name": "Bobby Portis",
      "pos": "F-C",
      "jersey": "95"
    },
    {
      "id": "4997528",
      "name": "Nikola Jovic",
      "pos": "F",
      "jersey": "5"
    },
    {
      "id": "3899664",
      "name": "Simone Fontecchio",
      "pos": "F",
      "jersey": "0"
    },
    {
      "id": "4278076",
      "name": "Nick Richards",
      "pos": "C",
      "jersey": "8"
    },
    {
      "id": "2528210",
      "name": "Tim Hardaway Jr.",
      "pos": "G",
      "jersey": "10"
    },
    {
      "id": "4601025",
      "name": "Pelle Larsson",
      "pos": "G",
      "jersey": "9"
    },
    {
      "id": "4066261",
      "name": "Bam Adebayo",
      "pos": "C",
      "jersey": "13"
    },
    {
      "id": "3032977",
      "name": "Giannis Antetokounmpo",
      "pos": "F",
      "jersey": "7"
    },
    {
      "id": "5107157",
      "name": "Ryan Conwell",
      "pos": "G",
      "jersey": "4"
    },
    {
      "id": "4837356",
      "name": "Tre Donaldson",
      "pos": "G",
      "jersey": "24"
    },
    {
      "id": "4431772",
      "name": "Myron Gardner",
      "pos": "F",
      "jersey": "15"
    },
    {
      "id": "4700818",
      "name": "Vladislav Goldin",
      "pos": "C",
      "jersey": "50"
    },
    {
      "id": "4431786",
      "name": "Keshad Johnson",
      "pos": "F",
      "jersey": "16"
    },
    {
      "id": "4278053",
      "name": "Davion Mitchell",
      "pos": "G",
      "jersey": "2"
    },
    {
      "id": "4066993",
      "name": "Dru Smith",
      "pos": "G",
      "jersey": "12"
    },
    {
      "id": "6475",
      "name": "Klay Thompson",
      "pos": "G",
      "jersey": "11"
    },
    {
      "id": "3059319",
      "name": "Andrew Wiggins",
      "pos": "F",
      "jersey": "22"
    }
  ],
  "MIL": [
    {
      "id": "4277843",
      "name": "Gary Trent Jr.",
      "pos": "G",
      "jersey": "5"
    },
    {
      "id": "4397475",
      "name": "AJ Green",
      "pos": "G",
      "jersey": "20"
    },
    {
      "id": "4997526",
      "name": "Ousmane Dieng",
      "pos": "F",
      "jersey": "21"
    },
    {
      "id": "4591725",
      "name": "Ryan Rollins",
      "pos": "G",
      "jersey": "13"
    },
    {
      "id": "4277922",
      "name": "Jericho Sims",
      "pos": "C",
      "jersey": "00"
    },
    {
      "id": "5105623",
      "name": "Kel'el Ware",
      "pos": "C",
      "jersey": "9"
    },
    {
      "id": "5164559",
      "name": "Nate Ament",
      "pos": "F",
      "jersey": "15"
    },
    {
      "id": "5082206",
      "name": "Brayden Burries",
      "pos": "G",
      "jersey": "0"
    },
    {
      "id": "4395725",
      "name": "Tyler Herro",
      "pos": "G",
      "jersey": "11"
    },
    {
      "id": "5214640",
      "name": "Kasparas Jakucionis",
      "pos": "G",
      "jersey": "25"
    },
    {
      "id": "4432848",
      "name": "Jaime Jaquez Jr.",
      "pos": "F",
      "jersey": "24"
    },
    {
      "id": "4697268",
      "name": "Kam Jones",
      "pos": "G",
      "jersey": "19"
    },
    {
      "id": "3134907",
      "name": "Kyle Kuzma",
      "pos": "F",
      "jersey": "18"
    },
    {
      "id": "2991043",
      "name": "Caris LeVert",
      "pos": "G",
      "jersey": "12"
    },
    {
      "id": "5214989",
      "name": "Bogoljub Markovic",
      "pos": "F",
      "jersey": "23"
    },
    {
      "id": "4397233",
      "name": "Pete Nance",
      "pos": "F",
      "jersey": "35"
    },
    {
      "id": "4397114",
      "name": "Cormac Ryan",
      "pos": "G",
      "jersey": "30"
    },
    {
      "id": "3133628",
      "name": "Myles Turner",
      "pos": "C",
      "jersey": "3"
    }
  ],
  "MIN": [
    {
      "id": "3934673",
      "name": "Donte DiVincenzo",
      "pos": "G",
      "jersey": "0"
    },
    {
      "id": "4397002",
      "name": "Ayo Dosunmu",
      "pos": "G",
      "jersey": "13"
    },
    {
      "id": "4432847",
      "name": "Terrence Shannon Jr.",
      "pos": "G",
      "jersey": "4"
    },
    {
      "id": "3136196",
      "name": "Trey Lyles",
      "pos": "F",
      "jersey": "41"
    },
    {
      "id": "4895758",
      "name": "Cody Williams",
      "pos": "F",
      "jersey": "9"
    },
    {
      "id": "4592492",
      "name": "Bones Hyland",
      "pos": "G",
      "jersey": "8"
    },
    {
      "id": "4432816",
      "name": "LaMelo Ball",
      "pos": "G",
      "jersey": "1"
    },
    {
      "id": "5279133",
      "name": "Joan Beringer",
      "pos": "F",
      "jersey": "19"
    },
    {
      "id": "4432247",
      "name": "Jaylen Clark",
      "pos": "G",
      "jersey": "7"
    },
    {
      "id": "4594268",
      "name": "Anthony Edwards",
      "pos": "G",
      "jersey": "5"
    },
    {
      "id": "5061585",
      "name": "Isaiah Evans",
      "pos": "F",
      "jersey": "33"
    },
    {
      "id": "4592699",
      "name": "Enrique Freeman",
      "pos": "F",
      "jersey": "25"
    },
    {
      "id": "3032976",
      "name": "Rudy Gobert",
      "pos": "C",
      "jersey": "27"
    },
    {
      "id": "4433247",
      "name": "Jonathan Kuminga",
      "pos": "F",
      "jersey": "24"
    },
    {
      "id": "4431671",
      "name": "Jaden McDaniels",
      "pos": "F",
      "jersey": "3"
    },
    {
      "id": "4592979",
      "name": "Zyon Pullin",
      "pos": "G",
      "jersey": "15"
    },
    {
      "id": "5157587",
      "name": "Rocco Zikarsky",
      "pos": "C",
      "jersey": "44"
    }
  ],
  "NOP": [
    {
      "id": "4277813",
      "name": "Herbert Jones",
      "pos": "F",
      "jersey": "2"
    },
    {
      "id": "4397136",
      "name": "Saddiq Bey",
      "pos": "G",
      "jersey": "41"
    },
    {
      "id": "4683634",
      "name": "Bennedict Mathurin",
      "pos": "G",
      "jersey": "24"
    },
    {
      "id": "3442",
      "name": "DeAndre Jordan",
      "pos": "C",
      "jersey": "6"
    },
    {
      "id": "4869780",
      "name": "Derik Queen",
      "pos": "C",
      "jersey": "22"
    },
    {
      "id": "4997538",
      "name": "Karlo Matkovic",
      "pos": "F",
      "jersey": "17"
    },
    {
      "id": "4712862",
      "name": "Malik Dia",
      "pos": "F",
      "jersey": "8"
    },
    {
      "id": "5144091",
      "name": "Jeremiah Fears",
      "pos": "G",
      "jersey": "0"
    },
    {
      "id": "5170947",
      "name": "AJ Johnson",
      "pos": "G",
      "jersey": "14"
    },
    {
      "id": "4576086",
      "name": "Bryce McGowens",
      "pos": "G",
      "jersey": "11"
    },
    {
      "id": "5061589",
      "name": "Yves Missi",
      "pos": "C",
      "jersey": "21"
    },
    {
      "id": "4397688",
      "name": "Trey Murphy III",
      "pos": "F",
      "jersey": "25"
    },
    {
      "id": "3907497",
      "name": "Dejounte Murray",
      "pos": "G",
      "jersey": "5"
    },
    {
      "id": "4703115",
      "name": "Jaron Pierre Jr.",
      "pos": "G",
      "jersey": "10"
    },
    {
      "id": "4277956",
      "name": "Jordan Poole",
      "pos": "G",
      "jersey": "3"
    },
    {
      "id": "4683742",
      "name": "Julian Reese",
      "pos": "F",
      "jersey": "13"
    },
    {
      "id": "4431675",
      "name": "Trendon Watford",
      "pos": "F",
      "jersey": "9"
    },
    {
      "id": "4395628",
      "name": "Zion Williamson",
      "pos": "F",
      "jersey": "1"
    }
  ],
  "NYK": [
    {
      "id": "2528426",
      "name": "Jordan Clarkson",
      "pos": "G",
      "jersey": "00"
    },
    {
      "id": "4277869",
      "name": "Jose Alvarado",
      "pos": "G",
      "jersey": "5"
    },
    {
      "id": "4431823",
      "name": "Miles McBride",
      "pos": "G",
      "jersey": "2"
    },
    {
      "id": "4897943",
      "name": "Dalton Knecht",
      "pos": "F",
      "jersey": "99"
    },
    {
      "id": "6585",
      "name": "Andre Drummond",
      "pos": "C",
      "jersey": "0"
    },
    {
      "id": "3914044",
      "name": "Landry Shamet",
      "pos": "G",
      "jersey": "44"
    },
    {
      "id": "4432808",
      "name": "James Wiseman",
      "pos": "C",
      "jersey": "35"
    },
    {
      "id": "4683730",
      "name": "Jaden Akins",
      "pos": "G",
      "jersey": "14"
    },
    {
      "id": "3934719",
      "name": "OG Anunoby",
      "pos": "F",
      "jersey": "8"
    },
    {
      "id": "3147657",
      "name": "Mikal Bridges",
      "pos": "G",
      "jersey": "25"
    },
    {
      "id": "3934672",
      "name": "Jalen Brunson",
      "pos": "G",
      "jersey": "11"
    },
    {
      "id": "5211983",
      "name": "Pacome Dadiet",
      "pos": "F",
      "jersey": "4"
    },
    {
      "id": "5289900",
      "name": "Mohamed Diawara",
      "pos": "F",
      "jersey": "51"
    },
    {
      "id": "3062679",
      "name": "Josh Hart",
      "pos": "G",
      "jersey": "3"
    },
    {
      "id": "4433225",
      "name": "Tyler Kolek",
      "pos": "G",
      "jersey": "13"
    },
    {
      "id": "4838721",
      "name": "Tyler Nickel",
      "pos": "F",
      "jersey": "55"
    },
    {
      "id": "3136195",
      "name": "Karl-Anthony Towns",
      "pos": "C",
      "jersey": "32"
    }
  ],
  "OKC": [
    {
      "id": "4222252",
      "name": "Isaiah Hartenstein",
      "pos": "C",
      "jersey": "55"
    },
    {
      "id": "4683778",
      "name": "Jared McCain",
      "pos": "G",
      "jersey": "3"
    },
    {
      "id": "3133626",
      "name": "Kenrich Williams",
      "pos": "G",
      "jersey": "34"
    },
    {
      "id": "4900671",
      "name": "Ajay Mitchell",
      "pos": "G",
      "jersey": "25"
    },
    {
      "id": "4432823",
      "name": "Jaylin Williams",
      "pos": "F",
      "jersey": "6"
    },
    {
      "id": "5159925",
      "name": "Nikola Topic",
      "pos": "G",
      "jersey": "44"
    },
    {
      "id": "4684208",
      "name": "Brooks Barnhizer",
      "pos": "F",
      "jersey": "23"
    },
    {
      "id": "2991350",
      "name": "Alex Caruso",
      "pos": "G",
      "jersey": "9"
    },
    {
      "id": "5105800",
      "name": "Josh Dix",
      "pos": "G",
      "jersey": "21"
    },
    {
      "id": "4278073",
      "name": "Shai Gilgeous-Alexander",
      "pos": "G",
      "jersey": "2"
    },
    {
      "id": "4433255",
      "name": "Chet Holmgren",
      "pos": "C",
      "jersey": "7"
    },
    {
      "id": "5174983",
      "name": "Aday Mara",
      "pos": "C",
      "jersey": "15"
    },
    {
      "id": "4432185",
      "name": "Micah Peavy",
      "pos": "G",
      "jersey": "0"
    },
    {
      "id": "5061603",
      "name": "Thomas Sorber",
      "pos": "C",
      "jersey": "12"
    },
    {
      "id": "5241364",
      "name": "Bennett Stirtz",
      "pos": "G",
      "jersey": "14"
    },
    {
      "id": "4683692",
      "name": "Cason Wallace",
      "pos": "G",
      "jersey": "22"
    },
    {
      "id": "4593803",
      "name": "Jalen Williams",
      "pos": "G",
      "jersey": "8"
    }
  ],
  "ORL": [
    {
      "id": "4065654",
      "name": "Jonathan Isaac",
      "pos": "F",
      "jersey": "1"
    },
    {
      "id": "4702382",
      "name": "Tristan da Silva",
      "pos": "F",
      "jersey": "23"
    },
    {
      "id": "4712849",
      "name": "Anthony Black",
      "pos": "G",
      "jersey": "0"
    },
    {
      "id": "6478",
      "name": "Nikola Vucevic",
      "pos": "C",
      "jersey": "9"
    },
    {
      "id": "4348700",
      "name": "Goga Bitadze",
      "pos": "C",
      "jersey": "35"
    },
    {
      "id": "3133635",
      "name": "Jevon Carter",
      "pos": "G",
      "jersey": "2"
    },
    {
      "id": "4432573",
      "name": "Paolo Banchero",
      "pos": "F",
      "jersey": "5"
    },
    {
      "id": "4066320",
      "name": "Desmond Bane",
      "pos": "G",
      "jersey": "3"
    },
    {
      "id": "4278572",
      "name": "Jamal Cain",
      "pos": "F",
      "jersey": "8"
    },
    {
      "id": "4277847",
      "name": "Wendell Carter Jr.",
      "pos": "C",
      "jersey": "34"
    },
    {
      "id": "4397204",
      "name": "Colin Castleton",
      "pos": "C",
      "jersey": "14"
    },
    {
      "id": "4593034",
      "name": "Alex Morales",
      "pos": "G",
      "jersey": "30"
    },
    {
      "id": "5107251",
      "name": "Izaiyah Nelson",
      "pos": "F",
      "jersey": "25"
    },
    {
      "id": "5214637",
      "name": "Noah Penda",
      "pos": "F",
      "jersey": "93"
    },
    {
      "id": "5239561",
      "name": "Jase Richardson",
      "pos": "G",
      "jersey": "11"
    },
    {
      "id": "4432165",
      "name": "Jalen Suggs",
      "pos": "G",
      "jersey": "4"
    },
    {
      "id": "4566434",
      "name": "Franz Wagner",
      "pos": "F",
      "jersey": "22"
    }
  ],
  "PHI": [
    {
      "id": "4351851",
      "name": "Anfernee Simons",
      "pos": "G",
      "jersey": "5"
    },
    {
      "id": "3912848",
      "name": "Dean Wade",
      "pos": "F",
      "jersey": "45"
    },
    {
      "id": "4432446",
      "name": "Jabari Walker",
      "pos": "F",
      "jersey": "33"
    },
    {
      "id": "5105637",
      "name": "Adem Bona",
      "pos": "C",
      "jersey": "30"
    },
    {
      "id": "5124612",
      "name": "VJ Edgecombe",
      "pos": "G",
      "jersey": "77"
    },
    {
      "id": "4433144",
      "name": "Caleb Love",
      "pos": "G",
      "jersey": "8"
    },
    {
      "id": "5099752",
      "name": "Rayan Rupert",
      "pos": "G",
      "jersey": "12"
    },
    {
      "id": "4870562",
      "name": "Dominick Barlow",
      "pos": "F",
      "jersey": "25"
    },
    {
      "id": "3917376",
      "name": "Jaylen Brown",
      "pos": "G",
      "jersey": "7"
    },
    {
      "id": "2581018",
      "name": "Kentavious Caldwell-Pope",
      "pos": "G",
      "jersey": "1"
    },
    {
      "id": "4711297",
      "name": "Justin Edwards",
      "pos": "F",
      "jersey": "11"
    },
    {
      "id": "3059318",
      "name": "Joel Embiid",
      "pos": "C",
      "jersey": "21"
    },
    {
      "id": "3904625",
      "name": "Tacko Fall",
      "pos": "C",
      "jersey": "99"
    },
    {
      "id": "4871141",
      "name": "Ariel Hukporti",
      "pos": "C",
      "jersey": "55"
    },
    {
      "id": "1966",
      "name": "LeBron James",
      "pos": "F",
      "jersey": "23"
    },
    {
      "id": "4431678",
      "name": "Tyrese Maxey",
      "pos": "G",
      "jersey": "0"
    },
    {
      "id": "4873090",
      "name": "Labaron Philon Jr.",
      "pos": "G",
      "jersey": "00"
    }
  ],
  "PHX": [
    {
      "id": "4066268",
      "name": "Duop Reath",
      "pos": "C",
      "jersey": "26"
    },
    {
      "id": "4888725",
      "name": "Ryan Dunn",
      "pos": "F",
      "jersey": "0"
    },
    {
      "id": "3913174",
      "name": "Luke Kennard",
      "pos": "G",
      "jersey": "8"
    },
    {
      "id": "4601023",
      "name": "Oso Ighodaro",
      "pos": "C",
      "jersey": "11"
    },
    {
      "id": "5203685",
      "name": "Khaman Maluach",
      "pos": "C",
      "jersey": "10"
    },
    {
      "id": "4278402",
      "name": "Jordan Goodwin",
      "pos": "G",
      "jersey": "23"
    },
    {
      "id": "3136193",
      "name": "Devin Booker",
      "pos": "G",
      "jersey": "15"
    },
    {
      "id": "4280245",
      "name": "Jamaree Bouyea",
      "pos": "G",
      "jersey": "17"
    },
    {
      "id": "4066383",
      "name": "Miles Bridges",
      "pos": "F",
      "jersey": "22"
    },
    {
      "id": "3155526",
      "name": "Dillon Brooks",
      "pos": "F",
      "jersey": "3"
    },
    {
      "id": "5105977",
      "name": "Rasheer Fleming",
      "pos": "F",
      "jersey": "20"
    },
    {
      "id": "4278585",
      "name": "Collin Gillespie",
      "pos": "G",
      "jersey": "12"
    },
    {
      "id": "4437244",
      "name": "Jalen Green",
      "pos": "G",
      "jersey": "4"
    },
    {
      "id": "5041953",
      "name": "Koa Peat",
      "pos": "F",
      "jersey": "18"
    },
    {
      "id": "4592714",
      "name": "Pat Spencer",
      "pos": "G",
      "jersey": "61"
    },
    {
      "id": "4431695",
      "name": "Drew Timme",
      "pos": "F",
      "jersey": "0"
    },
    {
      "id": "4701232",
      "name": "Mark Williams",
      "pos": "C",
      "jersey": "25"
    }
  ],
  "POR": [
    {
      "id": "3995",
      "name": "Jrue Holiday",
      "pos": "G",
      "jersey": "5"
    },
    {
      "id": "4683678",
      "name": "Scoot Henderson",
      "pos": "G",
      "jersey": "00"
    },
    {
      "id": "4914336",
      "name": "Shaedon Sharpe",
      "pos": "G",
      "jersey": "17"
    },
    {
      "id": "4066211",
      "name": "Robert Williams III",
      "pos": "C",
      "jersey": "35"
    },
    {
      "id": "4578893",
      "name": "Vit Krejci",
      "pos": "G",
      "jersey": "27"
    },
    {
      "id": "4593043",
      "name": "John Tonje",
      "pos": "F",
      "jersey": "2"
    },
    {
      "id": "4683021",
      "name": "Deni Avdija",
      "pos": "F",
      "jersey": "8"
    },
    {
      "id": "4431736",
      "name": "Toumani Camara",
      "pos": "F",
      "jersey": "33"
    },
    {
      "id": "4592435",
      "name": "Branden Carlson",
      "pos": "C",
      "jersey": "10"
    },
    {
      "id": "5081727",
      "name": "Sidy Cissoko",
      "pos": "G",
      "jersey": "91"
    },
    {
      "id": "5105565",
      "name": "Donovan Clingan",
      "pos": "C",
      "jersey": "23"
    },
    {
      "id": "5217746",
      "name": "Yang Hansen",
      "pos": "C",
      "jersey": "16"
    },
    {
      "id": "4703889",
      "name": "Jayson Kent",
      "pos": "G",
      "jersey": "29"
    },
    {
      "id": "6606",
      "name": "Damian Lillard",
      "pos": "G",
      "jersey": "0"
    },
    {
      "id": "4279888",
      "name": "Ja Morant",
      "pos": "G",
      "jersey": "1"
    },
    {
      "id": "4066399",
      "name": "Micah Potter",
      "pos": "C",
      "jersey": "9"
    },
    {
      "id": "4706557",
      "name": "Chris Youngblood",
      "pos": "G",
      "jersey": "11"
    }
  ],
  "SAC": [
    {
      "id": "4431679",
      "name": "Precious Achiuwa",
      "pos": "F",
      "jersey": "9"
    },
    {
      "id": "4066262",
      "name": "Malik Monk",
      "pos": "G",
      "jersey": "0"
    },
    {
      "id": "3907387",
      "name": "Ben Simmons",
      "pos": "G",
      "jersey": "25"
    },
    {
      "id": "5107897",
      "name": "Jonathan Mogbo",
      "pos": "F",
      "jersey": "22"
    },
    {
      "id": "4917149",
      "name": "Alex Karaban",
      "pos": "F",
      "jersey": "33"
    },
    {
      "id": "4702384",
      "name": "Nique Clifford",
      "pos": "G",
      "jersey": "10"
    },
    {
      "id": "5142620",
      "name": "Darius Acuff Jr.",
      "pos": "G",
      "jersey": "5"
    },
    {
      "id": "4395650",
      "name": "Leaky Black",
      "pos": "F",
      "jersey": "19"
    },
    {
      "id": "4433174",
      "name": "Dylan Cardwell",
      "pos": "C",
      "jersey": "32"
    },
    {
      "id": "4065732",
      "name": "De'Andre Hunter",
      "pos": "F",
      "jersey": "15"
    },
    {
      "id": "3064440",
      "name": "Zach LaVine",
      "pos": "G",
      "jersey": "8"
    },
    {
      "id": "4594327",
      "name": "Keegan Murray",
      "pos": "F",
      "jersey": "13"
    },
    {
      "id": "4709131",
      "name": "Sean Pedulla",
      "pos": "G",
      "jersey": "3"
    },
    {
      "id": "4279318",
      "name": "Daeqwon Plowden",
      "pos": "G",
      "jersey": "29"
    },
    {
      "id": "4898371",
      "name": "Maxime Raynaud",
      "pos": "C",
      "jersey": "42"
    },
    {
      "id": "3155942",
      "name": "Domantas Sabonis",
      "pos": "F",
      "jersey": "11"
    },
    {
      "id": "5106058",
      "name": "Emanuel Sharp",
      "pos": "G",
      "jersey": "34"
    }
  ],
  "SAS": [
    {
      "id": "6578",
      "name": "Harrison Barnes",
      "pos": "F",
      "jersey": "40"
    },
    {
      "id": "6440",
      "name": "Tobias Harris",
      "pos": "F",
      "jersey": "23"
    },
    {
      "id": "4592479",
      "name": "Julian Champagnie",
      "pos": "F",
      "jersey": "30"
    },
    {
      "id": "3064560",
      "name": "Luke Kornet",
      "pos": "C",
      "jersey": "7"
    },
    {
      "id": "5037871",
      "name": "Dylan Harper",
      "pos": "G",
      "jersey": "2"
    },
    {
      "id": "3134916",
      "name": "Jordan McLaughlin",
      "pos": "G",
      "jersey": "0"
    },
    {
      "id": "5105337",
      "name": "Maliq Brown",
      "pos": "F",
      "jersey": "15"
    },
    {
      "id": "5061568",
      "name": "Carter Bryant",
      "pos": "F",
      "jersey": "11"
    },
    {
      "id": "4845367",
      "name": "Stephon Castle",
      "pos": "G",
      "jersey": "5"
    },
    {
      "id": "4066259",
      "name": "De'Aaron Fox",
      "pos": "G",
      "jersey": "4"
    },
    {
      "id": "5107968",
      "name": "Ja'Kobi Gillespie",
      "pos": "G",
      "jersey": "17"
    },
    {
      "id": "4395723",
      "name": "Keldon Johnson",
      "pos": "F",
      "jersey": "3"
    },
    {
      "id": "4713010",
      "name": "David Jones Garcia",
      "pos": "F",
      "jersey": "25"
    },
    {
      "id": "5101845",
      "name": "Jayden Quaintance",
      "pos": "F",
      "jersey": "22"
    },
    {
      "id": "5105809",
      "name": "Tarris Reed Jr.",
      "pos": "C",
      "jersey": "10"
    },
    {
      "id": "4395630",
      "name": "Devin Vassell",
      "pos": "G",
      "jersey": "24"
    },
    {
      "id": "5104157",
      "name": "Victor Wembanyama",
      "pos": "F",
      "jersey": "1"
    }
  ],
  "TOR": [
    {
      "id": "2993874",
      "name": "Kyle Anderson",
      "pos": "F",
      "jersey": "12"
    },
    {
      "id": "4431684",
      "name": "Trayce Jackson-Davis",
      "pos": "F",
      "jersey": "32"
    },
    {
      "id": "4684272",
      "name": "Ja'Kobe Walter",
      "pos": "G",
      "jersey": "14"
    },
    {
      "id": "4432241",
      "name": "Jamal Shead",
      "pos": "G",
      "jersey": "23"
    },
    {
      "id": "5093267",
      "name": "Collin Murray-Boyles",
      "pos": "F",
      "jersey": "30"
    },
    {
      "id": "4433134",
      "name": "Scottie Barnes",
      "pos": "F",
      "jersey": "4"
    },
    {
      "id": "4395625",
      "name": "RJ Barrett",
      "pos": "F",
      "jersey": "9"
    },
    {
      "id": "4431893",
      "name": "Jamison Battle",
      "pos": "F",
      "jersey": "77"
    },
    {
      "id": "4432586",
      "name": "Nate Bittle",
      "pos": "C",
      "jersey": "0"
    },
    {
      "id": "4432737",
      "name": "Jaden Bradley",
      "pos": "G",
      "jersey": "8"
    },
    {
      "id": "5149115",
      "name": "Allen Graves",
      "pos": "F",
      "jersey": "22"
    },
    {
      "id": "6450",
      "name": "Kawhi Leonard",
      "pos": "F",
      "jersey": "2"
    },
    {
      "id": "4702656",
      "name": "Alijah Martin",
      "pos": "G",
      "jersey": "55"
    },
    {
      "id": "3134908",
      "name": "Jakob Poeltl",
      "pos": "C",
      "jersey": "19"
    },
    {
      "id": "4395724",
      "name": "Immanuel Quickley",
      "pos": "G",
      "jersey": "5"
    },
    {
      "id": "4397784",
      "name": "Malachi Smith",
      "pos": "G",
      "jersey": "18"
    }
  ],
  "UTA": [
    {
      "id": "4277919",
      "name": "Mo Bamba",
      "pos": "C",
      "jersey": "44"
    },
    {
      "id": "4432811",
      "name": "Josh Green",
      "pos": "G",
      "jersey": "5"
    },
    {
      "id": "4873138",
      "name": "Ace Bailey",
      "pos": "G",
      "jersey": "19"
    },
    {
      "id": "4684793",
      "name": "Kyle Filipowski",
      "pos": "F",
      "jersey": "2"
    },
    {
      "id": "4397077",
      "name": "Jaxson Hayes",
      "pos": "C",
      "jersey": "11"
    },
    {
      "id": "3133602",
      "name": "Svi Mykhailiuk",
      "pos": "G",
      "jersey": "10"
    },
    {
      "id": "5105839",
      "name": "Brice Sensabaugh",
      "pos": "F",
      "jersey": "28"
    },
    {
      "id": "4433268",
      "name": "Trey Alexander",
      "pos": "G",
      "jersey": "15"
    },
    {
      "id": "4065673",
      "name": "Tony Bradley",
      "pos": "C",
      "jersey": "13"
    },
    {
      "id": "4683766",
      "name": "Isaiah Collier",
      "pos": "G",
      "jersey": "8"
    },
    {
      "id": "4433627",
      "name": "Keyonte George",
      "pos": "G",
      "jersey": "3"
    },
    {
      "id": "4396963",
      "name": "Blake Hinson",
      "pos": "F",
      "jersey": "25"
    },
    {
      "id": "4433618",
      "name": "Harrison Ingram",
      "pos": "F",
      "jersey": "00"
    },
    {
      "id": "4277961",
      "name": "Jaren Jackson Jr.",
      "pos": "F",
      "jersey": "20"
    },
    {
      "id": "4066336",
      "name": "Lauri Markkanen",
      "pos": "F",
      "jersey": "23"
    },
    {
      "id": "3102530",
      "name": "Jusuf Nurkic",
      "pos": "C",
      "jersey": "30"
    },
    {
      "id": "4065663",
      "name": "Josh Okogie",
      "pos": "G",
      "jersey": "21"
    },
    {
      "id": "5041955",
      "name": "Darryn Peterson",
      "pos": "G",
      "jersey": "22"
    }
  ],
  "WAS": [
    {
      "id": "6609",
      "name": "Khris Middleton",
      "pos": "F",
      "jersey": "22"
    },
    {
      "id": "5160992",
      "name": "Alex Sarr",
      "pos": "C",
      "jersey": "20"
    },
    {
      "id": "4432819",
      "name": "Tre Mann",
      "pos": "G",
      "jersey": "1"
    },
    {
      "id": "5174563",
      "name": "Kyshawn George",
      "pos": "F",
      "jersey": "18"
    },
    {
      "id": "5142718",
      "name": "AJ Dybantsa",
      "pos": "F",
      "jersey": "4"
    },
    {
      "id": "4278129",
      "name": "Deandre Ayton",
      "pos": "C",
      "jersey": "8"
    },
    {
      "id": "4432187",
      "name": "Reece Beekman",
      "pos": "G",
      "jersey": "26"
    },
    {
      "id": "4845374",
      "name": "Bub Carrington",
      "pos": "G",
      "jersey": "7"
    },
    {
      "id": "4432907",
      "name": "Justin Champagnie",
      "pos": "F",
      "jersey": "9"
    },
    {
      "id": "5104155",
      "name": "Bilal Coulibaly",
      "pos": "G",
      "jersey": "0"
    },
    {
      "id": "6583",
      "name": "Anthony Davis",
      "pos": "F",
      "jersey": "23"
    },
    {
      "id": "2581184",
      "name": "Anthony Gill",
      "pos": "F",
      "jersey": "16"
    },
    {
      "id": "5238230",
      "name": "Tre Johnson",
      "pos": "G",
      "jersey": "12"
    },
    {
      "id": "5105841",
      "name": "Felix Okpara",
      "pos": "F",
      "jersey": "34"
    },
    {
      "id": "5144126",
      "name": "Will Riley",
      "pos": "G",
      "jersey": "27"
    },
    {
      "id": "4997537",
      "name": "Tristan Vukcevic",
      "pos": "F",
      "jersey": "00"
    },
    {
      "id": "4606840",
      "name": "Jamir Watkins",
      "pos": "G",
      "jersey": "5"
    },
    {
      "id": "4277905",
      "name": "Trae Young",
      "pos": "G",
      "jersey": "3"
    }
  ]
};

/**
 * Get the full active roster for a team abbreviation (alias-aware)
 */
export function getFullRosterForTeam(teamAbbr) {
  if (!teamAbbr) return [];
  const clean = teamAbbr.toUpperCase();
  const resolved = TEAM_ABBR_ALIASES[clean] || clean;
  return NBA_FULL_ROSTERS[resolved] || NBA_FULL_ROSTERS[clean] || [];
}

/**
 * Score how well a candidate's position matches the target position
 */
function positionMatchScore(targetPos, candPos) {
  const t = (targetPos || '').toUpperCase();
  const c = (candPos || '').toUpperCase();

  if (t === 'C') {
    if (c === 'C' || c === 'C-F') return 100;
    if (c === 'F-C') return 90;
    if (c === 'F' || c === 'PF') return 30;
    return -100; // Never put a guard at Center
  }
  if (t === 'PF') {
    if (c === 'PF') return 100;
    if (c === 'F' || c === 'F-C') return 90;
    if (c === 'SF') return 65;
    if (c === 'C') return 50;
    return 0;
  }
  if (t === 'SF') {
    if (c === 'SF') return 100;
    if (c === 'G-F') return 95;
    if (c === 'F') return 90;
    if (c === 'SG') return 70;
    if (c === 'PF') return 60;
    return 0;
  }
  if (t === 'SG') {
    if (c === 'SG') return 100;
    if (c === 'G' || c === 'G-F') return 90;
    if (c === 'PG' || c === 'SF') return 70;
    return 0;
  }
  if (t === 'PG') {
    if (c === 'PG') return 100;
    if (c === 'G') return 90;
    if (c === 'SG') return 70;
    return 0;
  }
  return 20;
}

/**
 * Find the optimal next-man-up replacement player from the bench depth chart
 * when a starter is confirmed OUT with an injury.
 */
export function findPositionalReplacement(teamAbbr, outStarter, activeStarters = [], injuryMap = new Map()) {
  const roster = getFullRosterForTeam(teamAbbr);
  if (!roster || roster.length === 0) return null;

  const targetPos = outStarter?.position || 'SF';
  const activeIds = new Set(activeStarters.map((s) => String(s.id)));
  const activeNames = new Set(activeStarters.map((s) => (s.name || '').toLowerCase()));

  // Filter candidates who are NOT currently in the starting 5 and NOT confirmed OUT
  const available = [];
  for (let rank = 0; rank < roster.length; rank++) {
    const cand = roster[rank];
    if (activeIds.has(String(cand.id))) continue;
    if (activeNames.has((cand.name || '').toLowerCase())) continue;
    if (String(cand.id) === String(outStarter?.id)) continue;
    if ((cand.name || '').toLowerCase() === (outStarter?.name || '').toLowerCase()) continue;

    const inj = injuryMap.get(String(cand.id)) || injuryMap.get((cand.name || '').toLowerCase());
    if (inj && (inj.isOut || inj.status === 'out')) continue;

    const posScore = positionMatchScore(targetPos, cand.pos);
    if (posScore <= 0) continue; // Incompatible position

    // Combined score: Positional Fit (max 100) + Depth Chart Priority Bonus (up to 60 for top rotation bench)
    const depthBonus = Math.max(0, 60 - (rank * 5));
    available.push({
      cand,
      score: posScore + depthBonus,
      rank,
    });
  }

  if (available.length === 0) {
    // Fallback: pick highest-ranked available player on bench
    for (const cand of roster) {
      if (activeIds.has(String(cand.id))) continue;
      if (activeNames.has((cand.name || '').toLowerCase())) continue;
      const inj = injuryMap.get(String(cand.id)) || injuryMap.get((cand.name || '').toLowerCase());
      if (inj && (inj.isOut || inj.status === 'out')) continue;
      available.push({ cand, score: 10, rank: 99 });
      break;
    }
  }

  if (available.length === 0) return null;

  available.sort((a, b) => b.score - a.score);
  const best = available[0].cand;

  const isCenter = targetPos === 'C' || best.pos === 'C';
  return {
    id: String(best.id),
    name: best.name,
    team: teamAbbr,
    position: best.pos || targetPos,
    jersey: best.jersey || '0',
    isStarter: true,
    isReplacement: true,
    replacedPlayer: outStarter.name,
    earlyShotShare: Math.max(0.12, Math.round((outStarter.earlyShotShare || 0.20) * 0.80 * 100) / 100),
    shotMix: outStarter.shotMix || (isCenter ? { rim: 0.70, mid: 0.20, three: 0.10 } : { rim: 0.40, mid: 0.30, three: 0.30 }),
    rimFG: outStarter.rimFG || 0.64,
    midFG: outStarter.midFG || 0.42,
    threeFG: outStarter.threeFG || 0.36,
    seasonUsage: Math.max(16, Math.round((outStarter.seasonUsage || 20) * 0.85)),
    injury: null,
  };
}
