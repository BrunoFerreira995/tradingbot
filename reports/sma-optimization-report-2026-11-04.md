# Backtest e busca de parâmetros — SMA Micro Trend

## Resultado

Não apareceu uma configuração com lucro consistente fora da amostra e com custos mais altos. Nenhum parâmetro da estratégia em execução foi alterado por esta pesquisa.

| Critério de seleção no treino | Configuração | Treino | Validação posterior | Validação com spread 1,5× |
| --- | --- | ---: | ---: | ---: |
| SMA atual M1 | 9/21, sem macro, reversão ligada | −US$ 0,81 / 81 trades | −US$ 2,72 / 26 | −US$ 2,29 / 13 |
| Maior lucro | M1 9/40, inclinação da SMA lenta, sem macro | +US$ 3,83 / 15 | **−US$ 0,97 / 7** | −US$ 0,53 / 4 |
| Melhor pior ativo | M1 12/40, inclinação da SMA lenta, sem reversão | +US$ 2,47 / 16 | **−US$ 0,41 / 8** | −US$ 0,90 / 5 |
| Melhor pior custo (1×/1,5×) | M1 12/30, preço do lado da SMA rápida, sem reversão | +US$ 2,51 / 36 | **−US$ 0,08 / 16** | −US$ 1,84 / 8 |

O candidato M30 3/30, sem confirmação macro e com reversão, ficou apenas ligeiramente positivo no treino (+US$ 0,40) e na validação (+US$ 0,10); com spread 1,5×, a validação foi +US$ 0,04 em 8 trades. Esses valores são menores que a incerteza de execução do modelo e não justificam ativá-lo. Entre 806 candidatos, 92 tiveram treino positivo, 74 validação positiva e somente 20 foram positivos em ambos; após exigir ao menos 8 trades de validação e lucro também com spread 1,5×, restou esse único candidato de ganho marginal.

## Método

- Foram testados timeframes de entrada M1, M5, M15 e M30, com macro opcional no timeframe seguinte. Para cada timeframe e ativo, os primeiros 60% dos candles serviram para escolher parâmetros e os 40% finais foram reservados para validação cronológica.
- A grade usou SMA rápida 3, 5, 9 ou 12; SMA lenta 14, 21, 30 ou 40; filtro de preço, inclinação da SMA lenta, alinhamento macro e reversão ligados ou desligados. Candidatos precisavam de pelo menos 8 trades e 4 ativos no treino.
- Foram usados os 9 ativos atualmente permitidos pela conta demo que tinham candles disponíveis. A simulação usa 0,01 lote, stop monetário de US$ 0,27, alvo de 3 vezes a distância do stop, filtro de spread até 1,5 ATR, stop mínimo de 0,5 ATR, janelas de sessão atuais, spread mediano observado por ativo e um tick de slippage adverso em cada execução. Quando stop e alvo são atingidos no mesmo candle, o stop vence. Posições abertas no fim de cada segmento são marcadas a mercado.
- As séries vieram de 400 candles por ativo e timeframe, limite atual da ponte MT5. M1 cobre cerca de 6h40; M5, cerca de 33h; M15, cerca de 6 dias corridos; M30, cerca de 12 dias corridos. O candle mais recente, ainda em formação, foi descartado. O teste macro usa apenas candles já fechados.

## Limites da conclusão

O spread histórico por candle não é publicado pela ponte atual; o modelo usa a mediana dos spreads de entrada observados e cenários 1,5×/2×. Os valores de tick foram capturados no snapshot atual, não em cada trade histórico. A simulação não reproduz a fila global de até oito posições, OrderCheck, rejeições, latência ou todas as mudanças passadas de configuração. No M1, o modelo gerou 107 trades para os 9 ativos permitidos, enquanto o histórico registra 60 trades reais desses ativos na janela de candles disponível: há diferenças suficientes para tratar os valores em dólares como aproximações, não como previsão operacional.

O maior risco aqui é escolher entre centenas de parâmetros com poucos negócios fora da amostra. O próximo passo para uma otimização confiável é coletar mais candles M1 com spread histórico ou ticks, ampliar a validação por dias separados e repetir o teste antes de mudar os parâmetros ativos.

Artefatos: `sma-optimization-2026-11-04.json` contém os resultados por ativo; `optimize_sma_research.py` reproduz a pesquisa sem enviar ordens.
