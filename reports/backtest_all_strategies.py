"""Research-only parameter search for strategies with available OHLC snapshots.

Run from the repository root with:
    python3 reports/backtest_all_strategies.py

This script does not connect to MetaTrader, write strategy settings, or submit
orders. The documented gold-scalping-v1 Pine code is only an integration
example, so it is reported separately from the implemented strategies.
"""

from __future__ import annotations

import csv
import importlib.util
import itertools
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path
from statistics import median
from typing import Any

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
DATA_FILES = {
    "M1": "post-trade-rates-2026-11-04.json",
    "M5": "macro-m5-rates-2026-11-04.json",
    "M15": "macro-m15-rates-2026-11-04.json",
    "M30": "m30-rates-2026-11-04.json",
}
LOT = 0.01
SPREAD_STRESS = 1.5
SYMBOLS = [
    "EURUSD",
    "USDJPY",
    "USDCAD",
    "AUDUSD",
    "NZDUSD",
    "USDCNH",
    "Gasoline",
    "GBPUSD",
    "USDCHF",
]
TICK_SPECS = {
    "EURUSD": (0.00001, 1.0, 1.0),
    "USDJPY": (0.001, 0.63133306, 0.63150450),
    "USDCAD": (0.00001, 0.71535364, 0.71560447),
    "AUDUSD": (0.00001, 1.0, 1.0),
    "NZDUSD": (0.00001, 1.0, 1.0),
    "USDCNH": (0.00001, 0.14980623, 0.14992032),
    "Gasoline": (0.0001, 0.1, 0.1),
    "GBPUSD": (0.00001, 1.0, 1.0),
    "USDCHF": (0.00001, 1.22324159, 1.22473974),
}


def load_sma_research():
    path = ROOT / "optimize_sma_research.py"
    spec = importlib.util.spec_from_file_location("sma_research", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load research module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


RESEARCH = load_sma_research()
BARS = {
    timeframe: json.loads((ROOT / filename).read_text())
    for timeframe, filename in DATA_FILES.items()
}
SPREADS = RESEARCH.SPREADS


def session_open(timestamp: int) -> bool:
    return RESEARCH.session_open(timestamp)


def pnl_usd(symbol: str, side: str, entry: float, exit_price: float) -> float:
    tick, tick_value, tick_loss = TICK_SPECS[symbol]
    movement = (exit_price - entry) * (1 if side == "BUY" else -1)
    value = tick_value if movement >= 0 else tick_loss
    return movement / tick * value * LOT


def summarize(trades: list[dict[str, Any]], symbols: list[str]) -> dict[str, Any]:
    profits = [trade["pnl"] for trade in trades]
    wins = [value for value in profits if value > 0]
    losses = [value for value in profits if value < 0]
    by_symbol = {
        symbol: round(sum(t["pnl"] for t in trades if t["symbol"] == symbol), 2)
        for symbol in symbols
    }
    peak = total = max_drawdown = 0.0
    for trade in sorted(trades, key=lambda item: item["exit_at"]):
        total += trade["pnl"]
        peak = max(peak, total)
        max_drawdown = max(max_drawdown, peak - total)
    return {
        "trades": len(trades),
        "net_usd": round(sum(profits), 2),
        "win_rate_pct": round(100 * len(wins) / len(profits), 1) if profits else None,
        "profit_factor": round(sum(wins) / -sum(losses), 2) if losses else None,
        "max_trade_drawdown_usd": round(max_drawdown, 2),
        "active_symbols": sum(value != 0 for value in by_symbol.values()),
        "by_symbol": by_symbol,
    }


def run_sma_search() -> dict[str, Any]:
    candidates = []
    for timeframe in ("M1", "M5", "M15", "M30"):
        for fast, slow, price_side, slow_slope, macro, reverse in itertools.product(
            (3, 5, 9, 12),
            (14, 21, 30, 40),
            (False, True),
            (False, True),
            (False, True),
            (False, True),
        ):
            if fast >= slow:
                continue
            params = RESEARCH.Params(
                timeframe, fast, slow, price_side, slow_slope, macro, reverse
            )
            train = RESEARCH.evaluate(params, "train")
            if train["trades"] < 8 or train["active_symbols"] < 4:
                continue
            candidates.append(
                {
                    "parameters": params.__dict__,
                    "train": train,
                    "train_1_5x_spread": RESEARCH.evaluate(params, "train", 1.5),
                    "holdout": RESEARCH.evaluate(params, "holdout"),
                    "holdout_1_5x_spread": RESEARCH.evaluate(params, "holdout", 1.5),
                }
            )
    return {
        "candidate_count": len(candidates),
        "model": "existing SMA research simulator; 0.01 lot, $0.27 stop and 3R target",
        "top_by_train_net": sorted(
            candidates,
            key=lambda row: row["train"]["net_usd"],
            reverse=True,
        )[:10],
        "positive_train_and_holdout": sum(
            row["train"]["net_usd"] > 0 and row["holdout"]["net_usd"] > 0
            for row in candidates
        ),
    }


def swing_indexes(bars: list[dict[str, Any]], period: int, field: str, high: bool):
    indexes = []
    for i in range(period, len(bars) - period):
        value = bars[i][field]
        if all(
            (value > bars[i - d][field] and value > bars[i + d][field])
            if high
            else (value < bars[i - d][field] and value < bars[i + d][field])
            for d in range(1, period + 1)
        ):
            indexes.append(i)
    return indexes


def simulate_dow(
    timeframe: str,
    symbol: str,
    pivot_bars: int,
    reward_risk: float,
    segment: str,
    spread_multiplier: float = 1.0,
) -> list[dict[str, Any]]:
    bars = BARS[timeframe][symbol][:-1]
    count = len(bars)
    split = int(count * 0.6)
    begin, end = (0, split) if segment == "train" else (split, count)
    tick, _, _ = TICK_SPECS[symbol]
    spread = SPREADS[symbol] * spread_multiplier
    slippage = tick
    position = None
    trades = []

    for i in range(max(begin, 2), end):
        closed = bars[:i]
        highs = swing_indexes(closed, pivot_bars, "h", True)
        lows = swing_indexes(closed, pivot_bars, "l", False)
        signal = stop = None
        if len(highs) >= 2 and len(lows) >= 2:
            previous_high, latest_high = (
                bars[highs[-2]]["h"],
                bars[highs[-1]]["h"],
            )
            previous_low, latest_low = (
                bars[lows[-2]]["l"],
                bars[lows[-1]]["l"],
            )
            up = latest_high > previous_high and latest_low > previous_low
            down = latest_high < previous_high and latest_low < previous_low
            previous, last = bars[i - 2], bars[i - 1]
            if up and previous["c"] <= latest_high < last["c"]:
                signal, stop = "BUY", latest_low
            elif down and previous["c"] >= latest_low > last["c"]:
                signal, stop = "SELL", latest_high

        bar = bars[i]
        if position is None and signal and session_open(bar["t"]):
            entry = (
                bar["o"] + spread + slippage
                if signal == "BUY"
                else bar["o"] - slippage
            )
            distance = entry - stop if signal == "BUY" else stop - entry
            if distance > spread and distance > 0:
                position = {
                    "side": signal,
                    "entry": entry,
                    "stop": stop,
                    "target": entry
                    + (1 if signal == "BUY" else -1) * distance * reward_risk,
                    "entry_at": bar["t"],
                }

        if position:
            side = position["side"]
            reason = None
            if side == "BUY":
                if bar["l"] <= position["stop"]:
                    reason = "STOP"
                    exit_price = min(bar["o"], position["stop"]) - slippage
                elif bar["h"] >= position["target"]:
                    reason = "TARGET"
                    exit_price = position["target"] - slippage
            else:
                if bar["h"] + spread >= position["stop"]:
                    reason = "STOP"
                    exit_price = max(bar["o"] + spread, position["stop"]) + slippage
                elif bar["l"] + spread <= position["target"]:
                    reason = "TARGET"
                    exit_price = position["target"] + slippage
            if reason:
                trades.append(
                    {
                        "symbol": symbol,
                        "entry_at": position["entry_at"],
                        "exit_at": bar["t"],
                        "pnl": pnl_usd(symbol, side, position["entry"], exit_price),
                        "reason": reason,
                    }
                )
                position = None

    if position:
        bar = bars[end - 1]
        trades.append(
            {
                "symbol": symbol,
                "entry_at": position["entry_at"],
                "exit_at": bar["t"],
                "pnl": pnl_usd(symbol, position["side"], position["entry"], bar["c"]),
                "reason": "SEGMENT_END",
            }
        )
    return trades


def evaluate_dow(params, segment: str, spread_multiplier: float = 1.0):
    timeframe, pivot_bars, reward_risk = params
    trades = [
        trade
        for symbol in SYMBOLS
        for trade in simulate_dow(
            timeframe, symbol, pivot_bars, reward_risk, segment, spread_multiplier
        )
    ]
    return summarize(trades, SYMBOLS)


def run_dow_search() -> dict[str, Any]:
    candidates = []
    for params in itertools.product(
        ("M1", "M5", "M15", "M30"),
        (1, 2, 3, 4, 5),
        (1.0, 1.5, 2.0, 2.5, 3.0),
    ):
        train = evaluate_dow(params, "train")
        if train["trades"] < 8 or train["active_symbols"] < 4:
            continue
        candidates.append(
            {
                "parameters": {
                    "timeframe": params[0],
                    "pivot_bars": params[1],
                    "reward_risk": params[2],
                },
                "train": train,
                "train_1_5x_spread": evaluate_dow(params, "train", 1.5),
                "holdout": evaluate_dow(params, "holdout"),
                "holdout_1_5x_spread": evaluate_dow(params, "holdout", 1.5),
            }
        )
    return {
        "candidate_count": len(candidates),
        "model": "confirmed Dow swings; next-bar-open fills; opposite swing stop; no add/reverse",
        "top_by_train_net": sorted(
            candidates, key=lambda row: row["train"]["net_usd"], reverse=True
        )[:10],
        "positive_train_and_holdout": sum(
            row["train"]["net_usd"] > 0 and row["holdout"]["net_usd"] > 0
            for row in candidates
        ),
    }


def rolling_bands(closes: list[float], period: int, deviation: float):
    result: list[tuple[float, float] | None] = [None] * len(closes)
    for i in range(period - 1, len(closes)):
        values = closes[i - period + 1 : i + 1]
        mean = sum(values) / period
        variance = sum((value - mean) ** 2 for value in values) / period
        width = deviation * variance**0.5
        result[i] = (mean + width, mean - width)
    return result


def rsi_series(closes: list[float], period: int):
    result: list[float | None] = [None] * len(closes)
    if len(closes) <= period:
        return result
    changes = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gain = sum(max(value, 0) for value in changes[:period]) / period
    loss = sum(max(-value, 0) for value in changes[:period]) / period

    def value():
        return 50.0 if gain + loss == 0 else gain / (gain + loss) * 100

    result[period] = value()
    for i in range(period + 1, len(closes)):
        change = changes[i - 1]
        gain = (gain * (period - 1) + max(change, 0)) / (period + 1)
        loss = (loss * (period - 1) + max(-change, 0)) / (period + 1)
        result[i] = value()
    return result


def simulate_mean_reversion(
    timeframe: str,
    symbol: str,
    signal_params: tuple[int, float, int, int, int],
    stop_percent: float,
    reward_risk: float,
    segment: str,
    spread_multiplier: float = 1.0,
):
    bars = BARS[timeframe][symbol][:-1]
    count = len(bars)
    split = int(count * 0.6)
    begin, end = (0, split) if segment == "train" else (split, count)
    bb_period, deviation, rsi_period, oversold, overbought = signal_params
    closes = [bar["c"] for bar in bars]
    bands = rolling_bands(closes, bb_period, deviation)
    rsi_values = rsi_series(closes, rsi_period)
    tick, _, _ = TICK_SPECS[symbol]
    spread = SPREADS[symbol] * spread_multiplier
    slippage = tick
    position = None
    trades = []

    for i in range(max(begin, 1), end):
        j = i - 1
        side = None
        if bands[j] is not None and rsi_values[j] is not None:
            upper, lower = bands[j]
            if closes[j] <= lower and rsi_values[j] <= oversold:
                side = "BUY"
            elif closes[j] >= upper and rsi_values[j] >= overbought:
                side = "SELL"

        bar = bars[i]
        if position is None and side and session_open(bar["t"]):
            entry = (
                bar["o"] + spread + slippage
                if side == "BUY"
                else bar["o"] - slippage
            )
            distance = entry * stop_percent / 100
            position = {
                "side": side,
                "entry": entry,
                "stop": entry - distance if side == "BUY" else entry + distance,
                "target": entry
                + (1 if side == "BUY" else -1) * distance * reward_risk,
                "entry_at": bar["t"],
            }

        if position:
            side = position["side"]
            reason = None
            if side == "BUY":
                if bar["l"] <= position["stop"]:
                    reason = "STOP"
                    exit_price = min(bar["o"], position["stop"]) - slippage
                elif bar["h"] >= position["target"]:
                    reason = "TARGET"
                    exit_price = position["target"] - slippage
            else:
                if bar["h"] + spread >= position["stop"]:
                    reason = "STOP"
                    exit_price = max(bar["o"] + spread, position["stop"]) + slippage
                elif bar["l"] + spread <= position["target"]:
                    reason = "TARGET"
                    exit_price = position["target"] + slippage
            if reason:
                trades.append(
                    {
                        "symbol": symbol,
                        "entry_at": position["entry_at"],
                        "exit_at": bar["t"],
                        "pnl": pnl_usd(symbol, side, position["entry"], exit_price),
                        "reason": reason,
                    }
                )
                position = None

    if position:
        bar = bars[end - 1]
        trades.append(
            {
                "symbol": symbol,
                "entry_at": position["entry_at"],
                "exit_at": bar["t"],
                "pnl": pnl_usd(symbol, position["side"], position["entry"], bar["c"]),
                "reason": "SEGMENT_END",
            }
        )
    return trades


def evaluate_mean_reversion(params, segment: str, spread_multiplier: float = 1.0):
    timeframe, signal_params, stop_percent, reward_risk = params
    trades = [
        trade
        for symbol in SYMBOLS
        for trade in simulate_mean_reversion(
            timeframe,
            symbol,
            signal_params,
            stop_percent,
            reward_risk,
            segment,
            spread_multiplier,
        )
    ]
    return summarize(trades, SYMBOLS)


def run_mean_reversion_search() -> dict[str, Any]:
    candidates = []
    for timeframe in ("M1", "M5", "M15", "M30"):
        signal_space = itertools.product(
            (10, 20),
            (1.5, 2.0, 2.5),
            (7, 14),
            (20, 30),
            (70, 80),
        )
        for signal_params in signal_space:
            for stop_percent, reward_risk in itertools.product(
                (0.05, 0.1, 0.2), (1.0, 1.5, 2.0, 3.0)
            ):
                params = (timeframe, signal_params, stop_percent, reward_risk)
                train = evaluate_mean_reversion(params, "train")
                if train["trades"] < 8 or train["active_symbols"] < 4:
                    continue
                candidates.append(
                    {
                        "parameters": {
                            "timeframe": timeframe,
                            "bollinger_length": signal_params[0],
                            "bollinger_deviation": signal_params[1],
                            "rsi_length": signal_params[2],
                            "rsi_oversold": signal_params[3],
                            "rsi_overbought": signal_params[4],
                            "stop_percent": stop_percent,
                            "reward_risk": reward_risk,
                        },
                        "train": train,
                        "train_1_5x_spread": evaluate_mean_reversion(
                            params, "train", 1.5
                        ),
                        "holdout": evaluate_mean_reversion(params, "holdout"),
                        "holdout_1_5x_spread": evaluate_mean_reversion(
                            params, "holdout", 1.5
                        ),
                    }
                )
    return {
        "candidate_count": len(candidates),
        "model": "implemented BB + RSI rules; 0.01 lot; percent stop and RR target",
        "grid_size": 4 * 2 * 3 * 2 * 2 * 2 * 3 * 4,
        "top_by_train_net": sorted(
            candidates, key=lambda row: row["train"]["net_usd"], reverse=True
        )[:10],
        "positive_train_and_holdout": sum(
            row["train"]["net_usd"] > 0 and row["holdout"]["net_usd"] > 0
            for row in candidates
        ),
    }


def observed_xau_spread() -> float | None:
    values = []
    with (ROOT / "trades-mt5-2026-11-04.csv").open(
        encoding="utf-8-sig", newline=""
    ) as handle:
        for trade in csv.DictReader(handle):
            if trade["symbol"] == "XAUUSD" and trade["spread_at_entry"]:
                values.append(float(trade["spread_at_entry"]))
    return median(values) if values else None


def run_gold_example() -> dict[str, Any]:
    # docs/tradingview.md explicitly labels this Pine code an integration example.
    # XAUUSD contract value is not part of the stored historical snapshot, so
    # returns are reported as price movement, not USD.
    available = {
        timeframe: BARS[timeframe].get("XAUUSD")
        for timeframe in ("M1", "M5")
        if BARS[timeframe].get("XAUUSD")
    }
    return {
        "status": "example_only",
        "description": "TradingView documentation example: SMA 9/21, XAUUSD, SL 25 and TP 50 price units.",
        "available_timeframes": {
            timeframe: {
                "bars_including_forming": len(bars),
                "closed_bars": len(bars) - 1,
            }
            for timeframe, bars in available.items()
        },
        "median_observed_xau_spread": observed_xau_spread(),
        "limitation": "No independent gold-scalping algorithm or verified historical contract-value specification is present; do not compare this example with optimized strategies.",
    }


def main():
    result = {
        "method": "60% chronological training / 40% holdout by symbol and timeframe; 0.01 lots; median observed spread per symbol and one adverse tick per fill; holdout stress at 1.5x spread; no live orders",
        "data": {
            timeframe: {
                "file": filename,
                "symbols": sorted(BARS[timeframe]),
                "bars_per_symbol": {
                    symbol: len(bars)
                    for symbol, bars in sorted(BARS[timeframe].items())
                },
            }
            for timeframe, filename in DATA_FILES.items()
        },
        "strategies": {
            "sma_micro_trend": run_sma_search(),
            "dow_theory": run_dow_search(),
            "meanrev-bb-rsi-v1": run_mean_reversion_search(),
            "gold-scalping-v1": run_gold_example(),
        },
        "known_limits": [
            "This is a research simulator, not MT5 execution; OHLC bars cannot determine intrabar order when stop and target are both crossed, so stop is assumed first.",
            "Parameter selection across a finite holdout creates selection bias; use a new later sample for independent confirmation.",
            "Historical spread by bar, commissions, swaps, latency, account position limits, and broker rejections are not fully simulated.",
            "The gold-scalping-v1 Pine script in docs is explicitly an integration example, not a defined production algorithm.",
        ],
    }
    output = ROOT / f"strategy-backtests-{date.today().isoformat()}.json"
    output.write_text(json.dumps(result, indent=2) + "\n")
    compact = {
        "output": str(output.relative_to(REPO)),
        "strategies": {
            name: (
                {"candidates": data.get("candidate_count"), "top": data.get("top_by_train_net", [])[:3]}
                if "top_by_train_net" in data
                else data
            )
            for name, data in result["strategies"].items()
        },
    }
    print(json.dumps(compact, indent=2))


if __name__ == "__main__":
    main()
