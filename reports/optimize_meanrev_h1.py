"""Optimize BB/RSI parameters on the available H1 snapshot.

Run from the repository root with:
    python3 reports/optimize_meanrev_h1.py

This is research only: it does not connect to MetaTrader, update strategy
settings, or submit orders. Parameters are ranked on training performance;
holdout rankings are reported for inspection and are not independent after
trying many candidates.
"""

from __future__ import annotations

import importlib.util
import itertools
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent


def load_research():
    path = ROOT / "backtest_all_strategies.py"
    spec = importlib.util.spec_from_file_location("strategy_research", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load research module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def candidate_record(research, signal_params, stop_percent, reward_risk):
    params = ("H1", signal_params, stop_percent, reward_risk)
    train = research.evaluate_mean_reversion(params, "train")
    if train["trades"] < 8 or train["active_symbols"] < 4:
        return None
    return {
        "parameters": {
            "timeframe": "H1",
            "bollinger_length": signal_params[0],
            "bollinger_deviation": signal_params[1],
            "rsi_length": signal_params[2],
            "rsi_oversold": signal_params[3],
            "rsi_overbought": signal_params[4],
            "stop_percent": stop_percent,
            "reward_risk": reward_risk,
        },
        "train": train,
        "train_1_5x_spread": research.evaluate_mean_reversion(
            params, "train", 1.5
        ),
        "holdout": research.evaluate_mean_reversion(params, "holdout"),
        "holdout_1_5x_spread": research.evaluate_mean_reversion(
            params, "holdout", 1.5
        ),
    }


def main():
    research = load_research()
    research.BARS["H1"] = json.loads(
        (ROOT / "h1-rates-2026-11-04.json").read_text()
    )
    grid_size = 2 * 3 * 2 * 2 * 2 * 3 * 4
    candidates = []
    for signal_params in itertools.product(
        (10, 20),
        (1.5, 2.0, 2.5),
        (7, 14),
        (20, 30),
        (70, 80),
    ):
        for stop_percent, reward_risk in itertools.product(
            (0.05, 0.1, 0.2), (1.0, 1.5, 2.0, 3.0)
        ):
            candidate = candidate_record(
                research, signal_params, stop_percent, reward_risk
            )
            if candidate is not None:
                candidates.append(candidate)

    baseline = candidate_record(
        research, (20, 2.0, 14, 20, 80), 0.2, 3.0
    )
    if baseline is None:
        raise RuntimeError("The fixed H1 baseline did not meet candidate filters")

    top_by_train = sorted(
        candidates, key=lambda row: row["train"]["net_usd"], reverse=True
    )
    top_by_holdout = sorted(
        candidates, key=lambda row: row["holdout"]["net_usd"], reverse=True
    )
    stable = [
        row
        for row in candidates
        if row["train"]["net_usd"] > 0
        and row["train_1_5x_spread"]["net_usd"] > 0
        and row["holdout"]["net_usd"] > 0
        and row["holdout_1_5x_spread"]["net_usd"] > 0
    ]
    balanced = sorted(
        stable,
        key=lambda row: min(
            row["train_1_5x_spread"]["net_usd"],
            row["holdout_1_5x_spread"]["net_usd"],
        ),
        reverse=True,
    )

    output = ROOT / f"meanrev-h1-optimization-{date.today().isoformat()}.json"
    result: dict[str, Any] = {
        "method": "H1-only grid; 60% chronological training / 40% holdout; 0.01 lots; median observed spread and one adverse tick per fill; 1.5x spread stress; no live orders.",
        "grid_size": grid_size,
        "candidate_count_after_training_filter": len(candidates),
        "training_filter": "At least 8 training trades across at least 4 active symbols.",
        "parameters_tested": {
            "bollinger_length": [10, 20],
            "bollinger_deviation": [1.5, 2.0, 2.5],
            "rsi_length": [7, 14],
            "rsi_oversold": [20, 30],
            "rsi_overbought": [70, 80],
            "stop_percent": [0.05, 0.1, 0.2],
            "reward_risk": [1.0, 1.5, 2.0, 3.0],
        },
        "baseline": baseline,
        "positive_train_and_holdout": sum(
            row["train"]["net_usd"] > 0 and row["holdout"]["net_usd"] > 0
            for row in candidates
        ),
        "positive_train_holdout_and_both_stress_runs": len(stable),
        "top_by_train_net": top_by_train[:10],
        "top_by_holdout_net_selection_biased": top_by_holdout[:10],
        "top_stable_candidates": sorted(
            stable,
            key=lambda row: (
                row["holdout_1_5x_spread"]["net_usd"],
                row["train_1_5x_spread"]["net_usd"],
            ),
            reverse=True,
        )[:10],
        "top_balanced_stress_candidates": balanced[:10],
        "limitations": [
            "Trying many candidates and then examining the same holdout introduces selection bias; holdout-ranked winners are exploratory, not validation.",
            "The hourly snapshot has only 400 bars per symbol, so results are based on short histories and modest trade counts.",
            "OHLC bars cannot determine intrabar order when stop and target are both crossed, so the simulator assumes stop first.",
            "Historical spread by bar, commissions, swaps, latency, account position limits, and broker rejections are not fully simulated.",
        ],
    }
    output.write_text(json.dumps(result, indent=2) + "\n")
    print(
        json.dumps(
            {
                "output": str(output.relative_to(REPO)),
                "grid_size": grid_size,
                "candidate_count_after_training_filter": len(candidates),
                "positive_train_and_holdout": result["positive_train_and_holdout"],
                "positive_train_holdout_and_both_stress_runs": len(stable),
                "baseline": baseline,
                "top_by_train_net": top_by_train[:5],
                "top_by_holdout_net_selection_biased": top_by_holdout[:5],
                "top_stable_candidates": result["top_stable_candidates"][:5],
                "top_balanced_stress_candidates": balanced[:5],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
