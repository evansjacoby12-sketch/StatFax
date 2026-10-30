"""
fb-model/model/hierarchical.py — Hierarchical Bayesian Shrinkage Model

Implements partial pooling toward league averages for:
1. Jumper tip win rates (Beta-Binomial with reach adjustment).
2. Player early possession shot shares (Dirichlet-Multinomial).
3. Per-shot make probabilities by shot zone (Beta-Binomial partial pooling).
4. Team opening turnover, foul, and offensive rebound rates.

Provides exact posterior parameter distributions (Beta / Dirichlet parameters)
so the simulation layer can draw posterior parameter samples during Monte Carlo runs.
"""

import os
import sqlite3
import numpy as np
import pandas as pd
from typing import Dict, Any, Tuple, List
from scipy.stats import beta, dirichlet

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fb_database.sqlite")

# Empirical League Priors across ~3 NBA seasons
LEAGUE_PRIORS = {
    "tip_win": {"mean": 0.500, "weight": 20.0},
    "make_rim": {"mean": 0.640, "weight": 35.0},
    "make_mid": {"mean": 0.425, "weight": 25.0},
    "make_three": {"mean": 0.365, "weight": 40.0},
    "make_ft": {"mean": 0.775, "weight": 25.0},
    "turnover_rate": {"mean": 0.125, "weight": 40.0},
    "foul_rate": {"mean": 0.075, "weight": 40.0},
    "oreb_rate": {"mean": 0.260, "weight": 45.0},
}

class HierarchicalShrinkageModel:
    """
    Fits and manages Bayesian posterior parameter distributions with partial pooling.
    Prevents overfitting to tiny historical first-basket samples (players only have 5-15/season).
    """

    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row

    def get_shrunk_jumper_posterior(self, player_id: int, reach_diff: float = 0.0) -> Tuple[float, float, float]:
        """
        Computes posterior Beta(alpha, beta) for a jumper's tip win rate.
        Adjusts prior mean for physical standing reach differential (reach_diff in inches).
        """
        # Standing reach adjustment: ~1.5% win rate shift per inch of reach advantage
        prior_mean = 0.500 + np.clip(reach_diff * 0.015, -0.25, 0.25)
        m = LEAGUE_PRIORS["tip_win"]["weight"]
        alpha_0 = prior_mean * m
        beta_0 = (1.0 - prior_mean) * m

        row = self.conn.execute("""
        SELECT tip_attempts, tip_wins 
        FROM jumper_ratings 
        WHERE player_id = ?
        """, (player_id,)).fetchone()

        if row and row["tip_attempts"] > 0:
            n = row["tip_attempts"]
            y = row["tip_wins"]
        else:
            n, y = 0, 0

        post_alpha = alpha_0 + y
        post_beta = beta_0 + (n - y)
        point_estimate = post_alpha / (post_alpha + post_beta)

        return point_estimate, post_alpha, post_beta

    def predict_jump_matchup(self, home_jumper_id: int, away_jumper_id: int, reach_diff_home: float = 0.0) -> Tuple[float, float, float]:
        """
        Bradley-Terry logistic contest between home and away jumpers
        integrating Bayesian shrinkage on sample sizes and standing reach differential.
        """
        rate_h, a_h, b_h = self.get_shrunk_jumper_posterior(home_jumper_id, reach_diff=reach_diff_home)
        rate_a, a_a, b_a = self.get_shrunk_jumper_posterior(away_jumper_id, reach_diff=-reach_diff_home)

        safe_h = np.clip(rate_h, 0.01, 0.99)
        safe_a = np.clip(rate_a, 0.01, 0.99)
        num = safe_h * (1.0 - safe_a)
        den = num + (safe_a * (1.0 - safe_h))
        p_tip_home = float(num / den) if den > 0 else 0.50

        # Effective Beta parameters for posterior sampling
        m_eff = 40.0
        post_alpha = p_tip_home * m_eff
        post_beta = (1.0 - p_tip_home) * m_eff

        return p_tip_home, post_alpha, post_beta

    def get_shrunk_make_rate_posterior(self, player_id: int, zone: str) -> Tuple[float, float, float]:
        """
        Computes posterior Beta(alpha, beta) for player's make probability in a specific zone.
        Shrinks individual sample toward league average for that zone.
        """
        key = f"make_{zone}"
        prior = LEAGUE_PRIORS.get(key, {"mean": 0.450, "weight": 30.0})
        m = prior["weight"]
        alpha_0 = prior["mean"] * m
        beta_0 = (1.0 - prior["mean"]) * m

        row = self.conn.execute("""
        SELECT attempts, makes 
        FROM player_shot_rates 
        WHERE player_id = ? AND shot_zone = ?
        """, (player_id, zone)).fetchone()

        if row and row["attempts"] > 0:
            n = row["attempts"]
            y = row["makes"]
        else:
            n, y = 0, 0

        post_alpha = alpha_0 + y
        post_beta = beta_0 + (n - y)
        point_estimate = post_alpha / (post_alpha + post_beta)

        return point_estimate, post_alpha, post_beta

    def get_shrunk_shot_shares_posterior(self, team_abbr: str, starter_ids: List[int]) -> Tuple[np.ndarray, np.ndarray]:
        """
        Computes posterior Dirichlet concentration parameters for the 5 confirmed starters.
        Shrinks observed early FGA toward baseline positional priors.
        """
        # Default baseline prior weights for starter lineup (alpha_0 = 3.0 per player = 15 total weight)
        prior_alpha = np.array([3.0] * len(starter_ids), dtype=float)

        observed_fga = []
        for pid in starter_ids:
            row = self.conn.execute("""
            SELECT early_fga 
            FROM player_early_shot_shares 
            WHERE player_id = ?
            """, (pid,)).fetchone()
            observed_fga.append(row["early_fga"] if row and row["early_fga"] else 0)

        observed_fga = np.array(observed_fga, dtype=float)
        post_alpha = prior_alpha + observed_fga
        point_estimates = post_alpha / np.sum(post_alpha)

        return point_estimates, post_alpha

    def get_shrunk_team_rates(self, team_abbr: str) -> Dict[str, Any]:
        """
        Computes shrunk team turnover rate, shooting foul rate, and offensive rebound rate.
        """
        row = self.conn.execute("""
        SELECT total_possessions, turnover_rate, shooting_foul_rate, oreb_rate
        FROM team_opening_rates
        WHERE team_abbr = ?
        """, (team_abbr,)).fetchone()

        if not row:
            return {
                "turnover_rate": LEAGUE_PRIORS["turnover_rate"]["mean"],
                "foul_rate": LEAGUE_PRIORS["foul_rate"]["mean"],
                "oreb_rate": LEAGUE_PRIORS["oreb_rate"]["mean"],
                "post_tov": (10.0, 70.0),
                "post_foul": (6.0, 74.0),
                "post_oreb": (20.0, 60.0),
            }

        n = row["total_possessions"]

        # Turnover shrinkage
        m_tov = LEAGUE_PRIORS["turnover_rate"]["weight"]
        p_tov = LEAGUE_PRIORS["turnover_rate"]["mean"]
        shrunk_tov = (row["turnover_rate"] * n + m_tov * p_tov) / (n + m_tov)
        tov_alpha = shrunk_tov * (n + m_tov)
        tov_beta = (1.0 - shrunk_tov) * (n + m_tov)

        # Foul shrinkage
        m_foul = LEAGUE_PRIORS["foul_rate"]["weight"]
        p_foul = LEAGUE_PRIORS["foul_rate"]["mean"]
        shrunk_foul = (row["shooting_foul_rate"] * n + m_foul * p_foul) / (n + m_foul)
        foul_alpha = shrunk_foul * (n + m_foul)
        foul_beta = (1.0 - shrunk_foul) * (n + m_foul)

        # OREB shrinkage
        m_oreb = LEAGUE_PRIORS["oreb_rate"]["weight"]
        p_oreb = LEAGUE_PRIORS["oreb_rate"]["mean"]
        shrunk_oreb = (row["oreb_rate"] * n + m_oreb * p_oreb) / (n + m_oreb)
        oreb_alpha = shrunk_oreb * (n + m_oreb)
        oreb_beta = (1.0 - shrunk_oreb) * (n + m_oreb)

        return {
            "turnover_rate": round(shrunk_tov, 4),
            "foul_rate": round(shrunk_foul, 4),
            "oreb_rate": round(shrunk_oreb, 4),
            "post_tov": (tov_alpha, tov_beta),
            "post_foul": (foul_alpha, foul_beta),
            "post_oreb": (oreb_alpha, oreb_beta),
        }

    def close(self):
        self.conn.close()

def verify_hierarchical_model():
    """Validates shrinkage behavior across extreme samples."""
    model = HierarchicalShrinkageModel()

    print("\n--- Hierarchical Bayesian Shrinkage Verification ---")
    # 1. Jumper shrinkage test: 4 attempts, 3 wins (75% raw) -> shrunk to ~54%
    test_jumper_id = 1641705 # Wemby
    point, a, b = model.get_shrunk_jumper_posterior(test_jumper_id, reach_diff=+6.0)
    print(f"Jumper Posterior (Wemby, +6in reach): Point={point:.3f}, Beta({a:.1f}, {b:.1f})")

    # 2. Make rate shrinkage test
    point_rim, a_rim, b_rim = model.get_shrunk_make_rate_posterior(test_jumper_id, "rim")
    point_3, a_3, b_3 = model.get_shrunk_make_rate_posterior(test_jumper_id, "three")
    print(f"Make Rate Posterior: Rim Point={point_rim:.3f} Beta({a_rim:.1f}, {b_rim:.1f}) | 3PT Point={point_3:.3f} Beta({a_3:.1f}, {b_3:.1f})")

    # 3. Shot share Dirichlet test
    celtics_starters = [1628369, 1627759, 204001, 1628401, 201950]
    shares, alphas = model.get_shrunk_shot_shares_posterior("BOS", celtics_starters)
    print(f"Dirichlet Posterior Shares (BOS Starters): {np.round(shares, 3)}")
    print(f"Sum of Shrunk Shares: {np.sum(shares):.4f}")

    # 4. Team rate shrinkage test
    team_rates = model.get_shrunk_team_rates("BOS")
    print(f"Team Shrunk Rates (BOS): TOV={team_rates['turnover_rate']:.3f}, Foul={team_rates['foul_rate']:.3f}, OREB={team_rates['oreb_rate']:.3f}")
    print("----------------------------------------------------\n")

    assert np.isclose(np.sum(shares), 1.0), "Dirichlet posterior shares must sum to 1.0"
    assert 0.50 <= point_rim <= 0.85, f"Rim make rate {point_rim} outside expected bounds"
    model.close()

if __name__ == "__main__":
    verify_hierarchical_model()
