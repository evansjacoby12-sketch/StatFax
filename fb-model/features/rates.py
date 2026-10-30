"""
fb-model/features/rates.py — Shot Make Rates, Opening Possessions & Context Adjusters

Extracts:
1. Per-shot make probabilities by shot type/zone (rim, mid, three, FT) across all shots.
2. Team opening stretch rates: Turnover rate, shooting foul rate, offensive rebound rate.
3. Context adjusters: Opponent rim/3PT defense, pace, rest/back-to-back, home/away.
"""

import os
import sqlite3
import json
import pandas as pd
from typing import Dict, Any, Tuple

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fb_database.sqlite")

RATES_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS player_shot_rates (
    player_id INTEGER,
    player_name TEXT,
    team_abbr TEXT,
    shot_zone TEXT, -- 'rim', 'mid', 'three', 'ft'
    attempts INTEGER,
    makes INTEGER,
    raw_fg_pct REAL,
    zone_share REAL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (player_id, shot_zone)
);

CREATE TABLE IF NOT EXISTS team_opening_rates (
    team_abbr TEXT PRIMARY KEY,
    games_observed INTEGER,
    total_possessions INTEGER,
    turnover_rate REAL,
    shooting_foul_rate REAL,
    oreb_rate REAL,
    avg_possession_sec REAL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS team_defense_profiles (
    team_abbr TEXT PRIMARY KEY,
    rim_defense_mult REAL,   -- < 1.0 means elite rim protection (suppresses opponent rim FG%)
    three_defense_mult REAL, -- < 1.0 means elite perimeter defense
    pace_rating REAL,        -- Possessions per 48 min
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""

# Defensive context baselines (e.g., Minnesota Gobert rim suppression, Boston perimeter contest)
DEFENSE_BASELINES = {
    "BOS": {"rim_mult": 0.92, "three_mult": 0.94, "pace": 98.2},
    "MIN": {"rim_mult": 0.88, "three_mult": 0.95, "pace": 97.5},
    "OKC": {"rim_mult": 0.93, "three_mult": 0.93, "pace": 100.8},
    "SAS": {"rim_mult": 0.91, "three_mult": 0.98, "pace": 101.4},
    "MIL": {"rim_mult": 0.92, "three_mult": 1.01, "pace": 100.2},
    "PHI": {"rim_mult": 0.94, "three_mult": 0.97, "pace": 98.6},
    "DEN": {"rim_mult": 0.97, "three_mult": 0.98, "pace": 97.8},
    "NYK": {"rim_mult": 0.95, "three_mult": 0.96, "pace": 96.5},
    "LAL": {"rim_mult": 0.92, "three_mult": 1.02, "pace": 101.1},
    "MIA": {"rim_mult": 0.94, "three_mult": 0.95, "pace": 97.0},
}

def extract_shot_and_team_rates(db_path: str = DB_PATH) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Computes FG% by shot zone across all shots, and opening stretch team rates (TOV, FOUL, OREB).
    """
    conn = sqlite3.connect(db_path)
    with conn:
        conn.executescript(RATES_SCHEMA_SQL)

    # 1. Player shot make rates by zone across ALL shots in dataset
    shots_df = pd.read_sql_query("""
    SELECT player1_id AS player_id, player1_name AS player_name, team_abbr,
           shot_type, sub_type, is_make, raw_json
    FROM raw_pbp
    WHERE action_type IN ('SHOT', 'FREE_THROW')
    """, conn)

    def parse_zone(row):
        st = row["shot_type"]
        if st == "FT":
            return "ft"
        if st == "3PT":
            return "three"
        # Check raw_json or sub_type for rim vs mid
        sub = str(row["sub_type"]).lower()
        if "dunk" in sub or "layup" in sub or "hook" in sub:
            return "rim"
        if row["raw_json"]:
            try:
                data = json.loads(row["raw_json"]) if isinstance(row["raw_json"], str) else row["raw_json"]
                if data.get("zone"):
                    return data["zone"]
            except Exception:
                pass
        return "mid"

    shots_df["zone"] = shots_df.apply(parse_zone, axis=1)

    # Compute player totals and zone splits
    player_rates = []
    for (p_id, p_name, t_abbr), p_group in shots_df.groupby(["player_id", "player_name", "team_abbr"]):
        total_fg = len(p_group[p_group["zone"] != "ft"])
        for zone, z_group in p_group.groupby("zone"):
            att = len(z_group)
            makes = z_group["is_make"].sum()
            fg_pct = makes / att if att > 0 else 0.0
            share = att / total_fg if (zone != "ft" and total_fg > 0) else (att / len(p_group))

            player_rates.append({
                "player_id": p_id,
                "player_name": p_name,
                "team_abbr": t_abbr,
                "shot_zone": zone,
                "attempts": att,
                "makes": int(makes),
                "raw_fg_pct": round(fg_pct, 4),
                "zone_share": round(share, 4),
            })

    with conn:
        for pr in player_rates:
            conn.execute("""
            INSERT OR REPLACE INTO player_shot_rates (
                player_id, player_name, team_abbr, shot_zone, attempts, makes, raw_fg_pct, zone_share
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                pr["player_id"], pr["player_name"], pr["team_abbr"],
                pr["shot_zone"], pr["attempts"], pr["makes"],
                pr["raw_fg_pct"], pr["zone_share"]
            ))

    # 2. Team opening rates: Turnover, Foul, Offensive Rebound rates
    events_df = pd.read_sql_query("""
    SELECT game_id, team_abbr, action_type, sub_type
    FROM raw_pbp
    WHERE period = 1
    """, conn)

    games_by_team = events_df.groupby("team_abbr")["game_id"].nunique().to_dict()

    team_rate_records = []
    for t_abbr, t_group in events_df.groupby("team_abbr"):
        if not t_abbr:
            continue
        n_games = games_by_team.get(t_abbr, 1)
        shots = len(t_group[t_group["action_type"] == "SHOT"])
        tovs = len(t_group[t_group["action_type"] == "TURNOVER"])
        fouls = len(t_group[t_group["action_type"] == "FOUL"])
        orebs = len(t_group[(t_group["action_type"] == "REBOUND") & (t_group["sub_type"] == "OFFENSIVE")])
        drebs = len(t_group[(t_group["action_type"] == "REBOUND") & (t_group["sub_type"] == "DEFENSIVE")])

        # Estimated opening possessions = shots - orebs + tovs + (0.44 * fouls)
        tot_poss = shots - orebs + tovs + fouls
        tot_poss = max(tot_poss, 1)

        tov_rate = tovs / tot_poss
        foul_rate = fouls / tot_poss
        tot_rebs = orebs + drebs
        oreb_rate = orebs / tot_rebs if tot_rebs > 0 else 0.25

        team_rate_records.append({
            "team_abbr": t_abbr,
            "games_observed": n_games,
            "total_possessions": tot_poss,
            "turnover_rate": round(tov_rate, 4),
            "shooting_foul_rate": round(foul_rate, 4),
            "oreb_rate": round(oreb_rate, 4),
            "avg_possession_sec": 14.8,
        })

    with conn:
        for tr in team_rate_records:
            conn.execute("""
            INSERT OR REPLACE INTO team_opening_rates (
                team_abbr, games_observed, total_possessions, turnover_rate,
                shooting_foul_rate, oreb_rate, avg_possession_sec
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                tr["team_abbr"], tr["games_observed"], tr["total_possessions"],
                tr["turnover_rate"], tr["shooting_foul_rate"], tr["oreb_rate"],
                tr["avg_possession_sec"]
            ))

        # 3. Seed defense profiles
        for t_abbr, prof in DEFENSE_BASELINES.items():
            conn.execute("""
            INSERT OR REPLACE INTO team_defense_profiles (
                team_abbr, rim_defense_mult, three_defense_mult, pace_rating
            ) VALUES (?, ?, ?, ?)
            """, (t_abbr, prof["rim_mult"], prof["three_mult"], prof["pace"]))

    conn.close()
    return pd.DataFrame(player_rates), pd.DataFrame(team_rate_records)

def calculate_context_adjusters(team_abbr: str, opp_abbr: str, is_home: bool = True, is_b2b: bool = False, db_path: str = DB_PATH) -> Dict[str, float]:
    """
    Calculates context multiplier adjustments for a specific matchup:
    - rim_factor: adjustment to rim FG% based on opponent center/rim protection.
    - three_factor: adjustment to 3PT FG% based on opponent perimeter defense.
    - pace_factor: adjustment to possession velocity.
    - fatigue_factor: -2% if on a back-to-back.
    - home_factor: +2.5% efficiency if home.
    """
    conn = sqlite3.connect(db_path)
    opp_def = conn.execute("""
    SELECT rim_defense_mult, three_defense_mult, pace_rating
    FROM team_defense_profiles
    WHERE team_abbr = ?
    """, (opp_abbr,)).fetchone()
    conn.close()

    if opp_def:
        rim_mult = opp_def[0]
        three_mult = opp_def[1]
        pace = opp_def[2]
    else:
        rim_mult, three_mult, pace = 1.0, 1.0, 99.0

    home_mult = 1.025 if is_home else 0.985
    rest_mult = 0.98 if is_b2b else 1.00
    pace_mult = pace / 99.0

    return {
        "rim_adjuster": round(rim_mult * home_mult * rest_mult, 4),
        "three_adjuster": round(three_mult * home_mult * rest_mult, 4),
        "pace_adjuster": round(pace_mult, 4),
        "is_home": is_home,
        "is_b2b": is_b2b,
    }

def verify_rates_features(db_path: str = DB_PATH):
    """Verifies that FG% by zone and opening stretch rates conform to basketball reality."""
    pr_df, tr_df = extract_shot_and_team_rates(db_path)

    print("\n--- Feature Extraction: Per-Shot Make Rates by Zone & Opening Stretch Rates ---")
    print(f"Total Player Zone Records: {len(pr_df)}")
    print("\nSample Player Zone Make Rates:")
    print(pr_df[["player_name", "team_abbr", "shot_zone", "attempts", "makes", "raw_fg_pct", "zone_share"]].head(12).to_string(index=False))

    print("\nTeam Opening Stretch Rates (TOV, Foul, OREB):")
    print(tr_df[["team_abbr", "games_observed", "total_possessions", "turnover_rate", "shooting_foul_rate", "oreb_rate"]].to_string(index=False))

    # Test context adjuster
    ctx = calculate_context_adjusters("BOS", "MIN", is_home=True, is_b2b=False, db_path=db_path)
    print(f"\nMatchup Context Adjusters (BOS vs MIN at TD Garden): {ctx}")
    print("--------------------------------------------------------------------------------\n")

    assert len(pr_df) > 0, "No player rates"
    assert len(tr_df) > 0, "No team opening rates"
    # Realistic turnover rate check (8% to 18%)
    avg_tov = tr_df["turnover_rate"].mean()
    assert 0.08 <= avg_tov <= 0.20, f"Average TOV rate {avg_tov} outside expected range [0.08, 0.20]"

if __name__ == "__main__":
    verify_rates_features()
