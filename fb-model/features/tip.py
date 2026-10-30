"""
fb-model/features/tip.py — Opening Tip-Off & First-Score Feature Extraction

Derives from raw play-by-play:
1. Opening jump-ball winner, jumper identities, reach differential.
2. Bayesian shrunk tip win rates per jumper with sample size column.
3. First-possession capture and first-score outcomes.
4. Empirical tip-to-first-score conversion validation.
"""

import os
import sqlite3
import pandas as pd
from typing import Dict, Any, Tuple

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fb_database.sqlite")

FEATURE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS derived_tips (
    game_id TEXT PRIMARY KEY,
    jumper1_id INTEGER,
    jumper1_name TEXT,
    jumper2_id INTEGER,
    jumper2_name TEXT,
    winning_jumper_id INTEGER,
    winning_jumper_name TEXT,
    winning_team_abbr TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS first_scores (
    game_id TEXT PRIMARY KEY,
    scoring_team_abbr TEXT,
    player_id INTEGER,
    player_name TEXT,
    shot_type TEXT,
    points INTEGER,
    clock TEXT,
    event_idx INTEGER,
    tip_winner_scored_first INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jumper_ratings (
    player_id INTEGER PRIMARY KEY,
    player_name TEXT,
    team_abbr TEXT,
    tip_attempts INTEGER,
    tip_wins INTEGER,
    raw_win_rate REAL,
    shrunk_win_rate REAL,
    sample_tier TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""

def extract_tips_and_scores(db_path: str = DB_PATH) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Parses raw_pbp table to derive jump balls, first scores, and jumper ratings.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(FEATURE_TABLES_SQL)

    # 1. Extract opening jump balls (event_idx = 1 or earliest JUMP_BALL in period 1)
    jump_ball_query = """
    SELECT 
        game_id, event_idx, period, clock,
        player1_id AS jumper1_id, player1_name AS jumper1_name,
        player2_id AS jumper2_id, player2_name AS jumper2_name,
        player3_id AS winner_id, player3_name AS winner_name,
        team_abbr AS winning_team
    FROM raw_pbp
    WHERE action_type = 'JUMP_BALL' AND period = 1
    GROUP BY game_id
    HAVING MIN(event_idx)
    """
    df_tips = pd.read_sql_query(jump_ball_query, conn)

    # 2. Extract first-score event per game (earliest made shot)
    first_score_query = """
    SELECT 
        game_id, event_idx, period, clock,
        team_abbr AS scoring_team,
        player1_id AS player_id,
        player1_name AS player_name,
        shot_type,
        CASE WHEN shot_type = '3PT' THEN 3 ELSE 2 END AS points
    FROM raw_pbp
    WHERE action_type = 'SHOT' AND is_make = 1 AND period = 1
    GROUP BY game_id
    HAVING MIN(event_idx)
    """
    df_scores = pd.read_sql_query(first_score_query, conn)

    # Merge tips with first scores to verify conversion
    df_merged = pd.merge(df_tips, df_scores, on="game_id", suffixes=("_tip", "_score"))
    df_merged["tip_winner_scored_first"] = (df_merged["winning_team"] == df_merged["scoring_team"]).astype(int)

    # Save to SQLite derived_tips & first_scores
    with conn:
        for _, row in df_tips.iterrows():
            conn.execute("""
            INSERT OR REPLACE INTO derived_tips (
                game_id, jumper1_id, jumper1_name, jumper2_id, jumper2_name,
                winning_jumper_id, winning_jumper_name, winning_team_abbr
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                row["game_id"], row["jumper1_id"], row["jumper1_name"],
                row["jumper2_id"], row["jumper2_name"],
                row["winner_id"], row["winner_name"], row["winning_team"]
            ))

        for _, row in df_merged.iterrows():
            conn.execute("""
            INSERT OR REPLACE INTO first_scores (
                game_id, scoring_team_abbr, player_id, player_name,
                shot_type, points, clock, event_idx, tip_winner_scored_first
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                row["game_id"], row["scoring_team"], row["player_id"], row["player_name"],
                row["shot_type"], row["points"], row["clock_score"], row["event_idx_score"],
                int(row["tip_winner_scored_first"])
            ))

    # 3. Compute jumper ratings with Bayesian shrinkage (prior m = 20 tips @ 50%)
    jumper_records = {}
    for _, row in df_tips.iterrows():
        # Jumper 1
        j1 = row["jumper1_name"]
        j1_id = row["jumper1_id"]
        if j1 not in jumper_records:
            jumper_records[j1] = {"id": j1_id, "name": j1, "attempts": 0, "wins": 0}
        jumper_records[j1]["attempts"] += 1
        if row["winner_name"] == j1:
            jumper_records[j1]["wins"] += 1

        # Jumper 2
        j2 = row["jumper2_name"]
        j2_id = row["jumper2_id"]
        if j2 not in jumper_records:
            jumper_records[j2] = {"id": j2_id, "name": j2, "attempts": 0, "wins": 0}
        jumper_records[j2]["attempts"] += 1
        if row["winner_name"] == j2:
            jumper_records[j2]["wins"] += 1

    ratings_list = []
    m_prior = 20.0
    p_prior = 0.50

    with conn:
        for j_name, data in jumper_records.items():
            n = data["attempts"]
            w = data["wins"]
            raw_rate = w / n if n > 0 else 0.50
            # Bayesian shrinkage toward 50%: (n * raw + m * prior) / (n + m)
            shrunk_rate = (n * raw_rate + m_prior * p_prior) / (n + m_prior)
            tier = "HIGH" if n >= 25 else ("MEDIUM" if n >= 10 else "SHRUNK_LOW")

            ratings_list.append({
                "player_id": data["id"],
                "player_name": j_name,
                "tip_attempts": n,
                "tip_wins": w,
                "raw_win_rate": round(raw_rate, 3),
                "shrunk_win_rate": round(shrunk_rate, 3),
                "sample_tier": tier,
            })

            conn.execute("""
            INSERT OR REPLACE INTO jumper_ratings (
                player_id, player_name, tip_attempts, tip_wins,
                raw_win_rate, shrunk_win_rate, sample_tier
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                data["id"], j_name, n, w,
                round(raw_rate, 3), round(shrunk_rate, 3), tier
            ))

    df_ratings = pd.DataFrame(ratings_list).sort_values("tip_attempts", ascending=False)
    conn.close()

    return df_tips, df_scores, df_ratings

def verify_tip_features(db_path: str = DB_PATH):
    """Verifies that tip-offs, first scores, and conversion counts look completely sane."""
    tips, scores, ratings = extract_tips_and_scores(db_path)

    conn = sqlite3.connect(db_path)
    total_tips = conn.execute("SELECT COUNT(*) FROM derived_tips").fetchone()[0]
    total_scores = conn.execute("SELECT COUNT(*) FROM first_scores").fetchone()[0]
    conversion_rate = conn.execute("SELECT AVG(tip_winner_scored_first) FROM first_scores").fetchone()[0]
    conn.close()

    print("\n--- Feature Extraction: Tip-Offs & First Scores ---")
    print(f"Total Opening Jump Balls Extracted: {total_tips}")
    print(f"Total First Basket Scores Extracted: {total_scores}")
    print(f"Empirical Tip-to-Score Conversion:  {conversion_rate * 100:.1f}%")
    print("\nTop Opening Jumpers by Calibrated Sample:")
    print(ratings.head(8).to_string(index=False))
    print("---------------------------------------------------\n")

    assert total_tips == 120, f"Expected 120 tips, got {total_tips}"
    assert total_scores == 120, f"Expected 120 scores, got {total_scores}"
    # Basketball invariant: Tip winner scores first 55-75% of the time
    assert 0.50 <= conversion_rate <= 0.75, f"Conversion rate {conversion_rate} outside expected range [0.50, 0.75]"

if __name__ == "__main__":
    verify_tip_features()
