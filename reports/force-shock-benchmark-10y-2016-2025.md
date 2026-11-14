# Benchmark — filtro de choque, GBPUSD H1, 2016–2025

Lote: 0,01. Choque ≥ 1.18; janela de 3 candles.

| Estratégia | Cenário | Trades | Acerto | P&L USD | PF | DD USD | Média/mês USD | Setups bloqueados por choque |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| market_forces | base | 1332 | 31.3% | -257.41 | 0.93 | 400.28 | -2.15 | 0 |
| market_forces_shock | base | 1289 | 30.9% | -323.37 | 0.91 | 440.20 | -2.69 | 476 |
| market_forces | stress | 1330 | 30.8% | -355.63 | 0.91 | 483.19 | -2.96 | 0 |
| market_forces_shock | stress | 1287 | 30.4% | -411.80 | 0.89 | 516.63 | -3.43 | 476 |

## Resultado anual (operações fechadas, USD)

| Ano | Original base | Choque base | Original stress | Choque stress |
|---|---:|---:|---:|---:|
| 2016 | 68.17 | 31.41 | 52.61 | 15.87 |
| 2017 | -47.10 | -44.59 | -75.58 | -75.68 |
| 2018 | -43.94 | -39.84 | -57.17 | -40.87 |
| 2019 | -42.43 | -87.54 | -44.11 | -89.25 |
| 2020 | 49.73 | 37.17 | 39.87 | 27.34 |
| 2021 | -22.07 | -47.65 | -27.75 | -53.30 |
| 2022 | 9.44 | 25.81 | 8.34 | 24.76 |
| 2023 | -102.58 | -83.06 | -115.80 | -96.22 |
| 2024 | -138.21 | -135.87 | -137.86 | -135.44 |
| 2025 | 11.58 | 20.79 | 1.81 | 11.00 |

## Posições abertas e sequência de perdas

- market_forces / base: P&L aberto USD 0.00; máxima sequência de perdas 17.
- market_forces_shock / base: P&L aberto USD 0.00; máxima sequência de perdas 16.
- market_forces / stress: P&L aberto USD 0.00; máxima sequência de perdas 17.
- market_forces_shock / stress: P&L aberto USD 0.00; máxima sequência de perdas 16.

## Premissas

- Dukascopy UTC bid candles, 62345 observations; same dataset as ten-year base benchmark.
- Only entry filter differs: shock threshold 1.18, cooldown 3 closed candles. Same evaluator as live strategy; same stops/targets and execution mechanics.
- Base spread 1.2 pips; stress spread 1.8 pips + adverse slippage 0.12 pip per market fill. Commission/swap excluded for comparability with initial ten-year benchmark.
- Conservative OHLC drawdown estimate; no margin/insolvency, engine monetary stops or daily-loss simulation.
- Threshold derived from this same historical dataset; retrospective comparison, NOT independent validation. No parameter search in this run.
- Shock blocked count measures candidate bar setups rejected by guard, not guaranteed missed executable trades; bars may overlap an open position.
- Open P&L separate; last dataset candle excluded, matching prior benchmark.
