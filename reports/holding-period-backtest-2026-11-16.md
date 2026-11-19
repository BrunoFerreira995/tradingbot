# Backtest por horizonte — 1 a 7 dias

Sinal BB+RSI (mesma regra do estudo M30), aplicado em candles diários. Entrada na abertura seguinte, saída no fechamento após N dias, 0,01 lote, spread e um tick adverso por execução. Trades sobrepostos: cada sinal é medido.

## Majors — D1, 2016–2025

### Resultado por dias

| Dias | Trades | Net USD | Média USD | Acerto | PF | Mov. médio | DD trades | train net USD | train acerto | holdout net USD | holdout acerto |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 734 | 303.72 | 0.4138 | 51.6% | 1.17 | 0.037% | 369.18 | 200.11 | 50.9% | 103.61 | 54.1% |
| 2 | 734 | 310.30 | 0.4228 | 51.8% | 1.14 | 0.037% | 539.89 | 192.93 | 51.8% | 117.37 | 51.7% |
| 3 | 734 | 400.43 | 0.5456 | 52.6% | 1.15 | 0.056% | 636.49 | 252.04 | 51.6% | 148.40 | 55.8% |
| 4 | 734 | 586.74 | 0.7994 | 52.6% | 1.19 | 0.085% | 658.45 | 338.70 | 51.4% | 248.05 | 56.4% |
| 5 | 734 | 1014.70 | 1.3824 | 56.4% | 1.32 | 0.148% | 587.30 | 619.36 | 55.2% | 395.34 | 60.5% |
| 6 | 734 | 1388.55 | 1.8918 | 56.4% | 1.42 | 0.207% | 540.45 | 954.41 | 55.2% | 434.14 | 60.5% |
| 7 | 733 | 1611.59 | 2.1986 | 56.9% | 1.48 | 0.244% | 424.27 | 1137.87 | 56.2% | 473.72 | 59.1% |

Sobreposição: todos os sinais entram; cada trade usa 0,01 lote. `DD trades` é a soma corrida ordenada pela saída, não uma curva de capital real.

Símbolos: AUDUSD, EURUSD, GBPUSD, NZDUSD, USDCAD, USDCHF, USDJPY.

## 12 símbolos MT5 — D1, ~2025-05 a 2026-11

### Resultado por dias

| Dias | Trades | Net USD | Média USD | Acerto | PF | Mov. médio | DD trades |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 165 | 125.41 | 0.7601 | 47.9% | 1.06 | -0.207% | 960.24 |
| 2 | 164 | 81.40 | 0.4963 | 49.4% | 1.03 | -0.398% | 1281.62 |
| 3 | 163 | -217.01 | -1.3314 | 50.3% | 0.94 | -0.468% | 1534.79 |
| 4 | 163 | -935.19 | -5.7374 | 50.9% | 0.77 | -0.667% | 1980.94 |
| 5 | 163 | -230.44 | -1.4137 | 50.3% | 0.94 | -0.571% | 1944.11 |
| 6 | 163 | 87.78 | 0.5385 | 52.1% | 1.03 | -0.625% | 1750.04 |
| 7 | 163 | 253.78 | 1.5569 | 47.2% | 1.08 | -0.752% | 1888.19 |

Sobreposição: todos os sinais entram; cada trade usa 0,01 lote. `DD trades` é a soma corrida ordenada pela saída, não uma curva de capital real.

Símbolos: AUDUSD, BTCUSD, EURUSD, GBPUSD, Gasoline, NZDUSD, USDCAD, USDCHF, USDCNH, USDJPY, USDSEK, XAUUSD.

## Leitura

- O net USD é a soma dos trades hipotéticos, não o retorno de uma conta com capital fixo.
- Compare principalmente o **net USD por trade** e o **acerto** entre horizontes.
- Amostras diárias e custos fixos: não use isto como garantia de resultado futuro.
