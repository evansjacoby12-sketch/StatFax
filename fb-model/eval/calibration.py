"""
fb-model/eval/calibration.py — Probability Calibration Assessment & Reliability Diagram

Evaluates whether the model is well-calibrated:
"When the model says 12%, does it hit about 12%?"
Computes Expected Calibration Error (ECE), Maximum Calibration Error (MCE),
and plots the calibration curve to `fb-model/data/calibration_curve.png`.
"""

import os
import sys
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from typing import Dict, Any, List

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from eval.backtest import run_walk_forward_backtest

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

def evaluate_calibration(predictions: List[Dict[str, Any]], n_bins: int = 5) -> Dict[str, Any]:
    """
    Computes calibration metrics across probability bins and generates reliability plot.
    """
    if not predictions:
        print("[calibration.py] No predictions provided.")
        return {}

    df = pd.DataFrame(predictions)
    # Define realistic bins for first basket markets (which typically range 3% to 25%)
    bin_edges = np.linspace(0.02, 0.25, n_bins + 1)
    
    bin_results = []
    total_samples = len(df)
    weighted_ece = 0.0
    max_error = 0.0

    for i in range(len(bin_edges) - 1):
        low = bin_edges[i]
        high = bin_edges[i + 1]

        if i == len(bin_edges) - 2:
            subset = df[(df["model_prob"] >= low) & (df["model_prob"] <= high + 0.10)]
        else:
            subset = df[(df["model_prob"] >= low) & (df["model_prob"] < high)]

        count = len(subset)
        if count == 0:
            continue

        mean_pred = float(subset["model_prob"].mean())
        observed_rate = float(subset["actual_won"].mean())
        abs_err = abs(mean_pred - observed_rate)

        weighted_ece += (count / total_samples) * abs_err
        if abs_err > max_error:
            max_error = abs_err

        bin_results.append({
            "bin_range": f"{low * 100:.1f}% - {high * 100:.1f}%",
            "samples": count,
            "mean_predicted": round(mean_pred, 4),
            "observed_frequency": round(observed_rate, 4),
            "abs_error": round(abs_err, 4),
        })

    # Plot Reliability Diagram
    fig, ax = plt.subplots(figsize=(8, 6), dpi=150)
    
    # 45-degree perfect calibration line
    ax.plot([0, 0.30], [0, 0.30], "k--", label="Perfect Calibration (y = x)", alpha=0.7)

    # Plot empirical points
    preds = [b["mean_predicted"] for b in bin_results]
    actuals = [b["observed_frequency"] for b in bin_results]
    counts = [b["samples"] for b in bin_results]

    ax.scatter(preds, actuals, color="#2563eb", s=[max(c / 2, 40) for c in counts], zorder=5, label="Model Reliability")
    ax.plot(preds, actuals, color="#2563eb", linewidth=2, alpha=0.8)

    ax.set_title("NBA First Basket Model: Reliability & Calibration Curve", fontsize=14, fontweight="bold", pad=12)
    ax.set_xlabel("Mean Predicted Probability", fontsize=11)
    ax.set_ylabel("Empirical First Basket Rate", fontsize=11)
    ax.set_xlim(0.0, 0.28)
    ax.set_ylim(0.0, 0.28)
    ax.grid(True, linestyle=":", alpha=0.6)
    ax.legend(loc="upper left")

    # Add ECE text annotation
    text_str = f"ECE: {weighted_ece * 100:.2f}%\nMCE: {max_error * 100:.2f}%\nSamples: {total_samples}"
    ax.text(0.02, 0.18, text_str, fontsize=10, bbox=dict(boxstyle="round,pad=0.5", facecolor="#f8fafc", edgecolor="#cbd5e1"))

    plt.tight_layout()
    plot_path = os.path.join(DATA_DIR, "calibration_curve.png")
    fig.savefig(plot_path)
    plt.close(fig)

    # Positional ECE and Breakdown
    pos_calib = {}
    pos_plot_path = None
    if "position" in df.columns:
        fig_pos, axes = plt.subplots(1, 5, figsize=(18, 4), dpi=120, sharey=True)
        for idx, pos_label in enumerate(["C", "PF", "SF", "SG", "PG"]):
            ax_p = axes[idx]
            sub_pos = df[df["position"] == pos_label]
            pos_pred_mean = float(sub_pos["model_prob"].mean())
            pos_act_mean = float(sub_pos["actual_won"].mean())
            pos_ece = abs(pos_pred_mean - pos_act_mean)

            ax_p.plot([0, 0.25], [0, 0.25], "k--", alpha=0.6)
            ax_p.scatter([pos_pred_mean], [pos_act_mean], color="#0284c7", s=100, zorder=4)
            ax_p.set_title(f"Pos {pos_label} (N={len(sub_pos)})", fontweight="bold")
            ax_p.set_xlabel("Mean Pred")
            if idx == 0:
                ax_p.set_ylabel("Actual Hit Rate")
            ax_p.set_xlim(0.0, 0.25)
            ax_p.set_ylim(0.0, 0.25)
            ax_p.grid(True, linestyle=":", alpha=0.6)
            ax_p.text(0.02, 0.16, f"Pred: {pos_pred_mean*100:.1f}%\nHit:  {pos_act_mean*100:.1f}%\nECE:  {pos_ece*100:.2f}%", fontsize=9, bbox=dict(boxstyle="round,pad=0.3", facecolor="#f8fafc", edgecolor="#cbd5e1"))

            pos_calib[pos_label] = {
                "samples": len(sub_pos),
                "actual_hits": int(sub_pos["actual_won"].sum()),
                "actual_hit_pct": round(pos_act_mean * 100.0, 2),
                "model_mean_pred_pct": round(pos_pred_mean * 100.0, 2),
                "ece_pct": round(pos_ece * 100.0, 2),
            }

        plt.suptitle("NBA First Basket Model: Reliability by Position", fontsize=13, fontweight="bold")
        plt.tight_layout()
        pos_plot_path = os.path.join(DATA_DIR, "calibration_curve_by_position.png")
        fig_pos.savefig(pos_plot_path)
        plt.close(fig_pos)

    return {
        "expected_calibration_error_pct": round(weighted_ece * 100.0, 2),
        "maximum_calibration_error_pct": round(max_error * 100.0, 2),
        "bins": bin_results,
        "plot_path": plot_path,
        "pos_plot_path": pos_plot_path,
        "positional_calibration": pos_calib,
        "total_samples": total_samples
    }

def verify_calibration():
    """Runs walk-forward backtest and evaluates probability calibration."""
    backtest_res = run_walk_forward_backtest(sportsbook="DraftKings", min_edge_pct=0.015)
    calib = evaluate_calibration(backtest_res["predictions"], n_bins=5)

    print("\n=======================================================")
    print("      NBA FIRST BASKET MODEL CALIBRATION REPORT        ")
    print("=======================================================")
    print(f"Total Evaluated Samples:      {calib['total_samples']}")
    print(f"Expected Calibration Error:   {calib['expected_calibration_error_pct']:.2f}%")
    print(f"Maximum Calibration Error:    {calib['maximum_calibration_error_pct']:.2f}%")
    print(f"Saved Calibration Curve Plot: {calib['plot_path']}")
    if calib.get("pos_plot_path"):
        print(f"Saved Positional Curve Plot:  {calib['pos_plot_path']}")

    print("\nCalibration Table Across Probability Bins:")
    print(f"{'Bin Range':<16} {'Count':<8} {'Mean Pred':<12} {'Actual Hit':<12} {'Abs Error'}")
    print("-" * 58)
    for b in calib["bins"]:
        print(f"{b['bin_range']:<16} {b['samples']:<8} {b['mean_predicted'] * 100:>5.2f}%       {b['observed_frequency'] * 100:>5.2f}%       {b['abs_error'] * 100:>5.2f}%")

    if calib.get("positional_calibration"):
        print("\nPositional Calibration Split (ECE by Position):")
        print(f"{'Position':<8} {'Samples':<8} {'Actual Hits':<12} {'Actual Hit %':<14} {'Model Pred %':<14} {'ECE %'}")
        print("-" * 65)
        for pos_k, pos_v in calib["positional_calibration"].items():
            print(f"{pos_k:<8} {pos_v['samples']:<8} {pos_v['actual_hits']:<12} {pos_v['actual_hit_pct']:>6.2f}%        {pos_v['model_mean_pred_pct']:>6.2f}%        {pos_v['ece_pct']:>5.2f}%")
        print("-" * 65)

    print("=======================================================\n")

    # Calibration threshold: ECE should be under 5%
    assert calib["expected_calibration_error_pct"] < 5.0, f"ECE {calib['expected_calibration_error_pct']}% exceeds 5% threshold"

if __name__ == "__main__":
    verify_calibration()
