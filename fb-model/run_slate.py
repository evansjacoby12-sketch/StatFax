"""
fb-model/run_slate.py — Tonight's Slate Execution & Ranked First-Basket Recommendations

Pulls confirmed starting lineups (~30 min before tip), runs hierarchical parameter
estimation, analytical possession chain, and 10,000-iteration Monte Carlo simulation.
Compares model fair probabilities against multi-book odds and outputs a ranked EV table.
"""

import os
import sys
import argparse
import sqlite3
import json
import numpy as np
import pandas as pd
from typing import Dict, Any, List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model.chain import solve_possession_chain
from model.hierarchical import HierarchicalShrinkageModel
from sim.simulate import run_first_basket_simulation
from ingest.lineups import get_confirmed_starters, SLATE_STARTERS
from ingest.odds import devig_market

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "fb_database.sqlite")

# Tonight's live 2026-27 NBA slate chronologically ordered by tip-off time
TONIGHT_MATCHUPS = [
    {
        "game_id": "401909893",
        "home": "ATL", "away": "CLE",
        "game_time": "8:00 PM ET",
        "tip_order": 1,
        "home_jumper_id": 4431680, "away_jumper_id": 4066328, # Onyeka Okongwu vs Jarrett Allen
        "reach_diff_home": -2.0,
    },
    {
        "game_id": "401909894",
        "home": "NOP", "away": "SAC",
        "game_time": "8:00 PM ET",
        "tip_order": 2,
        "home_jumper_id": 3442, "away_jumper_id": 3155942, # DeAndre Jordan vs Domantas Sabonis
        "reach_diff_home": +4.0,
    },
    {
        "game_id": "401909895",
        "home": "POR", "away": "MEM",
        "game_time": "10:00 PM ET",
        "tip_order": 3,
        "home_jumper_id": 5105565, "away_jumper_id": 4600663, # Donovan Clingan vs Zach Edey
        "reach_diff_home": -4.0,
    },
]

def american_to_implied(odds: int) -> float:
    return 100.0 / (odds + 100.0) if odds > 0 else abs(odds) / (abs(odds) + 100.0)

def calculate_quarter_kelly(fair_prob: float, offered_odds: int, bankroll: float = 1000.0) -> float:
    """Calculates Quarter-Kelly bet recommendation in dollars."""
    if offered_odds <= 0:
        return 0.0
    b = offered_odds / 100.0
    p = fair_prob
    q = 1.0 - p
    f_star = (b * p - q) / b
    if f_star <= 0:
        return 0.0
    # Quarter Kelly
    stake_frac = min(f_star * 0.25, 0.05) # Cap at 5% bankroll
    return round(bankroll * stake_frac, 2)

def run_slate(settlement_rule: str = "FIRST_FIELD_GOAL", n_sims: int = 10000, bankroll: float = 1000.0, top_per_game: int = 3, nop_center: str = "missi", db_path: str = DB_PATH, **kwargs) -> List[Dict[str, Any]]:
    """
    Evaluates tonight's slate and returns ranked list of first basket opportunities.
    """
    hier_model = HierarchicalShrinkageModel(db_path=db_path)
    all_slate_picks = []

    print(f"\n==========================================================================================")
    print(f"       STATFAX NBA FIRST BASKET MODEL -- TONIGHT'S SLATE ANALYSIS ({settlement_rule})     ")
    print(f"==========================================================================================")

    matchups = []
    for m in TONIGHT_MATCHUPS:
        m_copy = dict(m)
        if m_copy["home"] == "NOP":
            if nop_center == "jordan":
                m_copy["home_jumper_id"] = 3442
                m_copy["reach_diff_home"] = +4.0
            else:
                m_copy["home_jumper_id"] = 5061589
                m_copy["reach_diff_home"] = +5.0
        matchups.append(m_copy)

    for match in matchups:
        g_id = match["game_id"]
        h_team = match["home"]
        a_team = match["away"]
        reach = match["reach_diff_home"]
        g_time = match.get("game_time", "TBD")
        tip_order = match.get("tip_order", 99)

        # Fetch confirmed starters
        h_starters_df = get_confirmed_starters(g_id, db_path)
        if len(h_starters_df) < 5 and h_team in SLATE_STARTERS:
            h_pids = [p["id"] for p in SLATE_STARTERS[h_team]]
        else:
            h_pids = h_starters_df[h_starters_df["team_abbr"] == h_team]["player_id"].tolist()[:5]

        a_starters_df = get_confirmed_starters(g_id, db_path)
        if len(a_starters_df) < 5 and a_team in SLATE_STARTERS:
            a_pids = [p["id"] for p in SLATE_STARTERS[a_team]]
        else:
            a_pids = a_starters_df[a_starters_df["team_abbr"] == a_team]["player_id"].tolist()[:5]

        # 1. Analytical Chain with Bradley-Terry jump matchup
        p_tip_home, _, _ = hier_model.predict_jump_matchup(match["home_jumper_id"], match["away_jumper_id"], reach_diff_home=reach)
        h_shares, _ = hier_model.get_shrunk_shot_shares_posterior(h_team, h_pids)
        a_shares, _ = hier_model.get_shrunk_shot_shares_posterior(a_team, a_pids)
        h_rates = hier_model.get_shrunk_team_rates(h_team)
        a_rates = hier_model.get_shrunk_team_rates(a_team)

        def build_side(team_abbr, pids, shares, tr):
            plist = []
            for idx, pid in enumerate(pids):
                row = hier_model.conn.execute("SELECT player_name FROM player_early_shot_shares WHERE player_id = ?", (pid,)).fetchone()
                pname = row["player_name"] if row else f"Player_{pid}"
                r_p, _, _ = hier_model.get_shrunk_make_rate_posterior(pid, "rim")
                m_p, _, _ = hier_model.get_shrunk_make_rate_posterior(pid, "mid")
                t_p, _, _ = hier_model.get_shrunk_make_rate_posterior(pid, "three")
                ft_p, _, _ = hier_model.get_shrunk_make_rate_posterior(pid, "ft")
                plist.append({
                    "id": pid, "name": pname, "shot_share": float(shares[idx]),
                    "zone_weights": {"rim": 0.42, "mid": 0.18, "three": 0.40},
                    "make_rates": {"rim": r_p, "mid": m_p, "three": t_p, "ft": ft_p}
                })
            return {"abbr": team_abbr, "turnover_rate": tr["turnover_rate"], "foul_rate": tr["foul_rate"], "oreb_rate": tr["oreb_rate"], "players": plist}

        home_data = build_side(h_team, h_pids, h_shares, h_rates)
        away_data = build_side(a_team, a_pids, a_shares, a_rates)

        chain_res = solve_possession_chain(home_data, away_data, p_tip_home=p_tip_home, settlement_rule=settlement_rule)

        # 2. Monte Carlo Simulation with Parameter Posterior Sampling
        sim_res = run_first_basket_simulation(
            home_abbr=h_team,
            away_abbr=a_team,
            home_jumper_id=match["home_jumper_id"],
            away_jumper_id=match["away_jumper_id"],
            home_starter_ids=h_pids,
            away_starter_ids=a_pids,
            reach_diff_home=reach,
            settlement_rule=settlement_rule,
            n_sims=n_sims,
            db_path=db_path
        )
        sim_map = {p["player_id"]: p for p in sim_res["players"]}

        # 3. Market Odds & Value Calculation for this Game
        game_picks = []
        for p in chain_res["players"]:
            pid = p["player_id"]
            sim_info = sim_map.get(pid, {})
            model_prob = p["fair_probability"]
            sim_prob = sim_info.get("sim_win_rate", model_prob)
            ci_low = sim_info.get("ci_90_lower", model_prob * 0.85)
            ci_high = sim_info.get("ci_90_upper", model_prob * 1.15)

            # Benchmark market odds (using DraftKings sample prices or fair equivalent)
            mkt_row = hier_model.conn.execute("""
            SELECT american_odds, devigged_prob FROM market_odds
            WHERE player_id = ? AND sportsbook = 'DraftKings'
            """, (pid,)).fetchone()

            if mkt_row:
                mkt_odds = mkt_row["american_odds"]
                mkt_devig = mkt_row["devigged_prob"]
            else:
                fair_odds = p["fair_american_odds"]
                mkt_odds = int(round(fair_odds * 0.82)) if fair_odds > 0 else fair_odds
                mkt_devig = model_prob

            mkt_implied = american_to_implied(mkt_odds)
            edge = model_prob - mkt_implied
            ev_pct = ((model_prob * (mkt_odds / 100.0) - (1.0 - model_prob)) * 100.0) if mkt_odds > 0 else 0.0
            kelly_stake = calculate_quarter_kelly(model_prob, mkt_odds, bankroll)

            game_picks.append({
                "game": f"{a_team} @ {h_team}",
                "game_time": g_time,
                "tip_order": tip_order,
                "player_name": str(p["player_name"]),
                "team": str(p["team_abbr"]),
                "model_prob_pct": float(round(model_prob * 100.0, 2)),
                "sim_prob_pct": float(round(sim_prob * 100.0, 2)),
                "ci_90": f"[{ci_low * 100:.1f}%, {ci_high * 100:.1f}%]",
                "fair_odds": f"+{p['fair_american_odds']}" if p["fair_american_odds"] > 0 else str(p["fair_american_odds"]),
                "market_odds": f"+{mkt_odds}" if mkt_odds > 0 else str(mkt_odds),
                "edge_pct": float(round(edge * 100.0, 2)),
                "ev_pct": float(round(ev_pct, 2)),
                "quarter_kelly_bet": f"${kelly_stake:.2f}",
                "is_recommended": bool(edge >= 0.015 and ev_pct > 0),
            })

        # Rank starters within this game by model probability
        game_picks.sort(key=lambda x: x["model_prob_pct"], reverse=True)
        for rank_idx, pick in enumerate(game_picks, start=1):
            pick["game_rank"] = rank_idx
            pick["is_top3_in_game"] = (rank_idx <= 3)

        all_slate_picks.extend(game_picks)

    hier_model.close()

    # Sort all picks chronologically by game tip_order, then by game_rank
    all_slate_picks.sort(key=lambda x: (x["tip_order"], x["game_rank"]))

    # Filtered Top Picks per game (Default: Top 3 to eliminate clutter)
    top_per_game_picks = [p for p in all_slate_picks if p["game_rank"] <= top_per_game]
    df_top = pd.DataFrame(top_per_game_picks)

    print(f"\n==========================================================================================")
    print(f"       TOP {top_per_game} PICKS PER GAME (CHRONOLOGICAL BY TIP-OFF TIME -- CLEAN VIEW)      ")
    print(f"==========================================================================================")
    print(df_top[["game_time", "game", "game_rank", "player_name", "team", "model_prob_pct", "ci_90", "fair_odds", "market_odds", "edge_pct", "quarter_kelly_bet"]].to_string(index=False))
    print("==========================================================================================\n")

    # Export to JSON
    out_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "slate_picks.json")
    with open(out_file, "w") as f:
        json.dump(all_slate_picks, f, indent=2)
    print(f"[run_slate.py] Saved {len(all_slate_picks)} total slate projections to {out_file}")

    return all_slate_picks

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run NBA First Basket Model on Tonight's Slate")
    parser.add_argument("--settlement", choices=["FIRST_FIELD_GOAL", "FIRST_POINT_SCORED"], default="FIRST_FIELD_GOAL", help="Sportsbook settlement rule")
    parser.add_argument("--sims", type=int, default=10000, help="Monte Carlo simulation iterations")
    parser.add_argument("--bankroll", type=float, default=1000.0, help="Bankroll for Quarter-Kelly sizing")
    parser.add_argument("--top", type=int, default=3, help="Top N picks per game to display (default: 3)")
    parser.add_argument("--nop-center", choices=["missi", "jordan"], default="missi", help="Starting center for New Orleans (default: missi)")
    args = parser.parse_args()

    run_slate(settlement_rule=args.settlement, n_sims=args.sims, bankroll=args.bankroll, top_per_game=args.top, nop_center=args.nop_center)
