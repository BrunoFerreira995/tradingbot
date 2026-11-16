#!/usr/bin/env python3
"""Gera gráficos SVG a partir dos relatórios de backtest em reports/."""

from __future__ import annotations

import html
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "reports"
OUT = ROOT / "docs" / "screenshots"

COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626"]
INK = "#0f172a"
MUTED = "#64748b"
GRID = "#e2e8f0"
BG = "#ffffff"


def esc(value: object) -> str:
    return html.escape(str(value))


def fmt_usd(value: float) -> str:
    sign = "-" if value < 0 else ""
    return f"{sign}${abs(value):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def nice_ticks(lo: float, hi: float, count: int = 5) -> list[float]:
    if hi == lo:
        hi = lo + 1
    raw = (hi - lo) / max(count - 1, 1)
    power = 10 ** math.floor(math.log10(abs(raw)))
    for factor in (1, 2, 2.5, 5, 10):
        step = factor * power
        if raw <= step:
            break
    start = math.floor(lo / step) * step
    end = math.ceil(hi / step) * step
    ticks = []
    value = start
    while value <= end + step * 0.001:
        ticks.append(value)
        value += step
    return ticks


def grouped_bar_chart(
    path: Path,
    title: str,
    subtitle: str,
    categories: list[str],
    series: list[tuple[str, list[float]]],
    footnotes: list[str] | None = None,
    width: int = 960,
    height: int = 580,
) -> None:
    left, right, top, bottom = 84, 36, 128, 126
    plot_w = width - left - right
    plot_h = height - top - bottom

    values = [value for _, group in series for value in group]
    hi = max(values + [0.0])
    lo = min(values + [0.0])
    padding = max((hi - lo) * 0.14, 0.5)
    ticks = nice_ticks(lo - padding, hi + padding, 6)
    y_min, y_max = ticks[0], ticks[-1]

    def y(value: float) -> float:
        return top + (y_max - value) / (y_max - y_min) * plot_h

    zero = y(0)
    group_count = max(len(series), 1)
    category_width = plot_w / len(categories)
    bar_width = min(category_width * 0.72 / group_count, 58)
    group_width = bar_width * group_count + 8 * (group_count - 1)

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{esc(title)}">',
        f'<rect width="{width}" height="{height}" fill="{BG}"/>',
        f'<text x="{left}" y="42" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif" font-size="24" font-weight="700" fill="{INK}">{esc(title)}</text>',
        f'<text x="{left}" y="68" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif" font-size="13" fill="{MUTED}">{esc(subtitle)}</text>',
    ]

    legend_x = left
    for index, (name, _) in enumerate(series):
        color = COLORS[index % len(COLORS)]
        box_y = 86
        parts.append(f'<rect x="{legend_x}" y="{box_y}" width="12" height="12" rx="2" fill="{color}"/>')
        parts.append(
            f'<text x="{legend_x + 18}" y="{box_y + 11}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="12" fill="{INK}">{esc(name)}</text>'
        )
        legend_x += 18 + len(name) * 7 + 26

    for tick in ticks:
        ty = y(tick)
        parts.append(f'<line x1="{left}" y1="{ty:.1f}" x2="{width - right}" y2="{ty:.1f}" stroke="{GRID}" stroke-width="1"/>')
        parts.append(
            f'<text x="{left - 12}" y="{ty + 4:.1f}" text-anchor="end" font-family="ui-monospace,monospace" font-size="11" fill="{MUTED}">{fmt_usd(tick)}</text>'
        )

    parts.append(f'<line x1="{left}" y1="{zero:.1f}" x2="{width - right}" y2="{zero:.1f}" stroke="{INK}" stroke-width="1.4"/>')

    for cat_index, category in enumerate(categories):
        center = left + category_width * (cat_index + 0.5)
        start = center - group_width / 2
        for series_index, (_, group) in enumerate(series):
            value = group[cat_index]
            bar_x = start + series_index * (bar_width + 8)
            bar_y = y(value) if value >= 0 else zero
            bar_h = max(abs(zero - y(value)), 1)
            color = COLORS[series_index % len(COLORS)]
            parts.append(
                f'<rect x="{bar_x:.1f}" y="{bar_y:.1f}" width="{bar_width:.1f}" height="{bar_h:.1f}" rx="3" fill="{color}" fill-opacity="0.9"/>'
            )
            label_y = bar_y - 7 if value >= 0 else bar_y + bar_h + 15
            weight = "700" if value >= 0 else "600"
            parts.append(
                f'<text x="{bar_x + bar_width / 2:.1f}" y="{label_y:.1f}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="11" font-weight="{weight}" fill="{INK}">{fmt_usd(value)}</text>'
            )
        parts.append(
            f'<text x="{center:.1f}" y="{top + plot_h + 34:.1f}" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13" font-weight="600" fill="{INK}">{esc(category)}</text>'
        )
        if footnotes:
            parts.append(
                f'<text x="{center:.1f}" y="{top + plot_h + 52:.1f}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="10" fill="{MUTED}">{esc(footnotes[cat_index])}</text>'
            )

    parts.append(
        f'<text x="{left}" y="{height - 18}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="10" fill="{MUTED}">Resultados históricos de pesquisa. Não são garantia de resultado futuro.</text>'
    )
    parts.append("</svg>")
    path.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)}")


def strategy_chart() -> None:
    report = json.loads((REPORTS / "strategy-backtests-2026-11-04.json").read_text())
    labels = {
        "sma_micro_trend": "SMA Micro Trend",
        "dow_theory": "Dow Theory",
        "meanrev-bb-rsi-v1": "MeanRev BB+RSI",
    }
    categories: list[str] = []
    train: list[float] = []
    holdout: list[float] = []
    holdout_stress: list[float] = []
    notes: list[str] = []

    for key, label in labels.items():
        top = report["strategies"][key]["top_by_train_net"][0]
        categories.append(label)
        train.append(top["train"]["net_usd"])
        holdout.append(top["holdout"]["net_usd"])
        holdout_stress.append(top["holdout_1_5x_spread"]["net_usd"])
        notes.append(
            f"n={top['train']['trades']} / {top['holdout']['trades']} / {top['holdout_1_5x_spread']['trades']}"
        )

    grouped_bar_chart(
        OUT / "09-backtest-strategies.svg",
        "Backtest por estratégia — melhor candidato no treino",
        "0,01 lote · divisão cronológica 60% treino / 40% holdout · resultado líquido em USD · n = treino / holdout / holdout 1,5x spread",
        categories,
        [
            ("Treino", train),
            ("Holdout", holdout),
            ("Holdout 1,5x spread", holdout_stress),
        ],
        notes,
    )


def meanrev_chart() -> None:
    report = json.loads((REPORTS / "meanrev-timeframe-backtest-2026-11-04.json").read_text())
    categories = list(report["timeframes"].keys())
    train = [report["timeframes"][tf]["train"]["net_usd"] for tf in categories]
    holdout = [report["timeframes"][tf]["holdout"]["net_usd"] for tf in categories]
    stress = [report["timeframes"][tf]["holdout_1_5x_spread"]["net_usd"] for tf in categories]
    notes = [
        f"n={report['timeframes'][tf]['train']['trades']} / {report['timeframes'][tf]['holdout']['trades']} / {report['timeframes'][tf]['holdout_1_5x_spread']['trades']}"
        for tf in categories
    ]

    grouped_bar_chart(
        OUT / "10-backtest-meanrev-timeframes.svg",
        "Mean reversal BB+RSI por timeframe",
        "Parâmetros fixos (BB 20 / 2,0 · RSI 14 · stop 0,2% · alvo 2R) · 0,01 lote · resultado líquido em USD",
        categories,
        [
            ("Treino", train),
            ("Holdout", holdout),
            ("Holdout 1,5x spread", stress),
        ],
        notes,
    )


def market_forces_chart() -> None:
    report = json.loads((REPORTS / "market-forces-backtest-2026-11-13.json").read_text())
    rows = {(row["timeframe"], row["scenario"]): row for row in report["results"]}
    categories = list(dict.fromkeys(row["timeframe"] for row in report["results"]))
    base = [rows[(tf, "base")]["netUsd"] for tf in categories]
    stress = [rows[(tf, "stress")]["netUsd"] for tf in categories]
    notes = [
        f"n={rows[(tf, 'base')]['tradeCount']} / {rows[(tf, 'stress')]['tradeCount']}"
        for tf in categories
    ]

    grouped_bar_chart(
        OUT / "11-backtest-market-forces.svg",
        "Market Forces por timeframe",
        "Cenário base e estresse de spread · 0,01 lote · resultado líquido em USD · n = base / estresse",
        categories,
        [("Base", base), ("Estresse", stress)],
        notes,
    )


def diversified_trend_chart() -> None:
    report = json.loads((REPORTS / "diversified-trend-optimization-2016-2025.json").read_text())
    names = {
        "selected_portfolio": "Portfólio selecionado",
        "default_portfolio": "Portfólio padrão",
        "selected_GBPUSD": "GBPUSD selecionado",
    }
    rows = {(row["split"], row["scenario"], row["name"]): row for row in report["comparisons"]}
    categories = list(names.values())
    base = [rows[("test", "base", key)]["netUsd"] for key in names]
    stress = [rows[("test", "stress", key)]["netUsd"] for key in names]
    notes = [
        f"n={rows[('test', 'base', key)]['tradeCount']}"
        for key in names
    ]

    grouped_bar_chart(
        OUT / "12-backtest-diversified-trend.svg",
        "Diversified Trend — período de teste",
        "Estratégia não aprovada na validação · cenário base e estresse · resultado líquido em USD no teste",
        categories,
        [("Base", base), ("Estresse", stress)],
        notes,
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    strategy_chart()
    meanrev_chart()
    market_forces_chart()
    diversified_trend_chart()


if __name__ == "__main__":
    main()
