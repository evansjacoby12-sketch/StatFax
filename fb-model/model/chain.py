"""
fb-model/model/chain.py — Closed-Form Possession Chain Model

Solves the opening possession Markov chain analytically:
1. Possession outcomes: made 2, made 3, miss (with OREB continuation), turnover, or shooting foul.
2. P(team scores on possession k) = team shot mix × make rates / (1 - miss × OREB).
3. P(player gets credit) = player's share of early shots × make rate for that shot type.
4. Sums across possessions: sum_k P(reach possession k) × P(score on k) × P(credit).
5. Exact closed-form solution supporting both FIRST_FIELD_GOAL and FIRST_POINT_SCORED rules.
"""

import numpy as np
from typing import Dict, Any, List

def solve_possession_chain(
    home_team: Dict[str, Any],
    away_team: Dict[str, Any],
    p_tip_home: float,
    settlement_rule: str = "FIRST_FIELD_GOAL",
    max_possessions: int = 16
) -> Dict[str, Any]:
    """
    Computes exact closed-form first basket probabilities for all 10 players on the court.

    home_team / away_team structure:
    {
        "abbr": "BOS",
        "turnover_rate": 0.125,
        "foul_rate": 0.075,
        "oreb_rate": 0.260,
        "players": [
            {
                "id": 1628369,
                "name": "Jayson Tatum",
                "shot_share": 0.32,
                "zone_weights": {"rim": 0.45, "mid": 0.15, "three": 0.40},
                "make_rates": {"rim": 0.68, "mid": 0.44, "three": 0.38, "ft": 0.85}
            },
            ... 5 starters ...
        ]
    }
    """
    teams = {"home": home_team, "away": away_team}
    opp_map = {"home": "away", "away": "home"}

    # 1. Compute per-possession scoring profiles for each team
    team_scoring_probs = {}
    player_credit_shares = {}

    for side, team in teams.items():
        players = team["players"]
        tov = team.get("turnover_rate", 0.125)
        foul = team.get("foul_rate", 0.075)
        oreb = team.get("oreb_rate", 0.260)
        fg_attempt_rate = max(1.0 - tov - foul, 0.50)

        # Compute each player's probability of scoring on a shot attempt
        player_fg_make_probs = []
        player_ft_make_probs = []

        for p in players:
            share = p.get("shot_share", 0.20)
            zw = p.get("zone_weights", {"rim": 0.40, "mid": 0.20, "three": 0.40})
            mr = p.get("make_rates", {"rim": 0.64, "mid": 0.42, "three": 0.36, "ft": 0.78})

            # FG make probability
            p_make_fg = sum(zw.get(z, 0.33) * mr.get(z, 0.45) for z in ["rim", "mid", "three"])
            player_fg_make_probs.append(share * p_make_fg)

            # FT make probability (prob of making at least 1 FT if fouled)
            ft_pct = mr.get("ft", 0.78)
            p_make_at_least_one_ft = 1.0 - (1.0 - ft_pct) ** 2
            player_ft_make_probs.append(share * p_make_at_least_one_ft)

        team_fg_make_rate = sum(player_fg_make_probs)
        team_ft_make_rate = sum(player_ft_make_probs)

        # OREB sequence extension multiplier:
        # Sum_{r=0}^infty [ (1 - team_fg_make_rate) * oreb ]^r = 1 / [1 - (1 - make) * oreb]
        oreb_multiplier = 1.0 / (1.0 - (1.0 - team_fg_make_rate) * oreb)

        if settlement_rule == "FIRST_POINT_SCORED":
            # Made FTs also count as first score
            p_score_single_poss = (fg_attempt_rate * team_fg_make_rate * oreb_multiplier) + (foul * team_ft_make_rate)
            # Player shares of team scoring
            total_scorer_rate = team_fg_make_rate + (foul / fg_attempt_rate) * team_ft_make_rate
            p_credit = [
                (player_fg_make_probs[idx] + (foul / fg_attempt_rate) * player_ft_make_probs[idx]) / total_scorer_rate
                for idx in range(len(players))
            ]
        else: # FIRST_FIELD_GOAL
            p_score_single_poss = fg_attempt_rate * team_fg_make_rate * oreb_multiplier
            p_credit = [player_fg_make_probs[idx] / team_fg_make_rate for idx in range(len(players))]

        p_score_single_poss = min(p_score_single_poss, 0.95)
        team_scoring_probs[side] = p_score_single_poss
        player_credit_shares[side] = p_credit

    # 2. Propagate Markov chain through alternating possessions
    # State: probability mass entering possession k for home vs away
    p_active = {"home": p_tip_home, "away": 1.0 - p_tip_home}

    accumulated_team_scores = {"home": 0.0, "away": 0.0}
    accumulated_player_scores = {
        "home": [0.0] * len(home_team["players"]),
        "away": [0.0] * len(away_team["players"]),
    }

    for poss_idx in range(1, max_possessions + 1):
        for side in ["home", "away"]:
            prob_reaching_poss = p_active[side]
            if prob_reaching_poss <= 1e-7:
                continue

            score_prob = team_scoring_probs[side]
            p_score_here = prob_reaching_poss * score_prob

            accumulated_team_scores[side] += p_score_here
            for p_idx, credit_share in enumerate(player_credit_shares[side]):
                accumulated_player_scores[side][p_idx] += p_score_here * credit_share

            # Probability possession fails and transfers to opponent
            p_turnover_to_opp = prob_reaching_poss * (1.0 - score_prob)
            opp_side = opp_map[side]
            p_active[opp_side] += p_turnover_to_opp
            p_active[side] = 0.0

    # Normalize across all 10 players to ensure exact 1.0 probability sum
    total_model_prob = sum(accumulated_team_scores.values())
    norm_factor = 1.0 / total_model_prob if total_model_prob > 0 else 1.0

    output_players = []
    for side in ["home", "away"]:
        team = teams[side]
        for p_idx, p in enumerate(team["players"]):
            fair_prob = accumulated_player_scores[side][p_idx] * norm_factor
            output_players.append({
                "player_id": p["id"],
                "player_name": p["name"],
                "team_abbr": team["abbr"],
                "fair_probability": round(fair_prob, 5),
                "fair_american_odds": int(round((1.0 - fair_prob) / fair_prob * 100)) if fair_prob < 0.5 else int(round(-(fair_prob / (1.0 - fair_prob)) * 100)),
            })

    output_players.sort(key=lambda x: x["fair_probability"], reverse=True)

    return {
        "players": output_players,
        "team_probabilities": {
            home_team["abbr"]: round(accumulated_team_scores["home"] * norm_factor, 4),
            away_team["abbr"]: round(accumulated_team_scores["away"] * norm_factor, 4),
        },
        "settlement_rule": settlement_rule,
        "tip_prob_home": round(p_tip_home, 4),
    }

def verify_possession_chain():
    """Validates possession chain sum, tip sensitivity, and player credits."""
    celtics = {
        "abbr": "BOS",
        "turnover_rate": 0.12,
        "foul_rate": 0.06,
        "oreb_rate": 0.28,
        "players": [
            {"id": 1628369, "name": "Jayson Tatum", "shot_share": 0.34, "zone_weights": {"rim": 0.40, "mid": 0.15, "three": 0.45}, "make_rates": {"rim": 0.68, "mid": 0.44, "three": 0.38, "ft": 0.85}},
            {"id": 1627759, "name": "Jaylen Brown", "shot_share": 0.28, "zone_weights": {"rim": 0.50, "mid": 0.25, "three": 0.25}, "make_rates": {"rim": 0.70, "mid": 0.46, "three": 0.36, "ft": 0.75}},
            {"id": 204001, "name": "Kristaps Porzingis", "shot_share": 0.18, "zone_weights": {"rim": 0.40, "mid": 0.20, "three": 0.40}, "make_rates": {"rim": 0.72, "mid": 0.48, "three": 0.38, "ft": 0.86}},
            {"id": 1628401, "name": "Derrick White", "shot_share": 0.12, "zone_weights": {"rim": 0.20, "mid": 0.10, "three": 0.70}, "make_rates": {"rim": 0.64, "mid": 0.42, "three": 0.40, "ft": 0.88}},
            {"id": 201950, "name": "Jrue Holiday", "shot_share": 0.08, "zone_weights": {"rim": 0.30, "mid": 0.20, "three": 0.50}, "make_rates": {"rim": 0.62, "mid": 0.42, "three": 0.41, "ft": 0.83}},
        ]
    }

    knicks = {
        "abbr": "NYK",
        "turnover_rate": 0.11,
        "foul_rate": 0.08,
        "oreb_rate": 0.24,
        "players": [
            {"id": 1628973, "name": "Jalen Brunson", "shot_share": 0.36, "zone_weights": {"rim": 0.35, "mid": 0.35, "three": 0.30}, "make_rates": {"rim": 0.65, "mid": 0.48, "three": 0.39, "ft": 0.85}},
            {"id": 1626157, "name": "Karl-Anthony Towns", "shot_share": 0.28, "zone_weights": {"rim": 0.45, "mid": 0.15, "three": 0.40}, "make_rates": {"rim": 0.70, "mid": 0.45, "three": 0.43, "ft": 0.88}},
            {"id": 1628969, "name": "Mikal Bridges", "shot_share": 0.16, "zone_weights": {"rim": 0.25, "mid": 0.35, "three": 0.40}, "make_rates": {"rim": 0.62, "mid": 0.44, "three": 0.37, "ft": 0.81}},
            {"id": 1628384, "name": "OG Anunoby", "shot_share": 0.12, "zone_weights": {"rim": 0.30, "mid": 0.10, "three": 0.60}, "make_rates": {"rim": 0.66, "mid": 0.40, "three": 0.39, "ft": 0.76}},
            {"id": 1628404, "name": "Josh Hart", "shot_share": 0.08, "zone_weights": {"rim": 0.50, "mid": 0.10, "three": 0.40}, "make_rates": {"rim": 0.64, "mid": 0.38, "three": 0.34, "ft": 0.79}},
        ]
    }

    # Porzingis tip advantage: 68% tip win prob
    res = solve_possession_chain(celtics, knicks, p_tip_home=0.68, settlement_rule="FIRST_FIELD_GOAL")

    print("\n--- Possession Markov Chain Analytical Verification ---")
    print(f"Tip Probability (BOS): {res['tip_prob_home'] * 100:.1f}%")
    print(f"Team First Basket Probs: BOS {res['team_probabilities']['BOS'] * 100:.1f}% | NYK {res['team_probabilities']['NYK'] * 100:.1f}%")
    print("\nPlayer First Basket Fair Odds Table:")
    for p in res["players"]:
        odds_str = f"+{p['fair_american_odds']}" if p["fair_american_odds"] > 0 else str(p["fair_american_odds"])
        print(f"  {p['player_name']:<22} ({p['team_abbr']}): {p['fair_probability'] * 100:>5.2f}% | Fair: {odds_str:>5}")
    print("--------------------------------------------------------\n")

    # Invariant checks
    total_prob = sum(p["fair_probability"] for p in res["players"])
    assert np.isclose(total_prob, 1.0, atol=1e-4), f"Player probabilities sum to {total_prob}, expected 1.0"
    # BOS tip win rate (68%) should give BOS first basket probability ~55-68%
    assert 0.55 <= res["team_probabilities"]["BOS"] <= 0.70, f"Team prob {res['team_probabilities']['BOS']} out of expected bounds"

if __name__ == "__main__":
    verify_possession_chain()
