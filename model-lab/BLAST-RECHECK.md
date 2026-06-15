# ⏰ BLAST re-check — ~2026-06-29 (≈2 weeks out)

Blast rate was folded into the HR score on **2026-06-15** as a bounded nudge
(`server/fetch-slate.mjs`: `BLAST_MAX_DELTA=4`, `BLAST_DELTA_K=0.4`, centered on
`LEAGUE_AVG_BLAST=15`). The size was set off a **season-blast proxy** on 22 days.
Now that **game-time blast is logged on every row**, re-confirm on real,
forward-collected data and decide whether to widen, hold, or pull the nudge.

## Run
```bash
npm run lab:pull         # refresh the backtest log (should be ~35+ days by now)
npm run lab:blast        # within-grade lift (the decisive test)
npm run lab:blast-model  # blast → probability on a held-out time split
```

## Baseline to beat (2026-06-15, 22-day proxy)
- **lab:blast within-grade:** PRIME **+6.9 pts (z 1.9)**, SKIP **+5.2 (z 2.8)**, STRONG/LEAN flat.
- **lab:blast-model held-out Δ (blast − score-only):** Brier **−0.0010**, LogLoss **−0.0033**, AUC **+0.0087**; blast weight **+0.15**.

## Decision rule
- **PRIME within-grade lift holds and z ≥ 2 (now on real forward data)** → safe to **widen** the nudge: bump `BLAST_MAX_DELTA` 4 → 6 and re-validate with `lab:blast-model` (Δ must still improve all three metrics out-of-sample).
- **Lift fades toward 0 / goes negative** → **pull or shrink** the nudge (drop `BLAST_DELTA_K`, or set `BLAST_MAX_DELTA=0` to disable cleanly). The proxy oversold it.
- **Roughly stable** → hold as-is; re-check again in another 2 weeks.

## Notes
- Prefer the **forward window only** (records dated ≥ 2026-06-15) for the cleanest read — that's the first data scored WITH game-time blast logged, no proxy.
- If `lab:blast` is still joining *season* blast (proxy), switch it to read the logged per-row `blastRate` once enough forward days carry it.
