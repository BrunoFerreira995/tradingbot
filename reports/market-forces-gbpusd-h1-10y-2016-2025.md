# GBPUSD H1 — backtest de 10 anos (2016–2025)

Fonte: Dukascopy public historical bid candles; dukascopy-node@1.51.1, UTC, volumes enabled, zero-volume flats excluded. Candles: 62345. Lote: 0,01.
SHA-256: `0a5e229f66dfd2dbd28db657750eeccaa883156e6989ee17b07aa6baf679d7c7`.

| Cenário | Trades | Acerto | P&L fechado USD | PF | DD estimado USD | Média/mês USD | Anos positivos |
|---|---:|---:|---:|---:|---:|---:|---:|
| base | 1332 | 31.3% | -257.41 | 0.93 | 400.28 | -2.15 | 4/10 |
| stress | 1330 | 30.8% | -355.63 | 0.91 | 483.19 | -2.96 | 4/10 |

## Conclusão

A regra atual apresentou prejuízo nos dois cenários em dez anos. O resultado positivo da amostra curta de 2026 não se sustentou neste histórico maior de outra fonte. A extrapolação anterior de aproximadamente USD 22/mês não é uma estimativa confiável de rendimento.
Nenhum parâmetro foi otimizado durante este teste; configurações de execução não foram alteradas.

## Resultados anuais (operações atribuídas ao ano de saída)

| Ano | Candles | Trades base/stress | Acerto base/stress | P&L base USD | P&L stress USD |
|---|---:|---:|---:|---:|---:|
| 2016 | 6240 | 126 / 125 | 38.1% / 37.6% | 68.17 | 52.61 |
| 2017 | 6225 | 126 / 129 | 30.2% / 28.7% | -47.10 | -75.58 |
| 2018 | 6226 | 128 / 129 | 30.5% / 29.5% | -43.94 | -57.17 |
| 2019 | 6226 | 129 / 129 | 32.6% / 32.6% | -42.43 | -44.11 |
| 2020 | 6249 | 142 / 141 | 35.2% / 34.8% | 49.73 | 39.87 |
| 2021 | 6240 | 137 / 135 | 30.7% / 30.4% | -22.07 | -27.75 |
| 2022 | 6240 | 136 / 136 | 33.1% / 33.1% | 9.44 | 8.34 |
| 2023 | 6223 | 130 / 130 | 25.4% / 24.6% | -102.58 | -115.80 |
| 2024 | 6250 | 135 / 132 | 24.4% / 24.2% | -138.21 | -137.86 |
| 2025 | 6226 | 143 / 144 | 32.9% / 31.9% | 11.58 | 1.81 |

## Distribuição e posições abertas

### base
- Média por trade: USD -0.19. Máxima sequência de perdas: 17.
- Meses positivos: 49/120. Melhor mês: 2020-03, USD 95.53. Pior: 2017-11, USD -40.65.
- P&L aberto ao final (separado): USD 0.00.
### stress
- Média por trade: USD -0.27. Máxima sequência de perdas: 17.
- Meses positivos: 48/120. Melhor mês: 2020-03, USD 95.50. Pior: 2017-11, USD -40.85.
- P&L aberto ao final (separado): USD 0.00.

## Cobertura

- 2016: 2016-01-03T22:00:00.000Z até 2016-12-30T21:00:00.000Z (6240 candles).
- 2017: 2017-01-01T22:00:00.000Z até 2017-12-29T21:00:00.000Z (6225 candles).
- 2018: 2018-01-01T22:00:00.000Z até 2018-12-31T21:00:00.000Z (6226 candles).
- 2019: 2019-01-01T22:00:00.000Z até 2019-12-31T21:00:00.000Z (6226 candles).
- 2020: 2020-01-01T22:00:00.000Z até 2020-12-31T21:00:00.000Z (6249 candles).
- 2021: 2021-01-03T22:00:00.000Z até 2021-12-31T21:00:00.000Z (6240 candles).
- 2022: 2022-01-02T22:00:00.000Z até 2022-12-30T21:00:00.000Z (6240 candles).
- 2023: 2023-01-01T23:00:00.000Z até 2023-12-29T21:00:00.000Z (6223 candles).
- 2024: 2024-01-01T22:00:00.000Z até 2024-12-31T21:00:00.000Z (6250 candles).
- 2025: 2025-01-01T22:00:00.000Z até 2025-12-31T21:00:00.000Z (6226 candles).
- Lacunas maiores que 96 horas: 0 (detalhes no JSON). Finais de semana e feriados não são preenchidos artificialmente.

## Premissas e limitações

- Rules unchanged; single continuous simulation per scenario, positions carry across years. Annual/monthly P&L assigned at exit.
- Same evaluateMarketForces and rolling 120-bar ATR as live runner. Signals use closed candles, fills next open.
- One position per symbol; stop 2 ATR; target 4 ATR; max spread 20% ATR; fixed 0.01 lot.
- USD tick specification 0.00001 / 1 USD per full lot; prices from Dukascopy, not the MT5 broker feed.
- Base fixed spread 1.2 pips. Stress spread 1.8 pips + 0.12 pip adverse slippage on market entries and stop exits.
- Costs are scenarios, NOT historical variable spreads. Commission and swap excluded; overnight holding can be material over ten years.
- No simulation of engine monetary stops, margin, daily-loss controls or insolvency; no capital-based return/CAGR implied.
- Stop wins if both stop/target touched; stops gap adversely; TP no favorable gap improvement.
- DD conservative sampled OHLC monetary estimate using close peaks/adverse intrabar lows, not exact tick equity DD.
- Final source candle excluded as in snapshot simulator; first 41 bars warm up. No optimization or independent validation claimed.
- Different data source from short benchmark: this is a robustness check, not an exact MT5 execution reproduction.
