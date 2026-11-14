# Estratégia Market Forces Shock

```sh
STRATEGY_RUNNER=market_forces_shock STRATEGY_TIMEFRAME=H1 bun --filter '@trade/api' dev
```

O runner registra a variante como estratégia própria. Para execução, o Auto Trading do painel e o Algo Trading do terminal precisam estar habilitados; todos os controles do motor de risco continuam aplicados. O primeiro ciclo só inicializa, sem reproduzir entradas antigas.

## Entrada e saída

- Base: concordância entre direção por SMA, estrutura de Dow e pressão dos candles, com baixo atrito.
- Filtro: não entra em nenhum sentido quando há choque ≥ **1,18** nos últimos **3 candles fechados**. Um choque bloqueia seu candle e os dois seguintes. Novo choque renova a janela.
- Não fecha nem reverte posição existente por causa de choque; stop e alvo permanecem responsáveis pelas saídas.
- Stop: **2 ATR**; alvo: **4 ATR**; spread máximo: **20% do ATR**; uma posição por ativo. Lote solicitado padrão: **0,01**, sujeito ao motor de risco.
- Dados insuficientes/inválidos impedem entrada.

## Cálculo causal

1. ATR(14) e regressão de 16 candles calculados **antes** do candle avaliado.
2. Velocidade = variação de fechamento / ATR anterior.
3. Aceleração = velocidade atual − velocidade anterior.
4. Se o movimento é contrário à inclinação anterior, que deve ter magnitude ≥ 0,03 ATR/candle:

```text
choque = max(0, −direção_anterior × aceleração)
         × (0,5 + 0,5 × proporção_do_corpo_contrário)
```

O candle em formação nunca entra no cálculo. O cooldown é reconstruído pelo histórico em cada novo candle, inclusive após reinício, em vez de depender de um temporizador volátil. O determinante da geometria anterior é exposto para análise; não é requisito de entrada.

O limite 1,18 é uma referência descritiva do percentil 95 do histórico GBPUSD H1 de 2016–2025. Não foi validado como parâmetro rentável, nem calibrado por ativo/timeframe. A configuração de código `shockConfig` do runner permite ajustar `threshold` e `cooldownBars` (1–20). O painel mostra o índice, a janela restante e o motivo de espera.

A variante usa proxies OHLC, não fluxo de ordens. Seu resultado ainda deve ser comparado ao da estratégia base em backtest; a estratégia base perdeu no teste de dez anos.
