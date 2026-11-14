# Benchmark por ativo — Market Forces

Ativos configurados: XAUUSD, EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD, NZDUSD, USDCNH, USDSEK, BTCUSD, Gasoline.

Comparação da mesma estratégia entre ativos e timeframes, sem otimização de parâmetros. Lote fixo de 0,01; valores USD antes de comissão e swap. Base inclui spread; stress usa spread 1,5× e slippage. P&L aberto é separado.

## Matriz de resultado fechado: base / stress (USD)

| Ativo | M1 | M5 | M15 | M30 | H1 |
|---|---:|---:|---:|---:|---:|
| XAUUSD | SEM DADOS | SEM DADOS | SEM DADOS | SEM DADOS | SEM DADOS |
| EURUSD | 0.00 / 0.00 | -3.09 / -3.19 | -2.19 / -5.28 | -3.86 / -6.63 | -1.03 / -9.81 |
| GBPUSD | 0.00 / 0.00 | -1.42 / 0.00 | -4.87 / -7.53 | 0.30 / -0.23 | 16.84 / 19.37 |
| USDJPY | 0.00 / 0.00 | 3.57 / 5.22 | -5.90 / -4.86 | -5.85 / -5.90 | -3.67 / -3.70 |
| USDCHF | 0.00 / 0.00 | -1.94 / -2.17 | -0.77 / 1.31 | 0.57 / -2.87 | 16.70 / 11.71 |
| USDCAD | 0.00 / 0.00 | 0.00 / 0.00 | 1.42 / 2.41 | -7.96 / -2.77 | -0.74 / -0.82 |
| AUDUSD | 0.00 / 0.00 | 0.00 / 0.00 | 1.21 / 0.00 | -6.38 / 0.00 | -5.82 / -5.87 |
| NZDUSD | 0.00 / 0.00 | 0.00 / 0.00 | -1.32 / 0.00 | -5.32 / 0.00 | -2.06 / 1.75 |
| USDCNH | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 |
| USDSEK | SEM DADOS | SEM DADOS | SEM DADOS | SEM DADOS | SEM DADOS |
| BTCUSD | SEM DADOS | SEM DADOS | SEM DADOS | SEM DADOS | SEM DADOS |
| Gasoline | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 | 0.00 / 0.00 | 0.01 / 0.00 |

## Melhor timeframe observado por ativo (ordenado pelo resultado stress)

**Seleção retrospectiva na mesma amostra, não recomendação validada.** Ranking exige trades fechados nos dois cenários. Zero trades não demonstra desempenho positivo. Não somar timeframes sobrepostos.

| Ativo | Timeframe | Trades base/stress | USD base | USD stress |
|---|---|---:|---:|---:|
| GBPUSD | H1 | 9 / 8 | 16.84 | 19.37 |
| USDCHF | H1 | 7 / 5 | 16.70 | 11.71 |
| USDJPY | M5 | 4 / 2 | 3.57 | 5.22 |
| USDCAD | M15 | 5 / 1 | 1.42 | 2.41 |
| NZDUSD | H1 | 8 / 2 | -2.06 | 1.75 |
| EURUSD | M5 | 5 / 2 | -3.09 | -3.19 |
| AUDUSD | H1 | 6 / 6 | -5.82 | -5.87 |
| XAUUSD | SEM DADOS | — / — | — | — |
| USDCNH | SEM TRADES NOS DOIS CENÁRIOS | — / — | — | — |
| USDSEK | SEM DADOS | — / — | — | — |
| BTCUSD | SEM DADOS | — / — | — | — |
| Gasoline | SEM TRADES NOS DOIS CENÁRIOS | — / — | — | — |

## Detalhes por ativo e timeframe

| Ativo | TF | Trades base/stress | Acerto base | PF base/stress | DD ativo base USD* | USD aberto base/stress | Sinais / bloqueios spread base |
|---|---|---:|---:|---:|---:|---:|---:|
| EURUSD | M1 | 0 / 0 | — | — / — | 0.00 | 0.00 / 0.00 | 31 / 31 |
| EURUSD | M5 | 5 / 2 | 20.0% | 0.43 / 0.00 | 5.42 | 0.00 / 0.00 | 26 / 9 |
| EURUSD | M15 | 9 / 3 | 33.3% | 0.78 / 0.00 | 7.05 | 0.00 / -0.25 | 36 / 7 |
| EURUSD | M30 | 10 / 6 | 30.0% | 0.73 / 0.42 | 8.54 | 0.00 / 0.00 | 22 / 0 |
| EURUSD | H1 | 6 / 6 | 33.3% | 0.91 / 0.30 | 10.39 | 0.00 / 0.00 | 21 / 0 |
| GBPUSD | M1 | 0 / 0 | — | — / — | 0.00 | 0.00 / 0.00 | 22 / 22 |
| GBPUSD | M5 | 1 / 0 | 0.0% | 0.00 / — | 1.42 | 0.00 / 0.00 | 26 / 25 |
| GBPUSD | M15 | 6 / 4 | 16.7% | 0.39 / 0.00 | 8.64 | 0.04 / 0.00 | 28 / 6 |
| GBPUSD | M30 | 7 / 4 | 28.6% | 1.04 / 0.96 | 6.13 | -0.50 / -0.57 | 21 / 0 |
| GBPUSD | H1 | 9 / 8 | 55.6% | 2.68 / 3.58 | 7.41 | -0.65 / -0.72 | 25 / 0 |
| USDJPY | M1 | 0 / 0 | — | — / — | 0.00 | 0.00 / 0.00 | 32 / 32 |
| USDJPY | M5 | 4 / 2 | 50.0% | 3.17 / — | 1.55 | 0.00 / 0.00 | 40 / 17 |
| USDJPY | M15 | 7 / 6 | 14.3% | 0.33 / 0.38 | 6.40 | 0.00 / 0.00 | 27 / 3 |
| USDJPY | M30 | 7 / 7 | 14.3% | 0.36 / 0.36 | 9.14 | 0.00 / 0.00 | 17 / 0 |
| USDJPY | H1 | 5 / 5 | 20.0% | 0.60 / 0.60 | 8.27 | 0.00 / 0.00 | 25 / 0 |
| USDCHF | M1 | 0 / 0 | — | — / — | 0.00 | 0.00 / 0.00 | 30 / 30 |
| USDCHF | M5 | 1 / 1 | 0.0% | 0.00 / 0.00 | 4.29 | 0.00 / 0.00 | 14 / 10 |
| USDCHF | M15 | 6 / 2 | 33.3% | 0.91 / 1.47 | 5.73 | 0.00 / 0.00 | 27 / 2 |
| USDCHF | M30 | 8 / 7 | 37.5% | 1.05 / 0.76 | 9.97 | 0.00 / 0.00 | 21 / 5 |
| USDCHF | H1 | 7 / 5 | 57.1% | 3.28 / 3.08 | 7.56 | 0.00 / 0.00 | 21 / 0 |
| USDCAD | M1 | 0 / 0 | — | — / — | 0.00 | 0.00 / 0.00 | 47 / 47 |
| USDCAD | M5 | 0 / 0 | — | — / — | 0.00 | 0.00 / 0.00 | 40 / 40 |
| USDCAD | M15 | 5 / 1 | 40.0% | 1.55 / — | 3.47 | 0.00 / 0.00 | 42 / 11 |
| USDCAD | M30 | 7 / 2 | 0.0% | 0.00 / 0.00 | 9.38 | 0.00 / 0.00 | 27 / 0 |
| USDCAD | H1 | 7 / 7 | 28.6% | 0.92 / 0.91 | 10.48 | 0.00 / 0.00 | 29 / 0 |
| AUDUSD | M1 | 0 / 0 | — | — / — | 0.00 | 0.00 / 0.00 | 23 / 23 |
| AUDUSD | M5 | 0 / 0 | — | — / — | 0.00 | 0.00 / 0.00 | 51 / 51 |
| AUDUSD | M15 | 2 / 0 | 50.0% | 2.07 / — | 1.98 | -0.42 / 0.00 | 33 / 14 |
| AUDUSD | M30 | 8 / 0 | 12.5% | 0.30 / — | 7.97 | -0.99 / 0.00 | 19 / 2 |
| AUDUSD | H1 | 6 / 6 | 16.7% | 0.39 / 0.39 | 9.36 | -0.68 / -0.75 | 18 / 0 |
| NZDUSD | M1 | 0 / 0 | — | — / — | 0.00 | 0.00 / 0.00 | 34 / 34 |
| NZDUSD | M5 | 0 / 0 | — | — / — | 0.00 | 0.00 / 0.00 | 41 / 41 |
| NZDUSD | M15 | 1 / 0 | 0.0% | 0.00 / — | 2.43 | -0.02 / 0.00 | 35 / 23 |
| NZDUSD | M30 | 4 / 0 | 0.0% | 0.00 / — | 8.84 | -0.94 / -1.01 | 25 / 15 |
| NZDUSD | H1 | 8 / 2 | 25.0% | 0.77 / 1.86 | 7.72 | -1.18 / -1.25 | 27 / 0 |
| USDCNH | M1 | 0 / 0 | — | — / — | 0.00 | 0.00 / 0.00 | 41 / 41 |
| USDCNH | M5 | 0 / 0 | — | — / — | 0.00 | 0.00 / 0.00 | 41 / 41 |
| USDCNH | M15 | 0 / 0 | — | — / — | 0.00 | 0.00 / 0.00 | 23 / 23 |
| USDCNH | M30 | 0 / 0 | — | — / — | 0.00 | 0.00 / 0.00 | 20 / 20 |
| USDCNH | H1 | 0 / 0 | — | — / — | 0.00 | 0.00 / 0.00 | 27 / 27 |
| Gasoline | M1 | 0 / 0 | — | — / — | 0.00 | 0.00 / 0.00 | 51 / 51 |
| Gasoline | M5 | 0 / 0 | — | — / — | 0.00 | 0.00 / 0.00 | 19 / 19 |
| Gasoline | M15 | 0 / 0 | — | — / — | 0.00 | 0.00 / 0.00 | 35 / 35 |
| Gasoline | M30 | 0 / 0 | — | — / — | 0.33 | -0.08 / 0.00 | 42 / 39 |
| Gasoline | H1 | 3 / 0 | 33.3% | 1.01 / — | 1.42 | -0.13 / 0.00 | 32 / 21 |

## Cobertura e interpretação

- XAUUSD: sem histórico/custos no conjunto local; não testado, não equivale a zero trades.
- EURUSD: M1: 400 candles; M5: 400 candles; M15: 400 candles; M30: 400 candles; H1: 400 candles.
- GBPUSD: M1: 400 candles; M5: 400 candles; M15: 400 candles; M30: 400 candles; H1: 400 candles.
- USDJPY: M1: 400 candles; M5: 400 candles; M15: 400 candles; M30: 400 candles; H1: 400 candles.
- USDCHF: M1: 400 candles; M5: 400 candles; M15: 400 candles; M30: 400 candles; H1: 400 candles.
- USDCAD: M1: 400 candles; M5: 400 candles; M15: 400 candles; M30: 400 candles; H1: 400 candles.
- AUDUSD: M1: 400 candles; M5: 400 candles; M15: 400 candles; M30: 400 candles; H1: 400 candles.
- NZDUSD: M1: 400 candles; M5: 400 candles; M15: 400 candles; M30: 400 candles; H1: 400 candles.
- USDCNH: M1: 400 candles; M5: 400 candles; M15: 400 candles; M30: 400 candles; H1: 400 candles.
- USDSEK: sem histórico/custos no conjunto local; não testado, não equivale a zero trades.
- BTCUSD: sem histórico/custos no conjunto local; não testado, não equivale a zero trades.
- Gasoline: M1: 400 candles; M5: 400 candles; M15: 400 candles; M30: 400 candles; H1: 400 candles.

- Os históricos são snapshots locais coletados em 04/11/2026, com períodos distintos entre timeframes; consulte datas no relatório do backtest.
- Amostra curta e sem validação fora da amostra. Não representa comparação em janela temporal comum.
- DD por ativo estimado conservadoramente por OHLC; não é drawdown de carteira nem precisão tick a tick.
- PF ausente pode significar ausência de perdas ou ausência de trades; veja a contagem.
- M1 pode apresentar zero trades porque o spread supera o filtro de 20% ATR.
- Não simula todos os controles do motor de risco, margem, swaps, comissão ou conversão cambial histórica.
- Ativos sem dados precisam de candles MT5 e especificações/custos correspondentes antes de entrarem no benchmark.
- Tentativa de coleta complementar em 13/11/2026 bloqueada por timeout da ponte MT5 (8000 ms), apesar de /health indicar broker conectado.
