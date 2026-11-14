# Análise após os trades — 4 nov 2026

## Dados e método

- Fonte: 136 posições fechadas reconstruídas do histórico completo de negócios da conta demo MT5, com 69 contextos da estratégia `sma_micro_trend` em M1.
- Os 71 fechamentos de 4 nov foram comparados aos candles M1 do terminal. O horário do negócio foi convertido para o horário do servidor com `serverOffsetSeconds=7200` antes do alinhamento.
- Para cada fechamento, o preço de saída foi comparado ao fechamento do candle 5, 15 e 30 minutos depois, na direção original do trade. As excursões usam máximas e mínimas dos candles posteriores. O candle que contém a saída foi excluído para evitar incluir preços anteriores à saída.
- Só entraram em cada horizonte os trades com candles posteriores suficientes. OHLC não representa necessariamente o preço executável com spread e slippage.

## O que ocorreu depois

| Grupo | Horizonte | Trades cobertos | Continuaram a favor | Mediana do deslocamento / stop inicial |
| --- | ---: | ---: | ---: | ---: |
| Estratégia SMA M1 | 5 min | 68 | 39 (57,4%) | +0,075 |
| Estratégia SMA M1 | 15 min | 63 | 33 (52,4%) | +0,037 |
| Estratégia SMA M1 | 30 min | 60 | 30 (50,0%) | +0,006 |
| Saídas por sinal | 15 min | 26 | 18 (69,2%) | +0,125 |
| Stop monetário | 15 min | 5 | 1 (20,0%) | −0,628 |

O deslocamento aos 30 minutos ficou equilibrado. Não há evidência suficiente aqui para alongar todas as saídas; máximas favoráveis dentro do intervalo não seriam capturadas integralmente por uma saída fixa.

## Problema observado na entrada

- A SMA M1 fez 69 trades com contexto: resultado líquido **−US$ 9,33**.
- **17 fecharam em até 10 segundos**, somando **−US$ 5,99**. Seis deles, perto do fim da amostra, tinham spread entre 3,63 e 9,54 vezes o ATR do candle de sinal e foram encerrados pelo stop monetário em cerca de 2 segundos.
- Nove posições tinham distância entre entrada e stop inferior a 0,5 ATR; nenhuma venceu. Isto incluiu cinco stops rápidos em XAUUSD mesmo com spread pequeno frente ao ATR: ali o stop monetário era pequeno frente à oscilação, não apenas frente ao spread.
- Na seleção retrospectiva, o filtro `spread > 1,5 ATR` ou `stop < 0,5 ATR` teria evitado 23 operações, todas perdedoras, totalizando **−US$ 7,77**. As 46 restantes somaram **−US$ 1,56**. Isto é análise de seleção da amostra, não backtest de uma nova sequência de ordens: posições, sinais posteriores e custos poderiam mudar.

## Ajuste implementado

- A estratégia SMA agora pula uma entrada se o spread atual exceder **1,5 ATR** do último candle fechado.
- O motor de risco recusa a entrada se o stop calculado ficar abaixo de **0,5 ATR**. O stop monetário do usuário não é ampliado; a operação é rejeitada.
- O spread é verificado novamente imediatamente antes do envio da ordem. Uma rejeição nessa etapa fica como cancelamento, sem registrar falsamente o pedido como enviado ao broker.
- Fechamentos independentes continuam disponíveis. O filtro de spread também é aplicado antes de fechar uma posição oposta por reversão.

Esses limites são conservadores e baseados em um dia de observações. É necessário acompanhar novas operações fora da amostra antes de concluir que melhoraram o resultado. O código precisa ser carregado pela API para entrar em vigor.
