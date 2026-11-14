# Tendência diária diversificada

Estratégia `diversified_trend`, inspirada em time-series momentum de Moskowitz, Ooi e Pedersen (2012) e na investigação histórica de Hurst, Ooi e Pedersen (2017). É uma **adaptação**, não reprodução dos artigos: opera spot Forex com SL/TP por ATR, enquanto a evidência dos artigos envolve carteiras amplas de futuros/forwards e horizontes maiores.

## Regras implementadas

- Exclusivamente **D1**. Universo fixo suportado: EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD, NZDUSD. O runner usa a interseção com `MT5_SYMBOLS`; os símbolos permitidos nas configurações de risco continuam necessários.
- Momentum: logaritmo do retorno acumulado em 126 sessões por padrão.
- Score: momentum dividido pela volatilidade diária dos log-retornos × raiz do lookback. Volatilidade padrão: 60 sessões.
- Compra com score acima do limite; venda abaixo do limite negativo; zona neutra no intervalo. Limite padrão: zero.
- Lê só candles fechados. Primeiro ciclo inicializa sem operar; solicita 305 candles (dentro do limite 400 da ponte).
- Mantém posição alinhada. Fecha posições do ativo quando a direção muda ou fica neutra. Confirma a saída antes de entrar na direção oposta. A API atual gerencia posições por **ativo**, sem isolamento por origem da posição.
- Stop inicial: 3 ATR(14). Alvo: 3R. Sem trailing/rebalanceamento diário; após stop/alvo, pode voltar a entrar no próximo candle fechado se a tendência continuar.
- Spread máximo: 5% do ATR. Distância mínima de stop enviada ao motor impede que um teto monetário mais apertado altere silenciosamente a proteção solicitada.

## Dimensionamento e carteira

```text
peso por ativo = min(0,10 / (N × volatilidade anual), 2 / N)
notional desejado = equity × peso
```

Os 10% são a **soma dos orçamentos individuais de volatilidade**, não uma previsão da volatilidade da carteira. Os sete pares compartilham exposição ao USD e são correlacionados. `N` usa os ativos configurados no runner; orçamento de ativo bloqueado não é redistribuído.

O dimensionamento usa tick size/value do MT5 em moeda da conta, arredonda lotes **para baixo** e respeita o teto de lote. Se o orçamento não comporta o lote mínimo, aguarda. Na entrada, estima o notional bruto das posições existentes para limitar a alocação restante a 2× equity. Esse cálculo é uma estimativa do runner, não margem MT5; exposições variam após a entrada. O motor de risco continua validando conta, limites, OrderCheck, margem, lotes e política de posições. Um `riskPercentage` personalizado na linha da estratégia pode redimensionar o lote no motor e deve ser considerado ao comparar execução e pesquisa.

## Configuração

```sh
STRATEGY_RUNNER=diversified_trend STRATEGY_TIMEFRAME=D1 bun --filter '@trade/api' dev
```

`TREND_CONFIG_JSON` aceita parâmetros validados pelo schema:

```json
{
  "lookback": 126,
  "volatilityPeriod": 60,
  "minimumScore": 0,
  "stopAtr": 3,
  "rewardRisk": 3,
  "annualRiskBudget": 0.1,
  "maximumGrossLeverage": 2
}
```

Os parâmetros efetivos constam no snapshot da API, no painel, no motivo dos sinais e na sessão do bot. Auto Trading e demais controles existentes governam execução.

## Busca otimizada e benchmark

```sh
bun reports/download-trend-data.ts
bun reports/optimize-diversified-trend.ts
```

- Dados Dukascopy diários de 2014–2025, com volume. 2014–2015 são somente aquecimento.
- Domingo UTC incorporado à segunda-feira, formando um calendário sintético de cinco sessões. Não reproduz exatamente os candles D1 do servidor MT5.
- Grade global de **72** combinações: lookback 63/126/252; vol 20/60; score mínimo 0/0,5; stop 2/3/4 ATR; alvo 3/6R. Nenhum ajuste por par nem remoção retrospectiva de pares perdedores.
- Treino 2016–2020; validação 2021–2022; teste 2023–2025. Busca no cenário stress e seleção congelada antes de consultar o teste.
- Capital inicial por janela: USD 10 mil; mínimo/passo 0,01 lote. Caixa compartilhado, P&L dos pares USD-base convertido à cotação de saída, comissão nas duas pontas. Drawdown de carteira por equity no **fechamento diário**, não intradiário.
- Base: spread fixo histórico estimado e comissão USD 7/lote round-trip, sem swap. Stress: spread 1,5×, slippage, comissão USD 10/lote e encargo hipotético negativo de 2% a.a. do notional bruto. Esse encargo não é swap histórico real.

### Resultado desta rodada

Nenhuma configuração passou pelos critérios de aprovação. O fallback exploratório foi lookback252/vol60/score0,5/stop4ATR/alvo6R. Não foi aplicado automaticamente aos parâmetros de execução.

| Teste 2023–2025 | Retorno | Drawdown diário |
|---|---:|---:|
| Carteira fallback — base | −3,89% | 6,33% |
| Carteira fallback — stress | −6,78% | 8,52% |
| GBPUSD isolado com mesmo orçamento — stress | −18,87% | 22,75% |

Os resultados completos estão em `reports/diversified-trend-optimization-2016-2025.md` e no JSON correspondente. `reports/diversified-trend-candidate-config.json` é um artefato de pesquisa, não um conjunto aprovado. Parte do histórico GBPUSD já foi examinada em pesquisas anteriores; esta análise não é validação independente inédita.
