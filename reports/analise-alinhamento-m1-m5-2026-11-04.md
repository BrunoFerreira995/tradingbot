# Alinhamento M1/M5 — 4 nov 2026

Os 69 trades M1 da estratégia `sma_micro_trend` foram comparados à direção das
SMAs 9 e 21 do M5. Para cada entrada foi usado o último candle M5 fechado no
instante de fechamento do candle M1 que gerou o sinal. O candle M5 em formação
não entrou no cálculo.

| Seleção retrospectiva | Trades | Vitórias | Resultado líquido |
| --- | ---: | ---: | ---: |
| Todos os trades M1 | 69 | 10 | −US$ 9,33 |
| Direção M1 alinhada com M5 | 30 | 1 | −US$ 5,37 |
| Direção M1 oposta ao M5 | 39 | 9 | −US$ 3,96 |
| Passam filtros de custo e stop anteriores | 46 | 10 | −US$ 1,56 |
| Passam filtros anteriores **e** alinhados com M5 | 19 | 1 | −US$ 2,48 |
| Passam filtros anteriores, mas opostos ao M5 | 27 | 9 | +US$ 0,92 |

Esta amostra **não sustenta ligar o filtro M5 para entradas M1 agora**. O
resultado de selecionar trades passados não representa uma sequência nova de
ordens: posições abertas, sinais seguintes, slippage e custos poderiam mudar.
O código oferece alinhamento opcional, desligado por padrão, para teste fora
da amostra. O timeframe `AUTO` escolhe o próximo acima do timeframe de entrada.

Dados por trade: `macro-m1-m5-trade-alignment-2026-11-04.csv`.
