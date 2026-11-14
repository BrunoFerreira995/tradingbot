"""Compare the selected BB/RSI setup across M30, H1, and H4.

H4 candles are aggregated from the hourly snapshot; only complete, aligned
four-hour candles are retained. This is a fixed-parameter comparison, not a
new parameter search.
"""

from __future__ import annotations

import importlib.util
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


def aggregate_h4(hourly: dict[str, list[dict[str, Any]]]):
    aggregated = {}
    for symbol, bars in hourly.items():
        buckets: dict[int, list[dict[str, Any]]] = {}
        for bar in bars:
            bucket = bar["t"] // 14_400 * 14_400
            buckets.setdefault(bucket, []).append(bar)
        complete = []
        for start, group in sorted(buckets.items()):
            group.sort(key=lambda bar: bar["t"])
            if [bar["t"] for bar in group] != [
                start,
                start + 3_600,
                start + 7_200,
                start + 10_800,
            ]:
                continue
            complete.append(
                {
                    "t": start,
                    "o": group[0]["o"],
                    "h": max(bar["h"] for bar in group),
                    "l": min(bar["l"] for bar in group),
                    "c": group[-1]["c"],
                    "v": sum(bar.get("v", 0) for bar in group),
                }
            )
        aggregated[symbol] = complete
    return aggregated


def main():
    research = load_research()
    hourly = json.loads((ROOT / "h1-rates-2026-11-04.json").read_text())
    research.BARS["H1"] = hourly
    research.BARS["H4"] = aggregate_h4(hourly)

    signal_params = (20, 2.0, 14, 20, 80)
    stop_percent = 0.2
    reward_risk = 3.0
    results = {}
    for timeframe in ("M30", "H1", "H4"):
        params = (timeframe, signal_params, stop_percent, reward_risk)
        results[timeframe] = {
            "symbols": len(research.BARS[timeframe]),
            "closed_bars_per_symbol": {
                symbol: max(0, len(bars) - 1)
                for symbol, bars in sorted(research.BARS[timeframe].items())
            },
            "train": research.evaluate_mean_reversion(params, "train"),
            "train_1_5x_spread": research.evaluate_mean_reversion(
                params, "train", 1.5
            ),
            "holdout": research.evaluate_mean_reversion(params, "holdout"),
            "holdout_1_5x_spread": research.evaluate_mean_reversion(
                params, "holdout", 1.5
            ),
        }

    output = ROOT / f"meanrev-timeframe-backtest-{date.today().isoformat()}.json"
    result = {
        "method": "Fixed BB/RSI parameters across timeframes; 60/40 chronological split; 0.01 lots; median observed spread and one adverse tick per fill; holdout stress at 1.5x spread; no live orders.",
        "parameters": {
            "bollinger_length": signal_params[0],
            "bollinger_deviation": signal_params[1],
            "rsi_length": signal_params[2],
            "rsi_oversold": signal_params[3],
            "rsi_overbought": signal_params[4],
            "stop_percent": stop_percent,
            "reward_risk": reward_risk,
        },
        "data": {
            "M30": "m30-rates-2026-11-04.json",
            "H1": "h1-rates-2026-11-04.json",
            "H4": "Aggregated from complete aligned candles in h1-rates-2026-11-04.json",
        },
        "timeframes": results,
        "limitations": [
            "Only 400 hourly bars per symbol are available; H4 aggregation therefore provides about 100 candles per symbol and a small sample.",
            "H4 candles with missing hourly components, including weekend gaps, are discarded.",
            "This is a research simulator, not MT5 execution; OHLC bars cannot determine intrabar order when stop and target are both crossed, so stop is assumed first.",
            "Historical spread by bar, commissions, swaps, latency, account position limits, and broker rejections are not fully simulated.",
        ],
    }
    output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"output": str(output.relative_to(REPO)), **result}, indent=2))


if __name__ == "__main__":
    main()
