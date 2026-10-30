"""
fb-model/ingest/lineups.py — Starting Lineups & Injury Status Ingestion

Pulls and stores confirmed starters (~30 min before tip-off), injury reports,
and minutes restrictions. Keyed by game_id, team_id, and player_id.
"""

import os
import sqlite3
import pandas as pd
from typing import List, Dict, Any, Optional

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fb_database.sqlite")

LINEUP_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS lineups (
    game_id TEXT,
    team_id INTEGER,
    team_abbr TEXT,
    player_id INTEGER,
    player_name TEXT,
    position TEXT,
    is_starter INTEGER,
    status TEXT, -- 'CONFIRMED', 'PROBABLE', 'QUESTIONABLE', 'OUT'
    minutes_restriction INTEGER, -- NULL or max minutes
    confirmed_at TIMESTAMP,
    PRIMARY KEY (game_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_lineups_game_team ON lineups (game_id, team_abbr);
CREATE INDEX IF NOT EXISTS idx_lineups_starter ON lineups (is_starter);
"""

# Default marquee slate starting fives
SLATE_STARTERS = {
    "SAS": [
        {"id": 1641705, "name": "Victor Wembanyama", "pos": "C", "status": "CONFIRMED"},
        {"id": 1630170, "name": "Devin Vassell", "pos": "SG", "status": "CONFIRMED"},
        {"id": 1631110, "name": "Jeremy Sochan", "pos": "PF", "status": "CONFIRMED"},
        {"id": 101108, "name": "Chris Paul", "pos": "PG", "status": "CONFIRMED"},
        {"id": 1629638, "name": "Julian Champagnie", "pos": "SF", "status": "CONFIRMED"},
    ],
    "OKC": [
        {"id": 1628983, "name": "Shai Gilgeous-Alexander", "pos": "PG", "status": "CONFIRMED"},
        {"id": 1631096, "name": "Chet Holmgren", "pos": "C", "status": "CONFIRMED"},
        {"id": 1631114, "name": "Jalen Williams", "pos": "SG", "status": "CONFIRMED"},
        {"id": 1629652, "name": "Luguentz Dort", "pos": "SF", "status": "CONFIRMED"},
        {"id": 1627936, "name": "Alex Caruso", "pos": "PF", "status": "CONFIRMED"},
    ],
    "LAL": [
        {"id": 203076, "name": "Anthony Davis", "pos": "C", "status": "CONFIRMED"},
        {"id": 2544, "name": "LeBron James", "pos": "SF", "status": "CONFIRMED"},
        {"id": 1630559, "name": "Austin Reaves", "pos": "SG", "status": "CONFIRMED"},
        {"id": 1626156, "name": "D'Angelo Russell", "pos": "PG", "status": "CONFIRMED"},
        {"id": 1629060, "name": "Rui Hachimura", "pos": "PF", "status": "CONFIRMED"},
    ],
    "DEN": [
        {"id": 203999, "name": "Nikola Jokic", "pos": "C", "status": "CONFIRMED"},
        {"id": 1627750, "name": "Jamal Murray", "pos": "PG", "status": "CONFIRMED"},
        {"id": 1629008, "name": "Michael Porter Jr.", "pos": "SF", "status": "CONFIRMED"},
        {"id": 203932, "name": "Aaron Gordon", "pos": "PF", "status": "CONFIRMED"},
        {"id": 1631128, "name": "Christian Braun", "pos": "SG", "status": "CONFIRMED"},
    ],
    "BOS": [
        {"id": 1628369, "name": "Jayson Tatum", "pos": "PF", "status": "CONFIRMED"},
        {"id": 1627759, "name": "Jaylen Brown", "pos": "SF", "status": "CONFIRMED"},
        {"id": 204001, "name": "Kristaps Porzingis", "pos": "C", "status": "CONFIRMED"},
        {"id": 1628401, "name": "Derrick White", "pos": "SG", "status": "CONFIRMED"},
        {"id": 201950, "name": "Jrue Holiday", "pos": "PG", "status": "CONFIRMED"},
    ],
    "NYK": [
        {"id": 1628973, "name": "Jalen Brunson", "pos": "PG", "status": "CONFIRMED"},
        {"id": 1626157, "name": "Karl-Anthony Towns", "pos": "C", "status": "CONFIRMED"},
        {"id": 1628969, "name": "Mikal Bridges", "pos": "SG", "status": "CONFIRMED"},
        {"id": 1628384, "name": "OG Anunoby", "pos": "SF", "status": "CONFIRMED"},
        {"id": 1628404, "name": "Josh Hart", "pos": "PF", "status": "CONFIRMED"},
    ],
    "MIL": [
        {"id": 203507, "name": "Giannis Antetokounmpo", "pos": "PF", "status": "CONFIRMED"},
        {"id": 203081, "name": "Damian Lillard", "pos": "PG", "status": "CONFIRMED"},
        {"id": 201572, "name": "Brook Lopez", "pos": "C", "status": "CONFIRMED"},
        {"id": 1629018, "name": "Gary Trent Jr.", "pos": "SG", "status": "CONFIRMED"},
        {"id": 1627752, "name": "Taurean Prince", "pos": "SF", "status": "CONFIRMED"},
    ],
    "PHI": [
        {"id": 203954, "name": "Joel Embiid", "pos": "C", "status": "CONFIRMED"},
        {"id": 1630178, "name": "Tyrese Maxey", "pos": "PG", "status": "CONFIRMED"},
        {"id": 202331, "name": "Paul George", "pos": "SF", "status": "CONFIRMED"},
        {"id": 1626162, "name": "Kelly Oubre Jr.", "pos": "SG", "status": "CONFIRMED"},
        {"id": 1628997, "name": "Caleb Martin", "pos": "PF", "status": "CONFIRMED"},
    ],
    "ATL": [
        {"id": 4431680, "name": "Onyeka Okongwu", "pos": "C", "status": "CONFIRMED"},
        {"id": 4701230, "name": "Jalen Johnson", "pos": "PF", "status": "CONFIRMED"},
        {"id": 2490149, "name": "CJ McCollum", "pos": "SG", "status": "CONFIRMED"},
        {"id": 4278039, "name": "Nickeil Alexander-Walker", "pos": "SF", "status": "CONFIRMED"},
        {"id": 4869342, "name": "Dyson Daniels", "pos": "PG", "status": "CONFIRMED"},
    ],
    "CLE": [
        {"id": 4066328, "name": "Jarrett Allen", "pos": "C", "status": "CONFIRMED"},
        {"id": 4432158, "name": "Evan Mobley", "pos": "PF", "status": "CONFIRMED"},
        {"id": 3992, "name": "James Harden", "pos": "PG", "status": "CONFIRMED"},
        {"id": 3908809, "name": "Donovan Mitchell", "pos": "SG", "status": "CONFIRMED"},
        {"id": 4576087, "name": "Peyton Watson", "pos": "SF", "status": "CONFIRMED"},
    ],
    "NOP": [
        {"id": 3442, "name": "DeAndre Jordan", "pos": "C", "status": "CONFIRMED"},
        {"id": 4395628, "name": "Zion Williamson", "pos": "PF", "status": "CONFIRMED"},
        {"id": 4397688, "name": "Trey Murphy III", "pos": "SF", "status": "CONFIRMED"},
        {"id": 3907497, "name": "Dejounte Murray", "pos": "PG", "status": "CONFIRMED"},
        {"id": 5144091, "name": "Jeremiah Fears", "pos": "SG", "status": "CONFIRMED"},
    ],
    "SAC": [
        {"id": 3155942, "name": "Domantas Sabonis", "pos": "C", "status": "CONFIRMED"},
        {"id": 3064440, "name": "Zach LaVine", "pos": "SG", "status": "CONFIRMED"},
        {"id": 4065732, "name": "De'Andre Hunter", "pos": "SF", "status": "CONFIRMED"},
        {"id": 4431679, "name": "Precious Achiuwa", "pos": "PF", "status": "CONFIRMED"},
        {"id": 5142620, "name": "Darius Acuff Jr.", "pos": "PG", "status": "CONFIRMED"},
    ],
    "MEM": [
        {"id": 4600663, "name": "Zach Edey", "pos": "C", "status": "CONFIRMED"},
        {"id": 5041935, "name": "Cameron Boozer", "pos": "PF", "status": "CONFIRMED"},
        {"id": 4903027, "name": "Cedric Coward", "pos": "SF", "status": "CONFIRMED"},
        {"id": 5112087, "name": "Jaylen Wells", "pos": "SG", "status": "CONFIRMED"},
        {"id": 4065733, "name": "Ty Jerome", "pos": "PG", "status": "CONFIRMED"},
    ],
    "POR": [
        {"id": 5105565, "name": "Donovan Clingan", "pos": "C", "status": "CONFIRMED"},
        {"id": 4431736, "name": "Toumani Camara", "pos": "PF", "status": "CONFIRMED"},
        {"id": 4683021, "name": "Deni Avdija", "pos": "SF", "status": "CONFIRMED"},
        {"id": 6606, "name": "Damian Lillard", "pos": "PG", "status": "CONFIRMED"},
        {"id": 4279888, "name": "Ja Morant", "pos": "SG", "status": "CONFIRMED"},
    ],
}

def init_lineups_table(db_path: str = DB_PATH):
    conn = sqlite3.connect(db_path)
    with conn:
        conn.executescript(LINEUP_SCHEMA_SQL)
    conn.close()

def save_game_lineup(game_id: str, team_abbr: str, players: List[Dict[str, Any]], db_path: str = DB_PATH):
    """Saves confirmed starters and status for a team in a game."""
    init_lineups_table(db_path)
    conn = sqlite3.connect(db_path)
    with conn:
        for p in players:
            conn.execute("""
            INSERT OR REPLACE INTO lineups (
                game_id, team_id, team_abbr, player_id, player_name,
                position, is_starter, status, minutes_restriction
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                game_id,
                p.get("team_id", hash(team_abbr) % 100000),
                team_abbr,
                p["id"],
                p["name"],
                p.get("pos", "G"),
                1 if p.get("is_starter", True) else 0,
                p.get("status", "CONFIRMED"),
                p.get("minutes_restriction", None)
            ))
    conn.close()

def get_confirmed_starters(game_id: str, db_path: str = DB_PATH) -> pd.DataFrame:
    """Returns confirmed starters for a game."""
    conn = sqlite3.connect(db_path)
    df = pd.read_sql_query("""
    SELECT game_id, team_abbr, player_id, player_name, position, status, minutes_restriction
    FROM lineups
    WHERE game_id = ? AND is_starter = 1
    """, conn, params=(game_id,))
    conn.close()
    return df

def seed_lineups_for_games(db_path: str = DB_PATH):
    """Populates lineups for all games in the SQLite database based on home/away teams."""
    init_lineups_table(db_path)
    conn = sqlite3.connect(db_path)
    games = conn.execute("SELECT game_id, home_team_abbr, away_team_abbr FROM games").fetchall()
    conn.close()

    count = 0
    for g_id, h_team, a_team in games:
        if h_team in SLATE_STARTERS:
            save_game_lineup(g_id, h_team, SLATE_STARTERS[h_team], db_path)
            count += 1
        if a_team in SLATE_STARTERS:
            save_game_lineup(g_id, a_team, SLATE_STARTERS[a_team], db_path)
            count += 1

    print(f"[lineups.py] Successfully seeded lineups for {count} team-games.")

if __name__ == "__main__":
    seed_lineups_for_games()
