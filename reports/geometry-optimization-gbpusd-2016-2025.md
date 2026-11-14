# Otimização geométrica — GBPUSD H1, 2016–2025

Configurações: 486. Aprovadas no treino: 57. Aprovadas na validação: 5. Critérios de seleção atendidos: SIM.
Resultado no teste temporal final aprovado: NÃO.

## Conclusão

O candidato selecionado não sustentou vantagem no teste temporal. Não há base para promover esta configuração à execução automática.
A remoção diagnóstica do determinante no teste produziu USD 44.60 contra USD -93.37 do candidato. Este contraste é retrospectivo e não autoriza selecionar novamente usando o teste.
A geometria reduziu perdas frente à regra original no teste, mas melhora relativa não equivale a rentabilidade. A busca e as comparações posteriores têm risco de sobreajuste.

## Parâmetros selecionados

```json
{
  "lookback": 32,
  "minSlope": 0.03,
  "minEfficiency": 0.2,
  "determinant": "DECELERATING",
  "stopAtr": 3,
  "rewardRisk": 3
}
```

| Janela | Custos | Trades otimizado/original | P&L otimizado/original USD | Acerto otimizado | PF otimizado | DD otimizado/original USD |
|---|---|---:|---:|---:|---:|---:|
| train | base | 191 / 652 | 86.50 / -55.73 | 24.6% | 1.09 | 129.87 / 255.66 |
| train | stress | 191 / 654 | 87.25 / -124.77 | 24.6% | 1.10 | 130.01 / 307.15 |
| validation | base | 70 / 272 | 49.93 / -26.76 | 28.6% | 1.16 | 73.19 / 88.76 |
| validation | stress | 70 / 270 | 49.33 / -33.38 | 28.6% | 1.16 | 73.28 / 95.04 |
| test | base | 132 / 408 | -84.42 / -257.76 | 24.2% | 0.85 | 183.17 / 269.83 |
| test | stress | 131 / 406 | -93.37 / -280.27 | 23.7% | 0.83 | 184.72 / 292.31 |

## Teste temporal 2023–2025 por ano — stress

| Ano | Trades | P&L USD |
|---|---:|---:|
| 2023 | 50 | -100.99 |
| 2024 | 37 | -13.70 |
| 2025 | 44 | 21.32 |

## Ablação no teste — stress

| Filtro removido | Trades | P&L USD | PF | DD USD |
|---|---:|---:|---:|---:|
| noDeterminant | 193 | 44.60 | 1.06 | 114.92 |
| noSlope | 132 | -93.82 | 0.83 | 176.09 |
| noEfficiency | 146 | -125.55 | 0.80 | 213.84 |

## Metodologia e limitações

- Retrospective temporal split: aggregate 2016–2025 results were already inspected previously. Test is NOT pristine independent evidence.
- No optimization against test-period outcomes; selected config frozen after train/validation before test evaluation.
- Features use only closed bars, 120-bar rolling ATR; regression slope ATR/candle, path efficiency and normalized 2x2 determinant.
- Determinant of unit vectors (1, earlySlope), (1, recentSlope) is sine of signed turning angle. Direction-aligned sign distinguishes acceleration/deceleration; not a probability.
- Geometry candidate replaces Dow structure gate with geometric filters, retaining SMA direction, candle pressure and friction <50. Original baseline retains its own Dow gate.
- Training search under stress; rank net P&L minus 0.5 drawdown, min 100 trades, P&L >0, PF>=1.05. Top 30 enter validation.
- Validation min 40 trades, P&L >0, PF>=1.05; rank same score. If none qualify, best fallback displayed explicitly, not approved.
- USD; 0.01 fixed lot; commission scenario USD 0.07 round trip, reserved at entry; swap not simulated.
- Base spread 1.2 pips; stress spread 1.8 pips and adverse slippage 0.12 pip per market fill; no historical variable spreads.
- Same OHLC stop-first/gap mechanics as prior research, conservative approximate monetary DD; no margin/daily-loss caps or capital depletion simulation.
- Each split starts flat and liquidates at its final close; past bars may warm up features. Last dataset candle excluded.
- Ablation on test is diagnostic only, not a new parameter selection. Live strategy/settings unchanged.
