"""
fb-model/features/shot_share.py — Early Possession Shot Share Extraction

Computes player shot share in the first N possessions (default N = 6 per team),
distinguishing early-game scripted usage from full-game usage.
"""

import os
import sqlite3
import json
import pandas as pd
from typing import Dict, Any, Tuple

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fb_database.sqlite")

SHOT_SHARE_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS player_early_shot_shares (
    player_id INTEGER PRIMARY KEY,
    player_name TEXT,
    team_abbr TEXT,
    games_observed INTEGER,
    early_fga INTEGER,
    team_early_fga INTEGER,
    raw_early_share REAL,
    first_team_shot_attempts INTEGER,
    first_team_shot_share REAL,
    early_fga_per_game REAL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shot_share_team ON player_early_shot_shares (team_abbr);
"""

def extract_early_shot_shares(n_possessions: int = 6, db_path: str = DB_PATH) -> pd.DataFrame:
    """
    Extracts all field goal attempts occurring in the first N possessions for each team.
    Computes player early shot share and team's first shot share.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    with conn:
        conn.executescript(SHOT_SHARE_SCHEMA_SQL)

    # Query all raw_pbp SHOT events
    query = """
    SELECT 
        game_id, event_idx, period, clock,
        player1_id AS player_id,
        player1_name AS player_name,
        team_abbr,
        shot_type,
        is_make,
        raw_json
    FROM raw_pbp
    WHERE action_type = 'SHOT' AND period = 1
    ORDER BY game_id, event_idx ASC
    """
    df_shots = pd.read_sql_query(query, conn)

    # Extract team possession number from raw_json
    def parse_poss(raw_val):
        if not raw_val:
            return 1
        try:
            data = json.loads(raw_val) if isinstance(raw_val, str) else raw_val
            return data.get("team_possession", 1)
        except Exception:
            return 1

    df_shots["team_possession"] = df_shots["raw_json"].apply(parse_poss)

    # Filter to first N possessions per team
    df_early = df_shots[df_shots["team_possession"] <= n_possessions].copy()

    # Track first shot of game per team (possession 1)
    df_first_shots = df_early[df_early["team_possession"] == 1].groupby(["game_id", "team_abbr"]).first().reset_index()

    # Aggregate by team to get total early shots
    team_totals = df_early.groupby("team_abbr")["event_idx"].count().to_dict()
    team_games = df_early.groupby("team_abbr")["game_id"].nunique().to_dict()

    # Aggregate by player
    player_groups = df_early.groupby(["player_id", "player_name", "team_abbr"])

    records = []
    with conn:
        for (p_id, p_name, t_abbr), group in player_groups:
            fga = len(group)
            tot_team_fga = team_totals.get(t_abbr, fga)
            games = team_games.get(t_abbr, 1)

            # First team shot count
            first_shots_count = len(df_first_shots[(df_first_shots["player_id"] == p_id)])
            first_shot_share = first_shots_count / games if games > 0 else 0.0

            raw_share = fga / tot_team_fga if tot_team_fga > 0 else 0.0
            fga_per_game = fga / games if games > 0 else 0.0

            records.append({
                "player_id": p_id,
                "player_name": p_name,
                "team_abbr": t_abbr,
                "games_observed": games,
                "early_fga": fga,
                "team_early_fga": tot_team_fga,
                "raw_early_share": round(raw_share, 4),
                "first_team_shot_attempts": first_shots_count,
                "first_team_shot_share": round(first_shot_share, 4),
                "early_fga_per_game": round(fga_per_game, 2),
            })

            conn.execute("""
            INSERT OR REPLACE INTO player_early_shot_shares (
                player_id, player_name, team_abbr, games_observed,
                early_fga, team_early_fga, raw_early_share,
                first_team_shot_attempts, first_team_shot_share, early_fga_per_game
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                p_id, p_name, t_abbr, games,
                fga, tot_team_fga, round(raw_share, 4),
                first_shots_count, round(first_shot_share, 4), round(fga_per_game, 2)
            ))

    conn.close()
    df_result = pd.DataFrame(records).sort_values("raw_early_share", ascending=False)
    return df_result

def verify_shot_share_features(db_path: str = DB_PATH):
    """Verifies that player early shot share counts and distributions are valid."""
    df = extract_early_shot_shares(n_possessions=6, db_path=db_path)

    print("\n--- Feature Extraction: Early Possession Shot Shares (First 6 Possessions) ---")
    print(f"Total Players Analyzed: {len(df)}")
    print("\nTop 10 Early Shot Options by Scripted Share:")
    print(df[["player_name", "team_abbr", "early_fga", "team_early_fga", "raw_early_share", "first_team_shot_share", "early_fga_per_game"]].head(10).to_string(index=False))
    print("--------------------------------------------------------------------------------\n")

    assert len(df) > 0, "No players analyzed"
    # Invariant: Each team's top option should have shot share between 20% and 45%
    top_share = df["raw_early_share"].max()
    assert 0.20 <= top_share <= 0.45, f"Top shot share {top_share} outside expected range [0.20, 0.45]"

    # Verify each team's starter shot shares sum close to 1.0 (0.95 - 1.05)
    team_sums = df.groupby("team_abbr")["raw_early_share"].sum()
    for team, share_sum in team_sums.items():
        assert 0.95 <= share_sum <= 1.05, f"Team {team} shot shares sum to {share_sum}, expected ~1.0"

if __name__ == "__main__":
    verify_shot_share_features()
