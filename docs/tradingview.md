# TradingView alerts

Create a TradingView alert with **Webhook URL** set to `https://your-api.example.com/api/webhooks/tradingview`. The API requires HTTPS in deployment. Use the message below, replacing the secret with `TRADINGVIEW_WEBHOOK_SECRET` from the API server. Keep broker credentials on the server only.

```json
{
  "secret": "CHANGE_ME",
  "strategy": "gold-scalping-v1",
  "signalId": "{{ticker}}-{{interval}}-{{timenow}}",
  "symbol": "{{ticker}}",
  "action": "BUY",
  "orderType": "MARKET",
  "price": "{{close}}",
  "lots": 0.01,
  "stopLoss": 25,
  "takeProfit": 50,
  "timeframe": "{{interval}}"
}
```

`stopLoss` and `takeProfit` are price distances, not absolute price levels. The default risk policy requires an explicit stop loss. For SELL use `"action":"SELL"`. For close use `CLOSE`, `CLOSE_LONG`, or `CLOSE_SHORT`; `lots` is optional for close actions. A `signalId` must be unique per event. Repeated IDs are acknowledged as duplicates and never executed twice.

TradingView does not provide arbitrary custom headers in its ordinary webhook alert. Use the JSON shared secret above. External clients can use `X-Webhook-Secret` instead. A client capable of headers can use HMAC: set `X-Tradingview-Timestamp` to Unix milliseconds, `X-Tradingview-Nonce` to a unique value, and `X-Tradingview-Signature` to lowercase hex HMAC SHA-256 of `timestamp.nonce.rawBody` with `TRADINGVIEW_HMAC_SECRET`. The API rejects signatures older than five minutes and repeated nonces.

Pine Script v5 integration example. This illustrates wiring only; it makes no claim about trading performance.

```pine
//@version=5
strategy("Aurum integration example", overlay=true)
fast = ta.sma(close, 9)
slow = ta.sma(close, 21)
longSignal = ta.crossover(fast, slow)
shortSignal = ta.crossunder(fast, slow)
if longSignal
    strategy.entry("Long", strategy.long)
    strategy.exit("Long exit", "Long", stop=close-25, limit=close+50)
    alert('{"secret":"CHANGE_ME","strategy":"gold-scalping-v1","signalId":"XAUUSD-5m-' + str.tostring(time) + '-BUY","symbol":"XAUUSD","action":"BUY","orderType":"MARKET","lots":0.01,"stopLoss":25,"takeProfit":50}', alert.freq_once_per_bar_close)
if shortSignal
    strategy.entry("Short", strategy.short)
    strategy.exit("Short exit", "Short", stop=close+25, limit=close-50)
    alert('{"secret":"CHANGE_ME","strategy":"gold-scalping-v1","signalId":"XAUUSD-5m-' + str.tostring(time) + '-SELL","symbol":"XAUUSD","action":"SELL","orderType":"MARKET","lots":0.01,"stopLoss":25,"takeProfit":50}', alert.freq_once_per_bar_close)
plot(fast)
plot(slow)
```

For this script, create an alert on **Any alert() function call**. Strategy order fill alerts and `alert()` calls are separate TradingView mechanisms; avoid enabling both for the same execution intent.

For an **indicator** instead of a strategy, `alertcondition()` is appropriate. Use its condition in the TradingView alert dialog and supply the webhook JSON as the alert message:

```pine
//@version=5
indicator("Aurum condition example", overlay=true)
fast = ta.sma(close, 9)
slow = ta.sma(close, 21)
alertcondition(ta.crossover(fast, slow), "Long signal", "Long condition")
alertcondition(ta.crossunder(fast, slow), "Short signal", "Short condition")
```
