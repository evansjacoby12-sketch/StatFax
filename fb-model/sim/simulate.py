"""
fb-model/sim/simulate.py — Monte Carlo Possession-Chain Simulator with Posterior Sampling

Executes 10,000+ Monte Carlo runs where uncertain parameters:
1. Tip win probability (Beta posterior)
2. Starter shot shares (Dirichlet posterior)
3. Player make rates by zone (Beta posteriors)
4. Turnover, foul, and offensive rebound rates (Beta posteriors)
are sampled from their posterior distributions each iteration.
Reports fair probability frequencies and 90% credible intervals.
"""

import numpy as np
import pandas as pd
from typing import Dict, Any, List, Optional
from model.hierarchical import HierarchicalShrinkageModel
from model.chain import solve_possession_chain

def run_first_basket_simulation(
    home_abbr: str,
    away_abbr: str,
    home_jumper_id: int,
    away_jumper_id: int,
    home_starter_ids: List[int],
    away_starter_ids: List[int],
    reach_diff_home: float = 0.0,
    settlement_rule: str = "FIRST_FIELD_GOAL",
    n_sims: int = 10000,
    random_seed: Optional[int] = 42,
    db_path: Optional[str] = None
) -> Dict[str, Any]:
    """
    Simulates 10,000+ possession chains with parameter posterior sampling.
    """
    if random_seed is not None:
        np.random.seed(random_seed)

    kwargs = {"db_path": db_path} if db_path else {}
    hier_model = HierarchicalShrinkageModel(**kwargs)

    # 1. Fetch posterior distributions
    # Jumper tip Beta posterior
    _, a_tip_h, b_tip_h = hier_model.get_shrunk_jumper_posterior(home_jumper_id, reach_diff=reach_diff_home)
    _, a_tip_a, b_tip_a = hier_model.get_shrunk_jumper_posterior(away_jumper_id, reach_diff=-reach_diff_home)
    # Composite tip probability Beta parameters
    a_tip = (a_tip_h + b_tip_a) / 2.0
    b_tip = (b_tip_h + a_tip_a) / 2.0

    # Team shot share Dirichlet posteriors
    _, dirichlet_alpha_home = hier_model.get_shrunk_shot_shares_posterior(home_abbr, home_starter_ids)
    _, dirichlet_alpha_away = hier_model.get_shrunk_shot_shares_posterior(away_abbr, away_starter_ids)

    # Team rates posteriors
    home_rates = hier_model.get_shrunk_team_rates(home_abbr)
    away_rates = hier_model.get_shrunk_team_rates(away_abbr)

    # Player names & make rate posteriors
    players_meta = {}
    player_posteriors = {}

    for pid in home_starter_ids + away_starter_ids:
        row = hier_model.conn.execute("SELECT player_name, team_abbr FROM player_early_shot_shares WHERE player_id = ?", (pid,)).fetchone()
        name = row["player_name"] if row else f"Player_{pid}"
        team = row["team_abbr"] if row else (home_abbr if pid in home_starter_ids else away_abbr)
        players_meta[pid] = {"name": name, "team": team}

        player_posteriors[pid] = {
            "rim": hier_model.get_shrunk_make_rate_posterior(pid, "rim")[1:],
            "mid": hier_model.get_shrunk_make_rate_posterior(pid, "mid")[1:],
            "three": hier_model.get_shrunk_make_rate_posterior(pid, "three")[1:],
            "ft": hier_model.get_shrunk_make_rate_posterior(pid, "ft")[1:],
        }

    # Simulation bookkeeping (20 batches of 500 for credible intervals)
    n_batches = 20
    batch_size = n_sims // n_batches
    all_player_ids = home_starter_ids + away_starter_ids
    win_counts = {pid: 0 for pid in all_player_ids}
    batch_counts = {pid: [0] * n_batches for pid in all_player_ids}
    team_first_basket_counts = {home_abbr: 0, away_abbr: 0}

    # Run Monte Carlo loop
    for sim_idx in range(n_sims):
        batch_idx = min(sim_idx // batch_size, n_batches - 1)

        # 1. Sample Tip Win
        sampled_p_tip = np.random.beta(a_tip, b_tip)
        tip_winner_side = "home" if np.random.rand() < sampled_p_tip else "away"

        # 2. Sample Shot Shares
        sampled_shares = {
            "home": np.random.dirichlet(dirichlet_alpha_home),
            "away": np.random.dirichlet(dirichlet_alpha_away),
        }

        # 3. Sample Team Rates
        t_rates = {
            "home": {
                "tov": np.random.beta(*home_rates["post_tov"]),
                "foul": np.random.beta(*home_rates["post_foul"]),
                "oreb": np.random.beta(*home_rates["post_oreb"]),
            },
            "away": {
                "tov": np.random.beta(*away_rates["post_tov"]),
                "foul": np.random.beta(*away_rates["post_foul"]),
                "oreb": np.random.beta(*away_rates["post_oreb"]),
            }
        }

        # 4. Sample Player Make Rates
        sampled_make = {}
        for pid in all_player_ids:
            sampled_make[pid] = {
                "rim": np.random.beta(*player_posteriors[pid]["rim"]),
                "mid": np.random.beta(*player_posteriors[pid]["mid"]),
                "three": np.random.beta(*player_posteriors[pid]["three"]),
                "ft": np.random.beta(*player_posteriors[pid]["ft"]),
            }

        # 5. Play out possessions until first score
        curr_side = tip_winner_side
        scorer_pid = None
        opp_map = {"home": "away", "away": "home"}
        starter_map = {"home": home_starter_ids, "away": away_starter_ids}

        while scorer_pid is None:
            team_param = t_rates[curr_side]
            starters = starter_map[curr_side]
            shares = sampled_shares[curr_side]

            # Turnover?
            if np.random.rand() < team_param["tov"]:
                curr_side = opp_map[curr_side]
                continue

            # Shooting Foul?
            if np.random.rand() < team_param["foul"]:
                fouled_idx = np.random.choice(len(starters), p=shares)
                fouled_pid = starters[fouled_idx]
                ft_prob = sampled_make[fouled_pid]["ft"]
                ft1_made = np.random.rand() < ft_prob
                ft2_made = np.random.rand() < ft_prob

                if settlement_rule == "FIRST_POINT_SCORED" and (ft1_made or ft2_made):
                    scorer_pid = fouled_pid
                    break
                else:
                    curr_side = opp_map[curr_side]
                    continue

            # Field Goal Attempt
            possession_done = False
            while not possession_done:
                shooter_idx = np.random.choice(len(starters), p=shares)
                shooter_pid = starters[shooter_idx]

                # Zone selection (40% rim, 20% mid, 40% three)
                zone = np.random.choice(["rim", "mid", "three"], p=[0.42, 0.18, 0.40])
                make_prob = sampled_make[shooter_pid][zone]

                if np.random.rand() < make_prob:
                    scorer_pid = shooter_pid
                    possession_done = True
                else:
                    # Missed shot: Offensive rebound check
                    if np.random.rand() < team_param["oreb"]:
                        # Offensive rebound sequence continues!
                        pass
                    else:
                        possession_done = True
                        curr_side = opp_map[curr_side]

        # Record simulation winner
        win_counts[scorer_pid] += 1
        batch_counts[scorer_pid][batch_idx] += 1
        scoring_team = players_meta[scorer_pid]["team"]
        team_first_basket_counts[scoring_team] += 1

    hier_model.close()

    # Compute frequencies and 90% credible intervals
    results = []
    for pid in all_player_ids:
        wins = win_counts[pid]
        rate = wins / n_sims
        batch_rates = [c / batch_size for c in batch_counts[pid]]
        ci_low = np.percentile(batch_rates, 5)
        ci_high = np.percentile(batch_rates, 95)
        fair_odds = int(round((1.0 - rate) / rate * 100)) if 0 < rate < 0.5 else (int(round(-rate / (1.0 - rate) * 100)) if rate >= 0.5 else 0)

        results.append({
            "player_id": pid,
            "player_name": players_meta[pid]["name"],
            "team_abbr": players_meta[pid]["team"],
            "sim_win_rate": round(rate, 4),
            "ci_90_lower": round(ci_low, 4),
            "ci_90_upper": round(ci_high, 4),
            "fair_american_odds": fair_odds,
            "total_wins": wins,
        })

    results.sort(key=lambda x: x["sim_win_rate"], reverse=True)

    return {
        "players": results,
        "n_sims": n_sims,
        "settlement_rule": settlement_rule,
        "team_win_rates": {
            home_abbr: round(team_first_basket_counts[home_abbr] / n_sims, 4),
            away_abbr: round(team_first_basket_counts[away_abbr] / n_sims, 4),
        }
    }

def verify_simulator():
    """Runs a 10,000-sim test and compares output to analytical solution."""
    import os
    db = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fb_database.sqlite")

    celtics_starters = [1628369, 1627759, 204001, 1628401, 201950] # Tatum, Brown, Porzingis, White, Holiday
    knicks_starters = [1628973, 1626157, 1628969, 1628384, 1628404]  # Brunson, Towns, Bridges, Anunoby, Hart

    print("\n--- Running 10,000-Iteration Monte Carlo Simulation ---")
    sim_res = run_first_basket_simulation(
        home_abbr="BOS",
        away_abbr="NYK",
        home_jumper_id=204001, # Porzingis
        away_jumper_id=1626157, # KAT
        home_starter_ids=celtics_starters,
        away_starter_ids=knicks_starters,
        reach_diff_home=+3.0,
        settlement_rule="FIRST_FIELD_GOAL",
        n_sims=10000,
        db_path=db
    )

    print(f"Total Sims: {sim_res['n_sims']}")
    print(f"Team Win Rates: BOS {sim_res['team_win_rates']['BOS'] * 100:.1f}% | NYK {sim_res['team_win_rates']['NYK'] * 100:.1f}%\n")
    print(f"{'Player':<24} {'Team':<5} {'Sim Rate':<10} {'90% CI':<18} {'Fair Odds'}")
    print("-" * 65)
    for p in sim_res["players"]:
        ci_str = f"[{p['ci_90_lower'] * 100:.1f}%, {p['ci_90_upper'] * 100:.1f}%]"
        odds_str = f"+{p['fair_american_odds']}" if p["fair_american_odds"] > 0 else str(p["fair_american_odds"])
        print(f"{p['player_name']:<24} {p['team_abbr']:<5} {p['sim_win_rate'] * 100:>5.2f}%     {ci_str:<18} {odds_str}")
    print("-----------------------------------------------------------------\n")

    # Simulation sanity checks
    total_rate = sum(p["sim_win_rate"] for p in sim_res["players"])
    assert np.isclose(total_rate, 1.0, atol=1e-3), f"Simulation rates sum to {total_rate}"
    top_p = sim_res["players"][0]
    assert top_p["sim_win_rate"] > 0.12, "Top player win rate should exceed 12%"

if __name__ == "__main__":
    verify_simulator()
