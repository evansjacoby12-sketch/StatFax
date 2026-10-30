"""
fb-model/ingest/odds.py — Multi-Book First-Basket Odds & De-Vigging

Pulls and stores multi-book first-basket prices (DraftKings, FanDuel, BetMGM, Caesars),
closing lines, and computes de-vigged implied probabilities to benchmark model edge.
"""

import os
import sqlite3
import pandas as pd
from typing import Dict, Any, List

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fb_database.sqlite")

ODDS_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS market_odds (
    game_id TEXT,
    sportsbook TEXT, -- 'DraftKings', 'FanDuel', 'BetMGM', 'Caesars'
    market_type TEXT, -- 'FIRST_FIELD_GOAL', 'FIRST_POINT_SCORED'
    player_id INTEGER,
    player_name TEXT,
    team_abbr TEXT,
    american_odds INTEGER,
    implied_prob REAL,
    devigged_prob REAL,
    is_closing_line INTEGER DEFAULT 1,
    captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (game_id, sportsbook, market_type, player_id)
);

CREATE INDEX IF NOT EXISTS idx_odds_game ON market_odds (game_id);
CREATE INDEX IF NOT EXISTS idx_odds_player ON market_odds (player_id);
"""

def american_to_implied(odds: int) -> float:
    """Converts American odds (+450, -110) to raw implied probability."""
    if odds > 0:
        return 100.0 / (odds + 100.0)
    else:
        return abs(odds) / (abs(odds) + 100.0)

def implied_to_american(prob: float) -> int:
    """Converts probability to American odds integer."""
    if prob <= 0 or prob >= 1:
        return 0
    if prob < 0.5:
        return int(round((1.0 - prob) / prob * 100))
    else:
        return int(round(- (prob / (1.0 - prob)) * 100))

def devig_market(runners: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Normalizes multi-runner market by removing juice (overround).
    Returns runners with 'devigged_prob'.
    """
    total_implied = sum(american_to_implied(r["american_odds"]) for r in runners)
    overround = total_implied - 1.0

    results = []
    for r in runners:
        imp = american_to_implied(r["american_odds"])
        fair = imp / total_implied if total_implied > 0 else imp
        results.append({
            **r,
            "implied_prob": round(imp, 4),
            "devigged_prob": round(fair, 4),
            "overround": round(overround, 4),
        })
    return results

def init_odds_table(db_path: str = DB_PATH):
    conn = sqlite3.connect(db_path)
    with conn:
        conn.executescript(ODDS_SCHEMA_SQL)
    conn.close()

def save_market_odds(records: List[Dict[str, Any]], db_path: str = DB_PATH):
    """Saves market odds records into SQLite."""
    init_odds_table(db_path)
    conn = sqlite3.connect(db_path)
    with conn:
        for r in records:
            conn.execute("""
            INSERT OR REPLACE INTO market_odds (
                game_id, sportsbook, market_type, player_id, player_name,
                team_abbr, american_odds, implied_prob, devigged_prob, is_closing_line
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                r["game_id"],
                r["sportsbook"],
                r.get("market_type", "FIRST_FIELD_GOAL"),
                r["player_id"],
                r["player_name"],
                r["team_abbr"],
                r["american_odds"],
                r["implied_prob"],
                r["devigged_prob"],
                r.get("is_closing_line", 1)
            ))
    conn.close()

def get_closing_odds_for_game(game_id: str, sportsbook: str = "DraftKings", db_path: str = DB_PATH) -> pd.DataFrame:
    """Retrieves closing odds with devigged probabilities for a game."""
    conn = sqlite3.connect(db_path)
    df = pd.read_sql_query("""
    SELECT game_id, sportsbook, market_type, player_id, player_name, team_abbr,
           american_odds, implied_prob, devigged_prob
    FROM market_odds
    WHERE game_id = ? AND sportsbook = ?
    ORDER BY devigged_prob DESC
    """, conn, params=(game_id, sportsbook))
    conn.close()
    return df

def seed_sample_odds_for_game(game_id: str, starters: pd.DataFrame, db_path: str = DB_PATH):
    """
    Generates realistic multi-book first-basket odds (with standard ~18-22% overround)
    for confirmed starters in a given game.
    """
    books = ["DraftKings", "FanDuel", "BetMGM", "Caesars"]
    # Synthetic reasonable prices based on typical starter tiers (+350 to +1400)
    base_odds = [400, 450, 500, 550, 650, 750, 850, 950, 1100, 1200]

    all_odds_records = []
    starters_list = starters.to_dict("records")
    for b_idx, book in enumerate(books):
        book_runners = []
        for p_idx, player in enumerate(starters_list[:10]):
            price = base_odds[p_idx % len(base_odds)] + (b_idx * 20 - 30)
            book_runners.append({
                "game_id": game_id,
                "sportsbook": book,
                "market_type": "FIRST_FIELD_GOAL",
                "player_id": player["player_id"],
                "player_name": player["player_name"],
                "team_abbr": player["team_abbr"],
                "american_odds": price,
            })
        devigged = devig_market(book_runners)
        all_odds_records.extend(devigged)

    save_market_odds(all_odds_records, db_path)

if __name__ == "__main__":
    init_odds_table()
    print("[odds.py] Odds schema initialized.")
