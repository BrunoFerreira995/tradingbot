# Backtest — Market Forces

- Local MT5 snapshots, not fresh downloads; final candle excluded.
- Bid OHLC assumed. Entry at next bar open; one position per symbol; SL=2 ATR, TP=4 ATR.
- Fixed historical median spread per symbol; stress=1.5x spread + 0.1x base spread slippage per market fill.
- Commission, swap, margin, daily-loss caps, broker hours, engine monetary stop caps and live sizing NOT simulated.
- USD conversion uses archived tick values; not historical FX conversion.
- No tuning or parameter search. Timeframes overlap and must not be summed.
- Per-symbol drawdown is conservative OHLC-based; no portfolio drawdown inferred.

| Período | Cenário | Trades | P&L fechado USD | Acerto | PF | P&L aberto USD |
|---|---|---:|---:|---:|---:|---:|
| M1 | base | 0 | 0.00 | — | — | 0.00 |
| M1 | stress | 0 | 0.00 | — | — | 0.00 |
| M5 | base | 11 | -2.88 | 27.3% | 0.72 | 0.00 |
| M5 | stress | 5 | -0.14 | 40.0% | 0.97 | 0.00 |
| M15 | base | 36 | -12.42 | 27.8% | 0.69 | -0.40 |
| M15 | stress | 16 | -13.95 | 18.8% | 0.40 | -0.25 |
| M30 | base | 51 | -28.50 | 19.6% | 0.57 | -2.51 |
| M30 | stress | 26 | -18.41 | 19.2% | 0.55 | -1.58 |
| H1 | base | 51 | 20.23 | 35.3% | 1.31 | -2.64 |
| H1 | stress | 39 | 12.62 | 35.9% | 1.22 | -2.72 |

## Leitura dos resultados

- M5, M15 e M30 perderam no cenário base; M1 não operou por bloqueio de spread.
- H1 foi positivo nos dois cenários, com lucro concentrado em GBPUSD e USDCHF.
- Apenas 400 candles por ativo/período; cobertura diferente entre timeframes, sem validação independente fora da amostra.
- O cenário stress pode perder menos por bloquear mais entradas; não significa que custos maiores melhoram a estratégia.
- A amostra não sustenta concluir vantagem robusta. Nenhuma configuração de execução foi alterada pelo backtest.

## Cobertura por ativo (cenário base)

| Período | Ativo | Início UTC* | Fim UTC* | Candles | Trades | P&L USD | Bloqueios spread |
|---|---|---|---|---:|---:|---:|---:|
| M1 | EURUSD | 2026-11-04T17:50:00.000Z | 2026-11-05T00:30:00.000Z | 400 | 0 | 0.00 | 31 |
| M1 | USDJPY | 2026-11-04T17:46:00.000Z | 2026-11-05T00:30:00.000Z | 400 | 0 | 0.00 | 32 |
| M1 | USDCAD | 2026-11-04T17:50:00.000Z | 2026-11-05T00:30:00.000Z | 400 | 0 | 0.00 | 47 |
| M1 | AUDUSD | 2026-11-04T17:50:00.000Z | 2026-11-05T00:30:00.000Z | 400 | 0 | 0.00 | 23 |
| M1 | NZDUSD | 2026-11-04T17:46:00.000Z | 2026-11-05T00:30:00.000Z | 400 | 0 | 0.00 | 34 |
| M1 | USDCNH | 2026-11-04T17:49:00.000Z | 2026-11-05T00:30:00.000Z | 400 | 0 | 0.00 | 41 |
| M1 | Gasoline | 2026-11-04T17:19:00.000Z | 2026-11-04T23:57:00.000Z | 400 | 0 | 0.00 | 51 |
| M1 | GBPUSD | 2026-11-04T17:46:00.000Z | 2026-11-05T00:30:00.000Z | 400 | 0 | 0.00 | 22 |
| M1 | USDCHF | 2026-11-04T17:46:00.000Z | 2026-11-05T00:30:00.000Z | 400 | 0 | 0.00 | 30 |
| M5 | EURUSD | 2026-11-03T15:20:00.000Z | 2026-11-05T00:30:00.000Z | 400 | 5 | -3.09 | 9 |
| M5 | USDJPY | 2026-11-03T15:15:00.000Z | 2026-11-05T00:30:00.000Z | 400 | 4 | 3.57 | 17 |
| M5 | USDCAD | 2026-11-03T15:20:00.000Z | 2026-11-05T00:30:00.000Z | 400 | 0 | 0.00 | 40 |
| M5 | AUDUSD | 2026-11-03T15:20:00.000Z | 2026-11-05T00:30:00.000Z | 400 | 0 | 0.00 | 51 |
| M5 | NZDUSD | 2026-11-03T15:10:00.000Z | 2026-11-05T00:30:00.000Z | 400 | 0 | 0.00 | 41 |
| M5 | USDCNH | 2026-11-03T15:20:00.000Z | 2026-11-05T00:30:00.000Z | 400 | 0 | 0.00 | 41 |
| M5 | Gasoline | 2026-11-03T13:40:00.000Z | 2026-11-04T23:50:00.000Z | 400 | 0 | 0.00 | 19 |
| M5 | GBPUSD | 2026-11-03T15:15:00.000Z | 2026-11-05T00:30:00.000Z | 400 | 1 | -1.42 | 25 |
| M5 | USDCHF | 2026-11-03T15:10:00.000Z | 2026-11-05T00:30:00.000Z | 400 | 1 | -1.94 | 10 |
| M15 | EURUSD | 2026-10-29T20:45:00.000Z | 2026-11-05T00:15:00.000Z | 400 | 9 | -2.19 | 7 |
| M15 | USDJPY | 2026-10-29T20:45:00.000Z | 2026-11-05T00:15:00.000Z | 400 | 7 | -5.90 | 3 |
| M15 | USDCAD | 2026-10-29T20:45:00.000Z | 2026-11-05T00:15:00.000Z | 400 | 5 | 1.42 | 11 |
| M15 | AUDUSD | 2026-10-29T20:45:00.000Z | 2026-11-05T00:15:00.000Z | 400 | 2 | 1.21 | 14 |
| M15 | NZDUSD | 2026-10-29T20:45:00.000Z | 2026-11-05T00:15:00.000Z | 400 | 1 | -1.32 | 23 |
| M15 | USDCNH | 2026-10-29T20:45:00.000Z | 2026-11-05T00:15:00.000Z | 400 | 0 | 0.00 | 23 |
| M15 | Gasoline | 2026-10-29T16:00:00.000Z | 2026-11-04T23:30:00.000Z | 400 | 0 | 0.00 | 35 |
| M15 | GBPUSD | 2026-10-29T20:45:00.000Z | 2026-11-05T00:15:00.000Z | 400 | 6 | -4.87 | 6 |
| M15 | USDCHF | 2026-10-29T20:30:00.000Z | 2026-11-05T00:15:00.000Z | 400 | 6 | -0.77 | 2 |
| M30 | EURUSD | 2026-10-23T17:00:00.000Z | 2026-11-05T00:00:00.000Z | 400 | 10 | -3.86 | 0 |
| M30 | USDJPY | 2026-10-23T17:00:00.000Z | 2026-11-05T00:00:00.000Z | 400 | 7 | -5.85 | 0 |
| M30 | USDCAD | 2026-10-23T17:00:00.000Z | 2026-11-05T00:00:00.000Z | 400 | 7 | -7.96 | 0 |
| M30 | AUDUSD | 2026-10-23T17:00:00.000Z | 2026-11-05T00:00:00.000Z | 400 | 8 | -6.38 | 2 |
| M30 | NZDUSD | 2026-10-23T17:00:00.000Z | 2026-11-05T00:00:00.000Z | 400 | 4 | -5.32 | 15 |
| M30 | USDCNH | 2026-10-23T17:00:00.000Z | 2026-11-05T00:00:00.000Z | 400 | 0 | 0.00 | 20 |
| M30 | Gasoline | 2026-10-23T08:00:00.000Z | 2026-11-04T23:00:00.000Z | 400 | 0 | 0.00 | 39 |
| M30 | GBPUSD | 2026-10-23T17:00:00.000Z | 2026-11-05T00:00:00.000Z | 400 | 7 | 0.30 | 0 |
| M30 | USDCHF | 2026-10-23T16:30:00.000Z | 2026-11-05T00:00:00.000Z | 400 | 8 | 0.57 | 5 |
| H1 | EURUSD | 2026-10-13T09:00:00.000Z | 2026-11-04T23:00:00.000Z | 400 | 6 | -1.03 | 0 |
| H1 | USDJPY | 2026-10-13T09:00:00.000Z | 2026-11-04T23:00:00.000Z | 400 | 5 | -3.67 | 0 |
| H1 | USDCAD | 2026-10-13T09:00:00.000Z | 2026-11-04T23:00:00.000Z | 400 | 7 | -0.74 | 0 |
| H1 | AUDUSD | 2026-10-13T09:00:00.000Z | 2026-11-04T23:00:00.000Z | 400 | 6 | -5.82 | 0 |
| H1 | NZDUSD | 2026-10-13T09:00:00.000Z | 2026-11-04T23:00:00.000Z | 400 | 8 | -2.06 | 0 |
| H1 | USDCNH | 2026-10-13T09:00:00.000Z | 2026-11-04T23:00:00.000Z | 400 | 0 | 0.00 | 27 |
| H1 | Gasoline | 2026-10-12T15:00:00.000Z | 2026-11-04T22:00:00.000Z | 400 | 3 | 0.01 | 21 |
| H1 | GBPUSD | 2026-10-13T09:00:00.000Z | 2026-11-04T23:00:00.000Z | 400 | 9 | 16.84 | 0 |
| H1 | USDCHF | 2026-10-13T09:00:00.000Z | 2026-11-04T23:00:00.000Z | 400 | 7 | 16.70 | 0 |

*Conversão literal dos timestamps do snapshot; timezone original do servidor não validado.

Valores antes de comissão e swap. Resultado de pesquisa da regra de sinais, não reprodução completa do motor de risco.
