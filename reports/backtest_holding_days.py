"""Research: fixed holding horizons of 1-7 days for the BB/RSI mean-reversion signal.

The entry uses the same Bollinger/RSI rule as the M30 study, evaluated on closed
daily candles. Each signal is entered at the next daily open and exited at the
close N trading days later, with spread and one adverse tick per fill. Trades
overlap so every signal is measured; a non-overlapping count is also reported.
This is a research simulator, not MT5 execution.
"""

from __future__ import annotations

import json
import os
from collections import defaultdict
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parent
LOT = 0.01
BB_PERIOD = 20
BB_DEVIATION = 2.0
RSI_PERIOD = 14
RSI_OVERSOLD = 20
RSI_OVERBOUGHT = 80
HORIZONS = range(1, 8)

MAJORS = ["AUDUSD", "EURUSD", "GBPUSD", "NZDUSD", "USDCAD", "USDCHF", "USDJPY"]
MAJOR_TICKS = {
    "EURUSD": (0.00001, 1.0, 1.0),
    "USDJPY": (0.001, 0.63133306, 0.63150450),
    "USDCAD": (0.00001, 0.71535364, 0.71560447),
    "AUDUSD": (0.00001, 1.0, 1.0),
    "NZDUSD": (0.00001, 1.0, 1.0),
    "GBPUSD": (0.00001, 1.0, 1.0),
    "USDCHF": (0.00001, 1.22324159, 1.22473974),
}
MAJOR_SPREADS = {
    "EURUSD": 0.0001,
    "USDJPY": 0.014,
    "USDCAD": 0.0001,
    "AUDUSD": 0.00011,
    "NZDUSD": 0.00012,
    "GBPUSD": 0.00014,
    "USDCHF": 0.0001,
}


def rolling_bands(closes):
    result = {}
    for i in range(BB_PERIOD - 1, len(closes)):
        values = closes[i - BB_PERIOD + 1 : i + 1]
        mean = sum(values) / BB_PERIOD
        variance = sum((value - mean) ** 2 for value in values) / BB_PERIOD
        width = BB_DEVIATION * variance**0.5
        result[i] = (mean + width, mean - width)
    return result


def rsi_series(closes):
    result = [None] * len(closes)
    if len(closes) <= RSI_PERIOD:
        return result
    changes = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gain = sum(max(value, 0) for value in changes[:RSI_PERIOD]) / RSI_PERIOD
    loss = sum(max(-value, 0) for value in changes[:RSI_PERIOD]) / RSI_PERIOD

    def value():
        return 50.0 if gain + loss == 0 else gain / (gain + loss) * 100

    result[RSI_PERIOD] = value()
    for i in range(RSI_PERIOD + 1, len(closes)):
        change = changes[i - 1]
        gain = (gain * (RSI_PERIOD - 1) + max(change, 0)) / (RSI_PERIOD + 1)
        loss = (loss * (RSI_PERIOD - 1) + max(-change, 0)) / (RSI_PERIOD + 1)
        result[i] = value()
    return result


def pnl_usd(tick_size, tick_value, tick_loss, side, entry, exit_price):
    movement = (exit_price - entry) * (1 if side == "BUY" else -1)
    value = tick_value if movement >= 0 else tick_loss
    return movement / tick_size * value * LOT


def simulate(symbol, bars, tick_size, tick_value, tick_loss, spread, horizon):
    closes = [bar["c"] for bar in bars]
    bands = rolling_bands(closes)
    rsi = rsi_series(closes)
    slip = tick_size
    trades = []
    next_free = 0
    for i in range(1, len(bars)):
        signal_index = i - 1
        if i + horizon >= len(bars):
            break
        band = bands.get(signal_index)
        rsi_value = rsi[signal_index]
        if band is None or rsi_value is None:
            continue
        upper, lower = band
        side = None
        if closes[signal_index] <= lower and rsi_value <= RSI_OVERSOLD:
            side = "BUY"
        elif closes[signal_index] >= upper and rsi_value >= RSI_OVERBOUGHT:
            side = "SELL"
        if side is None:
            continue
        entry_bar = bars[i]
        exit_bar = bars[i + horizon]
        entry = (
            entry_bar["o"] + spread + slip
            if side == "BUY"
            else entry_bar["o"] - slip
        )
        exit_price = (
            exit_bar["c"] - slip
            if side == "BUY"
            else exit_bar["c"] + spread + slip
        )
        pnl = pnl_usd(tick_size, tick_value, tick_loss, side, entry, exit_price)
        movement_pct = (exit_price - entry) / entry * (1 if side == "BUY" else -1) * 100
        trades.append(
            {
                "symbol": symbol,
                "side": side,
                "entry_at": entry_bar["t"],
                "exit_at": exit_bar["t"],
                "pnl": pnl,
                "move_pct": movement_pct,
                "non_overlap": i >= next_free,
            }
        )
        if i >= next_free:
            next_free = i + horizon + 1
    return trades


def summarize(trades, initial_capital=10000.0):
    if not trades:
        return {
            "trades": 0,
            "net_usd": 0.0,
            "win_rate_pct": None,
            "profit_factor": None,
            "avg_usd": None,
            "median_usd": None,
            "avg_move_pct": None,
            "max_drawdown_usd": 0.0,
            "net_pct_capital": 0.0,
            "non_overlap_trades": 0,
            "non_overlap_net_usd": 0.0,
            "by_symbol": {},
        }
    ordered = sorted(trades, key=lambda t: (t["exit_at"], t["symbol"]))
    profits = [t["pnl"] for t in ordered]
    wins = [p for p in profits if p > 0]
    losses = [p for p in profits if p < 0]
    total = peak = drawdown = 0.0
    for trade in ordered:
        total += trade["pnl"]
        peak = max(peak, total)
        drawdown = max(drawdown, peak - total)
    non_overlap = [t for t in ordered if t["non_overlap"]]
    by_symbol = defaultdict(float)
    for trade in ordered:
        by_symbol[trade["symbol"]] += trade["pnl"]
    return {
        "trades": len(ordered),
        "net_usd": round(sum(profits), 2),
        "win_rate_pct": round(100 * len(wins) / len(ordered), 1),
        "profit_factor": round(sum(wins) / -sum(losses), 2) if losses else None,
        "avg_usd": round(sum(profits) / len(ordered), 4),
        "median_usd": round(median(profits), 4),
        "avg_move_pct": round(sum(t["move_pct"] for t in ordered) / len(ordered), 4),
        "max_drawdown_usd": round(drawdown, 2),
        "net_pct_capital": round(100 * sum(profits) / initial_capital, 2),
        "non_overlap_trades": len(non_overlap),
        "non_overlap_net_usd": round(sum(t["pnl"] for t in non_overlap), 2),
        "by_symbol": {
            symbol: round(value, 2) for symbol, value in sorted(by_symbol.items())
        },
    }


def load_major_daily():
    data = {}
    for symbol in MAJORS:
        path = ROOT / f"trend-{symbol.lower()}-d1-2014-2025.json"
        if not path.exists():
            continue
        raw = json.loads(path.read_text())
        bars = [
            {
                "t": int(bar["timestamp"] / 1000),
                "o": float(bar["open"]),
                "h": float(bar["high"]),
                "l": float(bar["low"]),
                "c": float(bar["close"]),
            }
            for bar in raw
        ]
        data[symbol] = [bar for bar in bars if bar["t"] >= 1451606400]
    return data


def evaluate_dataset(data, specs, segments):
    results = {}
    for segment_name, (start, end) in segments.items():
        for horizon in HORIZONS:
            trades = []
            for symbol, bars in data.items():
                tick_size, tick_value, tick_loss = specs[symbol][:3]
                spread = specs[symbol][3]
                window = [bar for bar in bars if start <= bar["t"] < end]
                if len(window) <= BB_PERIOD + horizon:
                    continue
                trades.extend(
                    simulate(
                        symbol,
                        window,
                        tick_size,
                        tick_value,
                        tick_loss,
                        spread,
                        horizon,
                    )
                )
            results[f"{segment_name}:{horizon}"] = summarize(trades)
    return results


def markdown_table(title, results, segment_names):
    lines = [f"### {title}", ""]
    header = ["Dias", "Trades", "Net USD", "Média USD", "Acerto", "PF", "Mov. médio", "DD trades"]
    for segment in segment_names:
        header.extend([f"{segment} net USD", f"{segment} acerto"])
    lines.append("| " + " | ".join(header) + " |")
    lines.append("|" + "|".join(["---:"] * len(header)) + "|")
    for horizon in HORIZONS:
        row = [
            str(horizon),
            str(results[f"full:{horizon}"]["trades"]),
            f"{results[f'full:{horizon}']['net_usd']:.2f}",
            f"{results[f'full:{horizon}']['avg_usd']:.4f}",
            f"{results[f'full:{horizon}']['win_rate_pct']:.1f}%",
            f"{results[f'full:{horizon}']['profit_factor']:.2f}",
            f"{results[f'full:{horizon}']['avg_move_pct']:.3f}%",
            f"{results[f'full:{horizon}']['max_drawdown_usd']:.2f}",
        ]
        for segment in segment_names:
            data = results[f"{segment}:{horizon}"]
            row.extend([f"{data['net_usd']:.2f}", f"{data['win_rate_pct']:.1f}%"])
        lines.append("| " + " | ".join(row) + " |")
    lines.append("")
    lines.append(
        "Sobreposição: todos os sinais entram; cada trade usa 0,01 lote. "
        "`DD trades` é a soma corrida ordenada pela saída, não uma curva de capital real."
    )
    lines.append("")
    return lines


def main():
    majors = load_major_daily()
    major_specs = {
        symbol: (*MAJOR_TICKS[symbol], MAJOR_SPREADS[symbol]) for symbol in majors
    }
    major_results = evaluate_dataset(
        majors,
        major_specs,
        {
            "full": (1451606400, 1767225600),
            "train": (1451606400, 1672531200),
            "holdout": (1672531200, 1767225600),
        },
    )

    mt5_path = os.environ.get("MT5_D1_SNAPSHOT")
    mt5_results = None
    mt5_symbols = None
    mt5_start = mt5_end = None
    if mt5_path and Path(mt5_path).exists():
        raw = json.loads(Path(mt5_path).read_text())
        symbols_path = Path(mt5_path).with_name("mt5-symbols-12-2026-11-16.json")
        states = json.loads(symbols_path.read_text()) if symbols_path.exists() else {}
        mt5_data = {}
        mt5_specs = {}
        for symbol, bars in raw.items():
            if not bars or symbol not in states:
                continue
            state = states[symbol]
            mt5_data[symbol] = bars
            mt5_specs[symbol] = (
                float(state["tickSize"]),
                float(state["tickValue"]),
                float(state.get("tickValueLoss", state["tickValue"])),
                float(max(state.get("spread", 0), 0)),
            )
        if mt5_data:
            all_times = [bar["t"] for bars in mt5_data.values() for bar in bars]
            mt5_start, mt5_end = min(all_times), max(all_times)
            mt5_results = evaluate_dataset(
                mt5_data,
                mt5_specs,
                {"full": (mt5_start, mt5_end + 86400)},
            )
            mt5_symbols = sorted(mt5_data)

    output = {
        "method": "BB(20,2)/RSI(14,20/80) on closed D1 candles; entry next open; exit close after N trading days; 0.01 lot; spread plus one adverse tick per fill; overlapping signals measured; research only.",
        "parameters": {
            "bollinger_length": BB_PERIOD,
            "bollinger_deviation": BB_DEVIATION,
            "rsi_length": RSI_PERIOD,
            "rsi_oversold": RSI_OVERSOLD,
            "rsi_overbought": RSI_OVERBOUGHT,
            "horizons_days": list(HORIZONS),
        },
        "majors_2016_2025": {
            "symbols": sorted(majors),
            "source": "reports/trend-<symbol>-d1-2014-2025.json",
            "results": major_results,
        },
        "mt5_12_symbols": {
            "symbols": mt5_symbols,
            "source": mt5_path,
            "range": [mt5_start, mt5_end] if mt5_start else None,
            "results": mt5_results,
        },
        "limitations": [
            "Daily bars cannot reveal intrabar path; no stop/target is used here, only time exit.",
            "The majors sample is Dukascopy bid daily data; spreads are fixed near current observed medians.",
            "The 12-symbol MT5 sample is limited to the 400 daily bars cached by the terminal.",
            "Overlapping trades are a signal study, not a fundable equity curve; non-overlap values are included in JSON.",
        ],
    }
    json_path = ROOT / "holding-period-backtest-2026-11-16.json"
    json_path.write_text(json.dumps(output, indent=2) + "\n")

    lines = [
        "# Backtest por horizonte — 1 a 7 dias",
        "",
        "Sinal BB+RSI (mesma regra do estudo M30), aplicado em candles diários. "
        "Entrada na abertura seguinte, saída no fechamento após N dias, 0,01 lote, "
        "spread e um tick adverso por execução. Trades sobrepostos: cada sinal é medido.",
        "",
        "## Majors — D1, 2016–2025",
        "",
    ]
    lines.extend(markdown_table("Resultado por dias", major_results, ["train", "holdout"]))
    lines.append("Símbolos: " + ", ".join(sorted(majors)) + ".")
    lines.append("")
    if mt5_results:
        lines.extend(["## 12 símbolos MT5 — D1, ~2025-05 a 2026-11", ""])
        lines.extend(markdown_table("Resultado por dias", mt5_results, []))
        lines.append("Símbolos: " + ", ".join(mt5_symbols) + ".")
        lines.append("")
    lines.extend(
        [
            "## Leitura",
            "",
            "- O net USD é a soma dos trades hipotéticos, não o retorno de uma conta com capital fixo.",
            "- Compare principalmente o **net USD por trade** e o **acerto** entre horizontes.",
            "- Amostras diárias e custos fixos: não use isto como garantia de resultado futuro.",
            "",
        ]
    )
    md_path = ROOT / "holding-period-backtest-2026-11-16.md"
    md_path.write_text("\n".join(lines))
    print(f"Wrote {json_path.relative_to(ROOT.parent)} and {md_path.relative_to(ROOT.parent)}")
    for horizon in HORIZONS:
        row = major_results[f"full:{horizon}"]
        print(
            f"majors {horizon}d: trades={row['trades']} net=${row['net_usd']:.2f} "
            f"avg=${row['avg_usd']:.4f} win={row['win_rate_pct']:.1f}% "
            f"pf={row['profit_factor']:.2f} nonoverlap=${row['non_overlap_net_usd']:.2f}"
        )
    if mt5_results:
        for horizon in HORIZONS:
            row = mt5_results[f"full:{horizon}"]
            print(
                f"mt5-12 {horizon}d: trades={row['trades']} net=${row['net_usd']:.2f} "
                f"avg=${row['avg_usd']:.4f} win={row['win_rate_pct']:.1f}% "
                f"pf={row['profit_factor']:.2f} nonoverlap=${row['non_overlap_net_usd']:.2f}"
            )


if __name__ == "__main__":
    main()
