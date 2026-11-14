# Trade automático por direção e atrito

Selecione `STRATEGY_RUNNER=market_forces` e reinicie a API. O runner registra a estratégia automaticamente usando os ativos observados permitidos nas configurações de risco.

```sh
STRATEGY_RUNNER=market_forces bun --filter '@trade/api' dev
```

O Auto Trading precisa estar habilitado no painel e o terminal MT5 precisa estar conectado com Algo Trading habilitado. As configurações de risco persistidas no banco têm precedência sobre o valor inicial de `AUTO_TRADING_ENABLED`. Os controles existentes de conta, emergency stop, lotes, perda diária, margem e OrderCheck continuam aplicados pelo motor de execução.

## Regras

- Avalia apenas um novo candle fechado; o primeiro ciclo inicializa sem executar.
- Compra: direção e estrutura de alta, pressão compradora e atrito baixo.
- Venda: direção e estrutura de baixa, pressão vendedora e atrito baixo.
- Sem concordância ou histórico suficiente: aguarda.
- Uma posição existente no ativo impede nova entrada, inclusive no sentido oposto.
- Spread máximo: 20% do ATR(14); stop: 2 ATR; alvo: 4 ATR.
- Saídas pelo stop ou alvo enviados ao motor de risco; não há reversão automática nem fechamento só por aumento do atrito.
- Lote solicitado: 0,01 por padrão, sujeito ao dimensionamento e limites do motor de risco.
- Não repete uma submissão de resultado incerto no mesmo candle.

A análise usa proxies de preço, não fluxo real de ordens. O score de atrito não é uma probabilidade de acerto.
