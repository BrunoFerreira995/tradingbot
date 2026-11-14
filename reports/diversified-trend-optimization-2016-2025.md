# Tendência diversificada — busca limitada e benchmark

Fonte: Dukascopy bid daily UTC, 2014–2025. Capital inicial: USD 10000. Avaliação: 2016–2025; 2014–2015 warmup only.
Configurações: 72; qualificadas treino: 0; validação: 0; critérios finais atendidos: NÃO.

## Conclusão

Nenhuma configuração foi aprovada ao final. O candidato abaixo é apenas um fallback exploratório, não um conjunto validado para execução.
Diversificação e dimensionamento de risco podem reduzir concentração sem criar uma fonte de retorno positivo. Esta é uma adaptação de tendência, não reprodução da carteira multiclasse dos artigos.

## Configuração selecionada

```json
{
  "lookback": 252,
  "volatilityPeriod": 60,
  "minimumScore": 0.5,
  "stopAtr": 4,
  "rewardRisk": 6,
  "annualRiskBudget": 0.1,
  "maximumGrossLeverage": 2
}
```

| Seleção (stress) | Trades | P&L USD | Sharpe | DD diário | PF |
|---|---:|---:|---:|---:|---:|
| train | 300 | -796.57 | -0.51 | 12.56% | 0.69 |
| validation | 110 | -218.26 | -0.17 | 7.86% | 0.84 |

## Benchmark com orçamento de risco comparável

| Janela | Cenário | Estratégia | P&L USD | Retorno | CAGR | Sharpe | DD diário | Trades | Acerto | PF |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| test | base | selected_portfolio | -388.90 | -3.89% | -1.31% | -0.42 | 6.33% | 202 | 32.67% | 0.72 |
| test | base | default_portfolio | -1227.44 | -12.27% | -4.27% | -0.96 | 15.11% | 310 | 30.32% | 0.56 |
| test | base | selected_GBPUSD | -1582.27 | -15.82% | -5.58% | -0.85 | 20.20% | 28 | 21.43% | 0.28 |
| test | stress | selected_portfolio | -677.59 | -6.78% | -2.31% | -0.75 | 8.52% | 202 | 31.19% | 0.55 |
| test | stress | default_portfolio | -1718.42 | -17.18% | -6.09% | -1.39 | 18.56% | 310 | 27.42% | 0.42 |
| test | stress | selected_GBPUSD | -1887.18 | -18.87% | -6.73% | -1.03 | 22.75% | 28 | 21.43% | 0.23 |
| full | base | selected_portfolio | -402.99 | -4.03% | -0.41% | -0.09 | 9.76% | 598 | 31.77% | 0.91 |
| full | base | default_portfolio | -1599.20 | -15.99% | -1.73% | -0.36 | 20.91% | 947 | 30.83% | 0.82 |
| full | base | selected_GBPUSD | -171.24 | -1.71% | -0.17% | 0.02 | 25.48% | 70 | 30.00% | 0.97 |
| full | stress | selected_portfolio | -1586.43 | -15.86% | -1.71% | -0.46 | 18.03% | 598 | 29.60% | 0.68 |
| full | stress | default_portfolio | -3094.94 | -30.95% | -3.64% | -0.81 | 33.37% | 933 | 27.55% | 0.66 |
| full | stress | selected_GBPUSD | -1453.32 | -14.53% | -1.56% | -0.15 | 28.37% | 70 | 27.14% | 0.79 |

## Resultado anual — selecionada, carteira, base (inclui treino)

| Ano | P&L USD | Retorno anual |
|---|---:|---:|
| 2016 | -110.90 | -1.11% |
| 2017 | -70.13 | -0.71% |
| 2018 | -390.25 | -3.97% |
| 2019 | -140.72 | -1.49% |
| 2020 | 511.29 | 5.50% |
| 2021 | -374.49 | -3.82% |
| 2022 | 561.90 | 5.96% |
| 2023 | -303.95 | -3.04% |
| 2024 | 34.49 | 0.36% |
| 2025 | -120.23 | -1.24% |

## Contribuição por par — teste2023–25, stress (trades fechados)

- AUDUSD: USD -76.45.
- EURUSD: USD -214.57.
- GBPUSD: USD -201.97.
- NZDUSD: USD -175.68.
- USDCAD: USD -11.81.
- USDCHF: USD 120.25.
- USDJPY: USD -117.36.

## Premissas e limites

- Trend-inspired adaptation, NOT replication of Moskowitz/Ooi/Pedersen: spot Forex rather than diversified futures, with ATR SL/TP and discrete lots.
- Seven USD majors are correlated; risk budget 10% is sum of standalone volatility budgets, NOT predicted portfolio volatility. Gross leverage capped at entry to 2x; exposures drift between entries.
- Sizing at entry only, no daily rebalancing; 10000 USD start for every split, 0.01 lot minimum/step, 100000 base currency per lot.
- USD-base currency profits converted at exit quote. Cash, realized trades and funding reconciled. MTM equity used for portfolio DD/Sharpe; DD is DAILY CLOSE, not intraday risk.
- Daily volatility from log returns, annualization 252; momentum 63/126/252 sessions. UTC Sunday merged into Monday, research session calendar differs from MT5 server daily candles.
- Indicators warmed up from past data; entries next open; no future prices enter features. Stop/target at entry, same-bar stop-first, gaps adverse for SL and no favorable TP gap improvement.
- Base commissions USD 7/lot round trip, archived fixed median spreads, zero slippage, NO swap. Stress spread1.5x, slippage0.1x base spread, commission USD10/lot, negative financing2% annual gross notional.
- Funding stress is a hypothetical uniformly negative drag, NOT actual historical swaps or interest differentials. Base results without swap are optimistic for long holds.
- Selection under stress: train2016–20, min60 trades/PF1.05/positive net/DD<=20%; top12 to validation2021–22, min20 trades/PF1.05/positive net. Score Sharpe minus DD fraction.
- Only 72 configurations; no per-pair parameter fitting or removal of losing symbols. Test2023–25 used only after selection froze. GBPUSD aggregate periods have been viewed previously; not pristine independent validation.
- Full2016–25 includes training and selection periods: descriptive, not out-of-sample. GBPUSD alone uses same total budget as portfolio, not same lot.
- Not a full trading-engine replay: broker market hours, account-specific risk limits, execution failures, riskPercentage/monetary-stop overrides not reproduced.
- Candidate config is saved for research, not promoted automatically to live settings. Positive backtest does not establish a persistent edge.
