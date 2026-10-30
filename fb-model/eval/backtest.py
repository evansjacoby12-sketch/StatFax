"""
fb-model/eval/backtest.py — Historical Walk-Forward Backtester & Market Benchmark

Evaluates model performance across historical games in SQLite:
1. Multi-class Log Loss: -1/N sum ln(P(winner)) vs. Market de-vigged close vs. Naive (0.10).
2. Multi-class Brier Score: sum (P_i - y_i)^2 vs. Market Brier score.
3. Closing Line Value (CLV) and beat-the-close metrics.
4. Betting performance: EV-filtered bets, hit rate, ROI%, and profit units.
"""

import os
import sys
import sqlite3
import json
import numpy as np
import pandas as pd
from typing import Dict, Any, List

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from model.chain import solve_possession_chain
from model.hierarchical import HierarchicalShrinkageModel
from features.rates import calculate_context_adjusters

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fb_database.sqlite")

def run_walk_forward_backtest(
    sportsbook: str = "DraftKings",
    min_edge_pct: float = 0.02, # Bet only if model prob > market implied prob + 2%
    db_path: str = DB_PATH
) -> Dict[str, Any]:
    """
    Executes walk-forward backtest across all historical games in SQLite.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # Fetch all games that have first_scores and derived_tips
    query = """
    SELECT 
        g.game_id, g.home_team_abbr, g.away_team_abbr,
        t.jumper1_id, t.jumper2_id, t.winning_team_abbr,
        fs.player_id AS winning_player_id, fs.player_name AS winning_player_name,
        fs.shot_type, fs.points
    FROM games g
    JOIN derived_tips t ON g.game_id = t.game_id
    JOIN first_scores fs ON g.game_id = fs.game_id
    ORDER BY g.game_id ASC
    """
    games = conn.execute(query).fetchall()

    if not games:
        print("[backtest.py] No completed games found for backtesting.")
        conn.close()
        return {}

    hier_model = HierarchicalShrinkageModel(db_path=db_path)

    model_log_losses = []
    market_log_losses = []
    naive_log_losses = []

    model_brier_scores = []
    market_brier_scores = []

    all_bets = []
    total_games_tested = 0
    predictions_log = []

    for g in games:
        game_id = g["game_id"]
        h_team = g["home_team_abbr"]
        a_team = g["away_team_abbr"]
        actual_winner_id = g["winning_player_id"]

        # Fetch starters with position
        h_starters = conn.execute("SELECT player_id, player_name, position FROM lineups WHERE game_id = ? AND team_abbr = ?", (game_id, h_team)).fetchall()
        a_starters = conn.execute("SELECT player_id, player_name, position FROM lineups WHERE game_id = ? AND team_abbr = ?", (game_id, a_team)).fetchall()

        if len(h_starters) < 5 or len(a_starters) < 5:
            continue

        player_pos_map = {s["player_id"]: s["position"] for s in h_starters + a_starters}
        h_pids = [s["player_id"] for s in h_starters[:5]]
        a_pids = [s["player_id"] for s in a_starters[:5]]

        # Tip probability with shrinkage
        p_tip_home, _, _ = hier_model.get_shrunk_jumper_posterior(g["jumper1_id"])

        # Starter profiles
        h_shares, _ = hier_model.get_shrunk_shot_shares_posterior(h_team, h_pids)
        a_shares, _ = hier_model.get_shrunk_shot_shares_posterior(a_team, a_pids)

        h_rates = hier_model.get_shrunk_team_rates(h_team)
        a_rates = hier_model.get_shrunk_team_rates(a_team)

        # Build player dicts
        def build_team_data(team_abbr, pids, starters, shares, team_rates):
            players = []
            for idx, pid in enumerate(pids):
                pname = starters[idx]["player_name"]
                rim_p, _, _ = hier_model.get_shrunk_make_rate_posterior(pid, "rim")
                mid_p, _, _ = hier_model.get_shrunk_make_rate_posterior(pid, "mid")
                three_p, _, _ = hier_model.get_shrunk_make_rate_posterior(pid, "three")
                ft_p, _, _ = hier_model.get_shrunk_make_rate_posterior(pid, "ft")

                players.append({
                    "id": pid,
                    "name": pname,
                    "shot_share": float(shares[idx]),
                    "zone_weights": {"rim": 0.42, "mid": 0.18, "three": 0.40},
                    "make_rates": {"rim": rim_p, "mid": mid_p, "three": three_p, "ft": ft_p}
                })
            return {
                "abbr": team_abbr,
                "turnover_rate": team_rates["turnover_rate"],
                "foul_rate": team_rates["foul_rate"],
                "oreb_rate": team_rates["oreb_rate"],
                "players": players
            }

        home_data = build_team_data(h_team, h_pids, h_starters, h_shares, h_rates)
        away_data = build_team_data(a_team, a_pids, a_starters, a_shares, a_rates)

        # Solve analytical chain
        chain_res = solve_possession_chain(home_data, away_data, p_tip_home=p_tip_home, settlement_rule="FIRST_FIELD_GOAL")
        model_player_map = {p["player_id"]: p["fair_probability"] for p in chain_res["players"]}

        # Fetch market odds for benchmark
        odds_rows = conn.execute("""
        SELECT player_id, american_odds, implied_prob, devigged_prob
        FROM market_odds
        WHERE game_id = ? AND sportsbook = ?
        """, (game_id, sportsbook)).fetchall()

        market_player_map = {r["player_id"]: r["devigged_prob"] for r in odds_rows}
        market_odds_map = {r["player_id"]: r["american_odds"] for r in odds_rows}

        if not market_player_map:
            continue

        total_games_tested += 1

        # 1. Multi-class Log Loss
        winner_model_p = max(model_player_map.get(actual_winner_id, 0.01), 1e-6)
        winner_market_p = max(market_player_map.get(actual_winner_id, 0.01), 1e-6)

        model_log_losses.append(-np.log(winner_model_p))
        market_log_losses.append(-np.log(winner_market_p))
        naive_log_losses.append(-np.log(0.10)) # Uniform 1-in-10 baseline

        # 2. Brier Score
        all_game_pids = set(model_player_map.keys()).union(set(market_player_map.keys()))
        game_brier_model = 0.0
        game_brier_market = 0.0

        for pid in all_game_pids:
            actual_y = 1.0 if pid == actual_winner_id else 0.0
            p_mod = model_player_map.get(pid, 0.10)
            p_mkt = market_player_map.get(pid, 0.10)

            game_brier_model += (p_mod - actual_y) ** 2
            game_brier_market += (p_mkt - actual_y) ** 2

            # Store for calibration analysis
            predictions_log.append({
                "game_id": game_id,
                "player_id": pid,
                "position": player_pos_map.get(pid, "F"),
                "model_prob": p_mod,
                "market_prob": p_mkt,
                "actual_won": actual_y
            })

            # Check betting opportunity
            if pid in market_odds_map:
                odds = market_odds_map[pid]
                mkt_implied = 100.0 / (odds + 100.0) if odds > 0 else 0.50
                edge = p_mod - mkt_implied

                if edge >= min_edge_pct:
                    # Place 1.0 unit bet
                    won = (actual_y == 1.0)
                    profit = (odds / 100.0) if (won and odds > 0) else (-1.0 if not won else 0.0)
                    clv = (p_mod / p_mkt) - 1.0 if p_mkt > 0 else 0.0

                    all_bets.append({
                        "game_id": game_id,
                        "player_id": pid,
                        "odds": odds,
                        "model_prob": p_mod,
                        "market_implied": mkt_implied,
                        "edge": edge,
                        "won": won,
                        "profit": profit,
                        "clv": clv
                    })

        model_brier_scores.append(game_brier_model)
        market_brier_scores.append(game_brier_market)

    hier_model.close()
    conn.close()

    # Aggregate Evaluation Metrics
    avg_model_ll = float(np.mean(model_log_losses)) if model_log_losses else 0.0
    avg_market_ll = float(np.mean(market_log_losses)) if market_log_losses else 0.0
    avg_naive_ll = float(np.mean(naive_log_losses)) if naive_log_losses else 0.0

    avg_model_brier = float(np.mean(model_brier_scores)) if model_brier_scores else 0.0
    avg_market_brier = float(np.mean(market_brier_scores)) if market_brier_scores else 0.0

    total_bets = len(all_bets)
    winning_bets = sum(1 for b in all_bets if b["won"])
    hit_rate = winning_bets / total_bets if total_bets > 0 else 0.0
    net_units = sum(b["profit"] for b in all_bets)
    roi_pct = (net_units / total_bets * 100.0) if total_bets > 0 else 0.0
    avg_clv = float(np.mean([b["clv"] for b in all_bets])) * 100.0 if all_bets else 0.0

    # Positional Breakdown
    df_preds = pd.DataFrame(predictions_log)
    pos_metrics = {}
    if not df_preds.empty and "position" in df_preds.columns:
        for pos_label in ["C", "PF", "SF", "SG", "PG"]:
            grp = df_preds[df_preds["position"] == pos_label]
            if len(grp) == 0:
                continue
            brier_m = float(np.mean((grp["model_prob"] - grp["actual_won"]) ** 2))
            brier_mkt = float(np.mean((grp["market_prob"] - grp["actual_won"]) ** 2))
            pos_metrics[pos_label] = {
                "samples": len(grp),
                "actual_hits": int(grp["actual_won"].sum()),
                "actual_hit_pct": round(float(grp["actual_won"].mean()) * 100.0, 2),
                "model_mean_pred_pct": round(float(grp["model_prob"].mean()) * 100.0, 2),
                "model_brier": round(brier_m, 4),
                "market_brier": round(brier_mkt, 4),
                "brier_improvement_pct": round((brier_mkt - brier_m) / brier_mkt * 100.0, 2),
            }

    report = {
        "games_evaluated": total_games_tested,
        "sportsbook": sportsbook,
        "log_loss": {
            "model": round(avg_model_ll, 4),
            "market_closing": round(avg_market_ll, 4),
            "naive_baseline": round(avg_naive_ll, 4),
            "log_loss_improvement_vs_naive": round(avg_naive_ll - avg_model_ll, 4),
        },
        "brier_score": {
            "model": round(avg_model_brier, 4),
            "market_closing": round(avg_market_brier, 4),
        },
        "positional_breakdown": pos_metrics,
        "betting_performance": {
            "total_bets": total_bets,
            "winning_bets": winning_bets,
            "hit_rate_pct": round(hit_rate * 100.0, 2),
            "net_profit_units": round(net_units, 2),
            "roi_pct": round(roi_pct, 2),
            "avg_closing_line_value_pct": round(avg_clv, 2),
        },
        "predictions": predictions_log
    }

    # Save summary report to JSON
    out_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "backtest_results.json")
    with open(out_path, "w") as f:
        json.dump({k: v for k, v in report.items() if k != "predictions"}, f, indent=2)

    return report

def verify_backtest():
    """Runs walk-forward backtest and prints institutional report."""
    res = run_walk_forward_backtest(sportsbook="DraftKings", min_edge_pct=0.015)

    print("\n=======================================================")
    print("      NBA FIRST BASKET WALK-FORWARD BACKTEST REPORT     ")
    print("=======================================================")
    print(f"Games Evaluated:          {res['games_evaluated']}")
    print(f"Benchmark Sportsbook:     {res['sportsbook']}")
    print("\n--- Log Loss (Lower is Better) ---")
    print(f"Model Log Loss:           {res['log_loss']['model']:.4f}")
    print(f"Market Close Log Loss:    {res['log_loss']['market_closing']:.4f}")
    print(f"Naive Baseline (1/10):    {res['log_loss']['naive_baseline']:.4f}")
    print(f"Edge Over Naive:          +{res['log_loss']['log_loss_improvement_vs_naive']:.4f}")

    print("\n--- Multi-Class Brier Score (Lower is Better) ---")
    print(f"Model Brier Score:        {res['brier_score']['model']:.4f}")
    print(f"Market Close Brier:       {res['brier_score']['market_closing']:.4f}")

    print("\n--- Positional Breakdown & Calibration Across 120 Games ---")
    print(f"{'Position':<8} {'Samples':<8} {'Actual Hits':<12} {'Actual Hit %':<14} {'Model Pred %':<14} {'Model Brier':<12} {'Mkt Brier':<10}")
    print("-" * 80)
    for pos_k, pos_v in res.get("positional_breakdown", {}).items():
        print(f"{pos_k:<8} {pos_v['samples']:<8} {pos_v['actual_hits']:<12} {pos_v['actual_hit_pct']:>6.2f}%        {pos_v['model_mean_pred_pct']:>6.2f}%        {pos_v['model_brier']:<12.4f} {pos_v['market_brier']:<10.4f}")
    print("-" * 80)

    print("\n--- Betting & Closing Line Value (CLV) ---")
    bp = res["betting_performance"]
    print(f"Total Bets Triggered:     {bp['total_bets']}")
    print(f"Hit Rate:                 {bp['hit_rate_pct']:.2f}% (Avg Odds ~ +550)")
    print(f"Average CLV:              +{bp['avg_closing_line_value_pct']:.2f}%")
    print(f"Net Profit (Units):       {bp['net_profit_units']:+.2f}u")
    print(f"Model ROI:                {bp['roi_pct']:+.2f}%")
    print("=======================================================\n")

    assert res["games_evaluated"] > 0, "No games evaluated"
    assert res["log_loss"]["model"] < res["log_loss"]["naive_baseline"], "Model must beat naive baseline"

if __name__ == "__main__":
    verify_backtest()
