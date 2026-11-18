# Aurum Terminal

Bot de trading auto-hospedado para **MetaTrader 5**, com painel web em português, risk engine, backtests e auditoria. As estratégias decidem; o MT5 executa. Não há broker simulado: conta, preços, posições e ordens vêm sempre do terminal.

`MetaTrader 5 → ponte MQL5 → API Elysia → PostgreSQL → dashboard Next.js` — monorepo Bun/TypeScript.

![Overview do Aurum Terminal](docs/screenshots/01-overview.png)

## Download (macOS)

[**Baixar TradingBot para macOS (Apple Silicon, arm64)**](https://github.com/BrunoFerreira995/tradingbot/raw/main/apps/desktop/releases/TradingBot_0.1.1_aarch64.dmg) — DMG de 3,4 MB.

> Build não assinado. O app abre o dashboard em `http://localhost:3002`, então a API e o painel precisam estar rodando localmente. Para distribuir fora do próprio Mac, é necessário assinar e notarizar com a Apple.

## O que faz

- **Sinais** de estratégias embutidas ou de um webhook do TradingView.
- **Risk engine** com lote máximo, perda e meta de lucro diária, limite de posições, stop obrigatório, sessões Forex, stop monetário por operação e por símbolo e símbolos permitidos.
- **Execução no MT5** com `OrderCheck`, confirmação de posição, idempotência e auditoria.
- **Painel em tempo real** com saldo, equity, P&L, posições, trades, gráficos e drawdown.
- **Proteções**: Auto trading desligado por padrão, emergency stop e confirmação explícita para conta real.

## Telas

| Trading                                                                                                             | Risk Control                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| <a href="docs/screenshots/02-trading.png"><img src="docs/screenshots/02-trading.png" width="420" alt="Trading"></a> | <a href="docs/screenshots/06-risk-control.png"><img src="docs/screenshots/06-risk-control.png" width="420" alt="Risk Control"></a> |

Veja todas as telas e o tour completo em [docs/reference.md](docs/reference.md).

## Backtest

Resultado líquido dos melhores candidatos por estratégia, com treino, holdout e um cenário de estresse com 1,5x o spread:

![Backtest por estratégia](docs/screenshots/09-backtest-strategies.svg)

**Resumo:**

- **Melhor retorno total: MeanRev BB+RSI no M30** — US$ 37,77 no backtest de timeframes (treino + holdout) e US$ 36,70 no melhor candidato por treino.
- **Melhor holdout isolado: BB+RSI no H1** — US$ 27,47, contra US$ 5,18 do M30.
- O M30 concentra o ganho no treino (US$ 32,59) e cai no holdout; o H1 faz o contrário.

> Os resultados vêm de simulações de pesquisa com snapshots históricos, não de execução real no MT5. As amostras são pequenas e o holdout não deve ser reutilizado para escolher parâmetros. Não são garantia de resultado futuro.

Gere ou atualize os gráficos com:

```sh
bun run research:plot
```

<details>
<summary>Outros gráficos de backtest</summary>

**Mean reversal BB+RSI por timeframe** — parâmetros fixos, treino vs. holdout:

![Mean reversal por timeframe](docs/screenshots/10-backtest-meanrev-timeframes.svg)

**Market Forces por timeframe** — cenário base e estresse:

![Market Forces por timeframe](docs/screenshots/11-backtest-market-forces.svg)

**Diversified Trend no período de teste** — estratégia não aprovada na validação:

![Diversified Trend](docs/screenshots/12-backtest-diversified-trend.svg)

Relatórios completos: [estratégias clássicas](docs/reference.md#research-only-backtests), [mean reversion](reports/meanrev-timeframe-backtest-2026-11-04.json), [Market Forces](reports/market-forces-backtest-2026-11-13.md) e [Diversified Trend](reports/diversified-trend-optimization-2016-2025.md).

</details>

## Roadmap: rede neural

Objetivo: usar uma rede neural como **camada de apoio à decisão**. O modelo produz um score/probabilidade; a estratégia, o risk engine e a confirmação do MT5 continuam sendo a autoridade final. A rede nunca envia ordens diretamente.

| Fase | Entrega | Critério para avançar |
| --- | --- | --- |
| 0. Baseline | Congelar os backtests atuais, custos, janelas de treino/holdout e métricas de referência | O pipeline atual reproduz os mesmos resultados com os mesmos dados |
| 1. Dataset | Features versionadas, alvo explícito, split temporal sem vazamento e snapshot dos candles usados | Dataset reproduzível, com hash e relatório de qualidade |
| 2. Treino offline | Treino em Python (PyTorch/scikit-learn), validação walk-forward e comparação com o baseline | O modelo supera o baseline no holdout em métricas escolhidas antes do treino |
| 3. Empacotamento | Exportação para ONNX e serviço de inferência isolado, com timeout e versão do modelo | Inferência determinística, testada e sem acesso à rede de ordens |
| 4. Shadow mode | O strategy runner consulta o modelo, mas o score não altera a execução; features e previsões ficam auditadas | Período em demo sem erros, latência aceitável e comportamento explicável |
| 5. Gate de risco | Uso opcional como filtro/confirmação, com threshold, fallback para a regra atual, limite de confiança e kill switch | Aprovação manual após comparação paper vs. baseline |
| 6. Monitoramento | Detecção de drift, métricas por símbolo, registry de modelos e retreino periódico | Processo de promoção e rollback documentado |

**Decisões iniciais recomendadas**

- Começar com um problema pequeno e mensurável: prever direção ou retorno futuro de um único símbolo/timeframe, não automação ponta a ponta.
- Separar treino (Python) de execução (API TypeScript); carregar apenas o artefato exportado no runtime.
- Manter o modelo atrás de uma flag, desligado por padrão, e sempre com fallback para a estratégia atual.
- Registrar por previsão: versão do modelo, features de entrada, score, threshold e resultado posterior.
- Não versionar pesos no Git; usar artefato imutável com hash e metadados de treino.

**Fora do escopo inicial:** reinforcement learning, execução direta pelo modelo, retreino online e substituição do risk engine.

## Requisitos

- Bun 1.3+
- PostgreSQL 16
- MetaTrader 5 com o serviço `AurumBridge` (para dados e execução)
- Docker opcional

## Rodar localmente

No macOS, instale e inicie o PostgreSQL uma vez:

```sh
brew install postgresql@16
brew services start postgresql@16
export PATH="$(brew --prefix postgresql@16)/bin:$PATH"
```

Crie o banco (só na primeira vez):

```sh
psql -d postgres -c "CREATE ROLE trader WITH LOGIN PASSWORD 'trader';"
createdb -O trader tradingbot
```

Configure o ambiente e suba o projeto:

```sh
cp .env.example .env   # defina DASHBOARD_PASSWORD, ADMIN_API_KEY e TRADINGVIEW_WEBHOOK_SECRET
bun install
bun db:migrate
bun dev
```

- Dashboard: <http://localhost:3002>
- API: <http://localhost:3001/health>

O login do painel usa `DASHBOARD_USER` e `DASHBOARD_PASSWORD` do `.env`. Mantenha `AUTO_TRADING_ENABLED=false` até validar tudo.

## Conectar o MetaTrader 5

1. Compile e instale a ponte:

   ```sh
   bun run mt5:install
   ```

2. No MT5, faça login, habilite **Algo Trading** em Ferramentas → Opções e adicione `AurumBridge` em **Navigator → Services**.

   <img src="docs/screenshots/08-mt5-navigator.png" width="520" alt="AurumBridge dentro de Services no Navigator do MetaTrader 5">

   Ele precisa estar em **Services**. Se aparecer em Expert Advisors ou Scripts, remova e adicione novamente.

3. Verifique a conexão:

   ```sh
   bun run mt5:doctor
   ```

   O diagnóstico deve terminar com `bridge is ready`. O `/health` também informa conta, servidor e modo (demo/real).

Para rodar tudo com Docker, use `docker compose up --build` com as variáveis do `.env`.

## Primeiro uso

1. **Broker**: confirme `Connected` e a conta correta.
2. **Risk Control**: revise lote máximo, perda diária, sessões e símbolos permitidos. Deixe o Auto trading desligado.
3. **Trading**: confira se o strategy runner está avaliando os pares (não pode ficar `BLOCKED`).
4. Acompanhe sinais, ordens e posições em **Trading** e os resultados em **Trades**.
5. Só então habilite o **Auto trading**.

> Teste sempre em conta demo primeiro. O **EMERGENCY STOP** bloqueia novas ordens imediatamente, mas **não fecha** posições existentes.

## Estrutura

| Caminho             | Responsabilidade                                     |
| ------------------- | ---------------------------------------------------- |
| `apps/api`          | Webhook, API, auditoria, SSE e orquestração.         |
| `apps/web`          | Dashboard Next.js.                                   |
| `packages/trading`  | Lote, risco, política de posições e envio de ordens. |
| `packages/strategy` | Indicadores e estratégias em TypeScript.             |
| `packages/broker`   | Adaptador da ponte MT5.                              |
| `packages/database` | Schema Drizzle e migrações SQL.                      |

## Comandos úteis

| Comando                       | O que faz                                      |
| ----------------------------- | ---------------------------------------------- |
| `bun dev`                     | Sobe API e dashboard em modo desenvolvimento.  |
| `bun typecheck`               | Verifica tipos de API e web.                   |
| `bun lint`                    | Roda o ESLint.                                 |
| `bun test`                    | Roda os testes.                                |
| `bun run build`               | Build de produção.                             |
| `bun run mt5:doctor`          | Diagnostica a ponte MT5 sem enviar ordens.     |
| `bun run mt5:install`         | Compila e instala o `AurumBridge`.             |
| `bun run research:strategies` | Backtests de pesquisa, sem conectar ao broker. |

## Documentação

- [Referência técnica completa](docs/reference.md) — arquitetura, risco, sessões, bridge, limitações e operação.
- [TradingView](docs/tradingview.md) — formato do webhook e exemplo em Pine Script.
- [Estratégias](docs/) — SMA Micro Trend, Dow Theory, Market Forces e outras.
