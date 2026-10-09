//+------------------------------------------------------------------+
//|                                                AurumBridge.mq5    |
//|  MQL5 Service that bridges the MetaTrader 5 terminal to the       |
//|  Aurum Terminal backend (@trade/broker MT5BrokerAdapter).         |
//|                                                                  |
//|  Transport: flat files inside the terminal *common* files folder |
//|  (Terminal\Common\Files). Flat names are used on purpose because |
//|  MQL5 has no directory-creation and no directory-listing API.    |
//|                                                                  |
//|  Read path  (hot): the service pushes snapshots.                 |
//|      aurum-heartbeat.json   liveness + login/server/build         |
//|      aurum-account.json     balance/equity/margin                |
//|      aurum-symbols.json     SymbolInfo + MarketPrice per symbol   |
//|      aurum-positions.json   open positions                       |
//|      aurum-orders.json      working orders                       |
//|                                                                  |
//|  Write path (trades): sequential request/response queue.         |
//|      aurum-cmd-<seq>.json   written by Bun, executed by MQL5     |
//|      aurum-res-<seq>.json   written by MQL5, awaited by Bun       |
//|                                                                  |
//|  All timestamps are epoch *seconds* (UTC); the Bun side converts  |
//|  them to ISO strings, which avoids MQL5's local-time formatting. |
//+------------------------------------------------------------------+
#property copyright "Aurum Terminal"
#property version   "1.00"
#property description "File bridge between the MT5 terminal and the Aurum Terminal broker adapter"
#property service

#define AURUM_PREFIX          "aurum-"
#define GV_SEQ                "aurum_last_seq"
#define POLL_MS               200
#define SNAPSHOT_EVERY_TICKS  3
#define RANGE_PERIOD          PERIOD_M30
#define RANGE_BARS            20
#define MAX_WATCH             64
#define MAX_MATCHES           40
#define MAX_RATES             400

//+------------------------------------------------------------------+
//| Minimal JSON writer                                              |
//+------------------------------------------------------------------+
string Esc(const string value)
  {
   string out = "\"";
   for(int i = 0; i < StringLen(value); i++)
     {
      const ushort c = StringGetCharacter(value, i);
      if(c == '\\')      out += "\\\\";
      else if(c == '"')  out += "\\\"";
      else if(c == '\n') out += "\\n";
      else if(c == '\r') out += "\\r";
      else if(c == '\t') out += "\\t";
      else               out += StringSubstr(value, i, 1);
     }
   return out + "\"";
  }

//--- Safe number formatting: never emit NaN/Inf, which is invalid JSON.
string Num(const double value, const int digits = 8)
  {
   if(!MathIsValidNumber(value)) return "0";
   const double capped = value > 1e15 ? 1e15 : (value < -1e15 ? -1e15 : value);
   return DoubleToString(capped, digits);
  }

string Int(const long value) { return IntegerToString(value); }

//+------------------------------------------------------------------+
//| Minimal JSON readers for the command payload                     |
//+------------------------------------------------------------------+
int ValuePos(const string json, const string key, const int from = 0)
  {
   const string needle = "\"" + key + "\"";
   int search = from;
   // The quoted key can appear earlier as a bare *value* (e.g. the key
   // "symbols" inside {"op":"symbols","symbols":"XAUUSD"}), so a match only
   // counts when a colon follows it; otherwise keep looking.
   while(true)
     {
      int p = StringFind(json, needle, search);
      if(p < 0) return -1;
      p += StringLen(needle);
      while(p < StringLen(json) && StringGetCharacter(json, p) <= ' ') p++;
      if(p < StringLen(json) && StringGetCharacter(json, p) == ':')
        {
         p++;
         while(p < StringLen(json) && StringGetCharacter(json, p) <= ' ') p++;
         return p;
        }
      search = p + 1;
     }
   return -1;
  }

string Str(const string json, const string key, const string fallback = "")
  {
   int p = ValuePos(json, key);
   if(p < 0 || StringGetCharacter(json, p) != '"') return fallback;
   p++;
   string out = "";
   while(p < StringLen(json))
     {
      const ushort c = StringGetCharacter(json, p);
      if(c == '"') return out;
      if(c == '\\')
        {
         p++;
         const ushort esc = StringGetCharacter(json, p);
         if(esc == 'n')      out += "\n";
         else if(esc == 'r') out += "\r";
         else if(esc == 't') out += "\t";
         else                out += StringSubstr(json, p, 1);
         p++;
         continue;
        }
      out += StringSubstr(json, p, 1);
      p++;
     }
   return fallback;
  }

double Dbl(const string json, const string key, const double fallback = 0.0)
  {
   const int start = ValuePos(json, key);
   if(start < 0) return fallback;
   int p = start;
   while(p < StringLen(json))
     {
      const ushort c = StringGetCharacter(json, p);
      const bool numeric = (c >= '0' && c <= '9') || c == '-' || c == '+' ||
                           c == '.' || c == 'e' || c == 'E';
      if(!numeric) break;
      p++;
     }
   if(p == start) return fallback;
   return StringToDouble(StringSubstr(json, start, p - start));
  }

bool Has(const string json, const string key) { return ValuePos(json, key) >= 0; }

//+------------------------------------------------------------------+
//| File helpers (flat names in the common-files root)               |
//+------------------------------------------------------------------+
void Trace(const string message)
  {
   const int h = FileOpen(AURUM_PREFIX + "trace.log", FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(h == INVALID_HANDLE) return;
   FileWriteString(h, TimeToString(TimeGMT(), TIME_DATE | TIME_SECONDS) + "  " + message + "\n");
   FileClose(h);
  }

bool Write(const string name, const string payload)
  {
   const string tmp = AURUM_PREFIX + name + ".tmp";
   const string dst = AURUM_PREFIX + name;
   const int h = FileOpen(tmp, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(h == INVALID_HANDLE) return false;
   const bool ok = StringLen(payload) > 0 && FileWriteString(h, payload) > 0;
   FileClose(h);
   FileDelete(dst, FILE_COMMON);
   return FileMove(tmp, FILE_COMMON, dst, FILE_COMMON);
  }

bool Read(const string name, string &out)
  {
   const int h = FileOpen(AURUM_PREFIX + name, FILE_READ | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(h == INVALID_HANDLE) return false;
   const string body = FileReadString(h, (int)FileSize(h));
   FileClose(h);
   out = body;
   return StringLen(body) > 0;
  }

//+------------------------------------------------------------------+
//| Trade return code text                                           |
//+------------------------------------------------------------------+
//--- MQL5 exposes the retcode enum only to the standard library, so the
//--- numeric code plus the broker comment is the fallback description.
string RetCode(const uint code, const string comment)
  {
   string out = Int((long)code);
   if(StringLen(comment) > 0) out += " - " + comment;
   return out;
  }

string ResultText(const MqlTradeResult &result)
  {
   switch(result.retcode)
     {
      case TRADE_RETCODE_DONE:         return "filled";
      case TRADE_RETCODE_DONE_PARTIAL: return "partially filled";
      case TRADE_RETCODE_PLACED:       return "placed";
      case TRADE_RETCODE_REJECT:       return "rejected by broker";
      case TRADE_RETCODE_ERROR:        return "internal broker error";
      case TRADE_RETCODE_INVALID:      return "invalid request";
      case TRADE_RETCODE_INVALID_VOLUME: return "invalid volume";
      case TRADE_RETCODE_INVALID_PRICE:  return "invalid price";
      case TRADE_RETCODE_INVALID_STOPS:  return "invalid stops";
      case TRADE_RETCODE_INVALID_FILL:    return "invalid filling mode";
      case TRADE_RETCODE_TRADE_DISABLED:  return "trading disabled for this account";
      case TRADE_RETCODE_MARKET_CLOSED:   return "market closed";
      case TRADE_RETCODE_NO_MONEY:        return "insufficient margin";
      case TRADE_RETCODE_PRICE_CHANGED:   return "price changed";
      case TRADE_RETCODE_PRICE_OFF:       return "no quotes";
      case TRADE_RETCODE_ORDER_CHANGED:   return "order state changed";
      case TRADE_RETCODE_TOO_MANY_REQUESTS: return "too many requests";
      case TRADE_RETCODE_NO_CHANGES:      return "no changes";
     }
   return RetCode(result.retcode, result.comment);
  }

//--- SYMBOL_FILLING_MODE is a bitmask: bit0 = FOK, bit1 = IOC, bit2 = BOC.
//--- MQL5 has no ORDER_FILLING_BOTH constant, so prefer IOC whenever the
//--- broker allows it: every account that accepts FOK accepts IOC as well.
ENUM_ORDER_TYPE_FILLING Filling(const string symbol)
  {
   const int mode = (int)SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE);
   if((mode & 2) != 0) return ORDER_FILLING_IOC;
   if((mode & 1) != 0) return ORDER_FILLING_FOK;
   return ORDER_FILLING_RETURN;
  }

//+------------------------------------------------------------------+
//| Watch list                                                       |
//+------------------------------------------------------------------+
string g_watch[];
int g_watchCount = 0;

//--- Command-queue cursor shared with the heartbeat, so a restarted client
//--- can resume above the last sequence the service already executed.
long g_next = 0;
long g_highWater = 0;

//--- Comma separated list keeps the wire format trivial to parse.
void LoadWatch()
  {
   string raw = "";
   if(!Read("watch.txt", raw)) raw = "";
   ArrayResize(g_watch, MAX_WATCH);
   g_watchCount = 0;
   string parts[];
   const int n = StringSplit(raw, ',', parts);
   for(int i = 0; i < n && g_watchCount < MAX_WATCH; i++)
     {
      const string symbol = parts[i];
      if(StringLen(symbol) > 0)
        {
         g_watch[g_watchCount] = symbol;
         g_watchCount++;
        }
     }
  }

//+------------------------------------------------------------------+
//| Symbol helpers                                                   |
//+------------------------------------------------------------------+
bool Tradable(const string symbol)
  {
   if(!SymbolSelect(symbol, true)) return false;
   const ENUM_SYMBOL_TRADE_MODE mode = (ENUM_SYMBOL_TRADE_MODE)SymbolInfoInteger(symbol, SYMBOL_TRADE_MODE);
   if(mode == SYMBOL_TRADE_MODE_DISABLED) return false;
   if((int)MQLInfoInteger(MQL_TRADE_ALLOWED) == 0) return false;
   if(AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) == 0) return false;
   return true;
  }

double Quote(const string symbol, const bool ask)
  {
   MqlTick tick;
   if(!SymbolInfoTick(symbol, tick)) return 0.0;
   return ask ? tick.ask : tick.bid;
  }

//--- SYMBOL_TRADE_STOPS_LEVEL is an integer property holding a point count.
double StopsFloor(const string symbol)
  {
   return (double)SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL) *
          SymbolInfoDouble(symbol, SYMBOL_POINT);
  }

//--- Recent high/low range over RANGE_BARS bars; 0 when history is thin.
double Range(const string symbol)
  {
   MqlRates bars[];
   ArraySetAsSeries(bars, true);
   if(CopyRates(symbol, RANGE_PERIOD, 0, RANGE_BARS, bars) < RANGE_BARS) return 0.0;
   double high = -1e15, low = 1e15;
   for(int i = 0; i < RANGE_BARS; i++)
     {
      if(bars[i].high > high) high = bars[i].high;
      if(bars[i].low < low)   low = bars[i].low;
     }
   if(high <= low) return 0.0;
   const double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   const int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   return NormalizeDouble(MathRound((high - low) / point) * point, digits);
  }

string SymbolJson(const string symbol)
  {
   if(!Tradable(symbol))
      return "{\"symbol\":" + Esc(symbol) + ",\"marketOpen\":false}";

   const int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   const double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   const double contract = SymbolInfoDouble(symbol, SYMBOL_TRADE_CONTRACT_SIZE);
   const double marginInit = SymbolInfoDouble(symbol, SYMBOL_MARGIN_INITIAL);
   const int spreadPoints = (int)SymbolInfoInteger(symbol, SYMBOL_SPREAD);
   const double spread = spreadPoints * point;

   MqlTick tick;
   const bool haveTick = SymbolInfoTick(symbol, tick);
   const double bid = haveTick ? tick.bid : 0.0;
   const double ask = haveTick ? tick.ask : 0.0;

   //--- SYMBOL_TRADE_TICK_VALUE_PROFIT already carries contract size and
   //--- currency conversion, which is exactly what the risk model expects.
   double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE_PROFIT);
   if(tickValue <= 0.0) tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);

   //--- risk-manager computes margin as lots * contract * price * marginRate,
   //--- and SYMBOL_MARGIN_INITIAL is margin per lot at a unit price.
   const double marginRate = contract > 0.0 ? marginInit / contract : 0.0;

   //--- 5x the live spread keeps a genuinely abnormal quote rejectable
   //--- without blocking normal conditions.
   const double maxSpread = MathMax(spread * 5.0, point);

   const double stopBase = Range(symbol);
   const double stopsFloor = StopsFloor(symbol);

   string out = "{";
   out += "\"symbol\":" + Esc(symbol);
   out += ",\"minLot\":" + Num(SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN));
   out += ",\"maxLot\":" + Num(SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX));
   out += ",\"lotStep\":" + Num(SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP));
   out += ",\"contractSize\":" + Num(contract);
   out += ",\"tickValue\":" + Num(tickValue);
   out += ",\"tickSize\":" + Num(SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE));
   //--- Price distances must retain the symbol precision, especially for FX.
   out += ",\"maxSpread\":" + Num(maxSpread, digits);
   out += ",\"maxSlippage\":" + Num(MathMax(spread, point * 2), digits);
   out += ",\"defaultStopLoss\":" + Num(stopBase > stopsFloor ? stopBase : 0.0, digits);
   out += ",\"defaultTakeProfit\":" + Num(stopBase > stopsFloor ? stopBase * 2.0 : 0.0, digits);
   out += ",\"marginRate\":" + Num(marginRate);
   out += ",\"stopsLevel\":" + Num(stopsFloor);
   out += ",\"spread\":" + Num(spread, digits);
   out += ",\"bid\":" + Num(bid, digits);
   out += ",\"ask\":" + Num(ask, digits);
   out += ",\"digits\":" + Int(digits);
   out += ",\"point\":" + Num(point, 8);
   out += ",\"marketOpen\":" + (haveTick && spread > 0 ? "true" : "false");
   out += "}";
   return out;
  }

//+------------------------------------------------------------------+
//| Snapshot writers                                                 |
//+------------------------------------------------------------------+
void SnapshotHeartbeat()
  {
   const bool connected = TerminalInfoInteger(TERMINAL_CONNECTED) != 0;
   const bool tradeAllowed = TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) != 0;
   string out = "{";
   out += "\"ts\":" + Int((long)TimeGMT());
   out += ",\"build\":" + Int((long)TerminalInfoInteger(TERMINAL_BUILD));
   out += ",\"connected\":" + (connected ? "true" : "false");
   out += ",\"tradeAllowed\":" + (tradeAllowed ? "true" : "false");
   out += ",\"login\":" + Int((long)AccountInfoInteger(ACCOUNT_LOGIN));
   out += ",\"server\":" + Esc(AccountInfoString(ACCOUNT_SERVER));
   out += ",\"name\":" + Esc(AccountInfoString(ACCOUNT_NAME));
   out += ",\"currency\":" + Esc(AccountInfoString(ACCOUNT_CURRENCY));
   out += ",\"tradeMode\":" + Int((long)AccountInfoInteger(ACCOUNT_TRADE_MODE));
   out += ",\"seq\":" + Int(g_highWater);
   out += ",\"dataPath\":" + Esc(TerminalInfoString(TERMINAL_DATA_PATH));
   out += ",\"commonPath\":" + Esc(TerminalInfoString(TERMINAL_COMMONDATA_PATH));
   out += "}";
   Write("heartbeat.json", out);
  }

void SnapshotAccount()
  {
   string out = "{";
   out += "\"id\":" + Esc(IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN)));
   out += ",\"balance\":" + Num(AccountInfoDouble(ACCOUNT_BALANCE), 2);
   out += ",\"equity\":" + Num(AccountInfoDouble(ACCOUNT_EQUITY), 2);
   out += ",\"usedMargin\":" + Num(AccountInfoDouble(ACCOUNT_MARGIN), 2);
   out += ",\"freeMargin\":" + Num(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2);
   const double used = AccountInfoDouble(ACCOUNT_MARGIN);
   out += ",\"marginLevel\":" + Num(used > 0.0 ? AccountInfoDouble(ACCOUNT_EQUITY) / used * 100.0 : 0.0, 2);
   out += ",\"currency\":" + Esc(AccountInfoString(ACCOUNT_CURRENCY));
   out += ",\"leverage\":" + Int((long)AccountInfoInteger(ACCOUNT_LEVERAGE));
   out += "}";
   Write("account.json", out);
  }

void SnapshotSymbols()
  {
   string out = "{\"symbols\":{";
   for(int i = 0; i < g_watchCount; i++)
     {
      if(i > 0) out += ",";
      out += Esc(g_watch[i]) + ":" + SymbolJson(g_watch[i]);
     }
   out += "}}";
   Write("symbols.json", out);
  }

void SnapshotPositions()
  {
   string out = "{\"positions\":[";
   const int total = PositionsTotal();
   for(int i = 0; i < total; i++)
     {
      const ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(i > 0) out += ",";
      const string symbol = PositionGetString(POSITION_SYMBOL);
      const ENUM_POSITION_TYPE type = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      const int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
      out += "{";
      out += "\"id\":" + Esc(IntegerToString((long)ticket));
      out += ",\"symbol\":" + Esc(symbol);
      out += ",\"side\":" + (type == POSITION_TYPE_BUY ? "\"BUY\"" : "\"SELL\"");
      out += ",\"lots\":" + Num(PositionGetDouble(POSITION_VOLUME));
      out += ",\"entryPrice\":" + Num(PositionGetDouble(POSITION_PRICE_OPEN), digits);
      out += ",\"currentPrice\":" + Num(Quote(symbol, type != POSITION_TYPE_BUY), digits);
      //--- POSITION_PROFIT is account currency and excludes swap.
      out += ",\"unrealizedPnl\":" + Num(PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP), 2);
      out += ",\"stopLoss\":" + Num(PositionGetDouble(POSITION_SL), digits);
      out += ",\"takeProfit\":" + Num(PositionGetDouble(POSITION_TP), digits);
      out += ",\"openedAt\":" + Int((long)PositionGetInteger(POSITION_TIME));
      out += "}";
     }
   out += "]}";
   Write("positions.json", out);
  }

void SnapshotOrders()
  {
   string out = "{\"orders\":[";
   const int total = OrdersTotal();
   for(int i = 0; i < total; i++)
     {
      const ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      if(i > 0) out += ",";
      const string symbol = OrderGetString(ORDER_SYMBOL);
      const int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
      const ENUM_ORDER_TYPE type = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
      const ENUM_ORDER_STATE state = (ENUM_ORDER_STATE)OrderGetInteger(ORDER_STATE);
      string status = "CREATED";
      if(state == ORDER_STATE_FILLED)         status = "FILLED";
      else if(state == ORDER_STATE_PARTIAL)  status = "PARTIALLY_FILLED";
      else if(state == ORDER_STATE_CANCELED) status = "CANCELLED";
      else if(state == ORDER_STATE_REJECTED) status = "REJECTED";
      else if(state == ORDER_STATE_PLACED)   status = "SUBMITTED";
      out += "{";
      out += "\"id\":" + Esc(IntegerToString((long)ticket));
      out += ",\"clientOrderId\":" + Esc(OrderGetString(ORDER_COMMENT)) + ",";
      out += "\"symbol\":" + Esc(symbol);
      out += ",\"side\":" + (type == ORDER_TYPE_BUY || type == ORDER_TYPE_BUY_LIMIT || type == ORDER_TYPE_BUY_STOP ? "\"BUY\"" : "\"SELL\"");
      out += ",\"lots\":" + Num(OrderGetDouble(ORDER_VOLUME_CURRENT));
      out += ",\"status\":" + Esc(status);
      out += ",\"requestedPrice\":" + Num(OrderGetDouble(ORDER_PRICE_OPEN), digits);
      if(state == ORDER_STATE_FILLED || state == ORDER_STATE_PARTIAL)
         out += ",\"executedPrice\":" + Num(OrderGetDouble(ORDER_PRICE_CURRENT), digits);
      out += ",\"createdAt\":" + Int((long)OrderGetInteger(ORDER_TIME_SETUP));
      out += "}";
     }
   out += "]}";
   Write("orders.json", out);
  }

void SnapshotAll()
  {
   SnapshotHeartbeat();
   SnapshotAccount();
   SnapshotSymbols();
   SnapshotPositions();
   SnapshotOrders();
  }

//+------------------------------------------------------------------+
//| Command execution                                                |
//+------------------------------------------------------------------+
string Reject(const string reason)
  {
   return "{\"ok\":false,\"error\":" + Esc(reason) + "}";
  }

//--- Snapshots answer read commands; they never touch the queue.
string OpPing()      { return "{\"ok\":true,\"data\":{\"pong\":true}}"; }

//+------------------------------------------------------------------+
//| Reports symbol names containing a substring.                       |
//|                                                                  |
//| Broker naming carries suffixes (XAUUSD.a, XAUUSDm, EURUSD.raw) that  |
//| cannot be derived from the host side, and guessing one means the    |
//| service silently watches nothing. So the bot asks the terminal     |
//| instead of hard-coding a list that would rot with the account.     |
//+------------------------------------------------------------------+
string OpFindSymbols(const string json)
  {
   const string query = Str(json, "query");
   string matches = "";
   int hits = 0;
   const int total = SymbolsTotal(true);
   for(int i = 0; i < total && hits < MAX_MATCHES; i++)
     {
      const string name = SymbolName(i, true);
      if(StringLen(name) == 0) continue;
      if(StringLen(query) > 0 && StringFind(name, query) < 0) continue;
      if(hits > 0) matches += ",";
      matches += name;
      hits++;
     }
   return "{\"ok\":true,\"data\":{\"matches\":\"" + matches + "\",\"count\":" + Int(hits) + "}}";
  }
string OpAccount()   { SnapshotAccount(); return "{\"ok\":true,\"data\":{\"refreshed\":true}}"; }
string OpPositions() { SnapshotPositions(); return "{\"ok\":true,\"data\":{\"refreshed\":true}}"; }
string OpOrders()    { SnapshotOrders(); return "{\"ok\":true,\"data\":{\"refreshed\":true}}"; }

string OpSymbols(const string json)
  {
   const string list = Str(json, "symbols");
   Write("watch.txt", list);
   LoadWatch();
   SnapshotSymbols();
   return "{\"ok\":true,\"data\":{\"watching\":" + Int(g_watchCount) + "}}";
  }

//+------------------------------------------------------------------+
//| Timeframe parsing                                                |
//|                                                                  |
//| The bot speaks "M30"/"H1"/"D1" like TradingView and Pine, so the   |
//| mapping is spelled out instead of relying on ENUM_TIMEFRAMES      |
//| ordinals, which differ between builds.                             |
//+------------------------------------------------------------------+
ENUM_TIMEFRAMES ParsePeriod(const string text)
  {
   const string t = text;
   if(t == "M1")  return PERIOD_M1;
   if(t == "M5")  return PERIOD_M5;
   if(t == "M15") return PERIOD_M15;
   if(t == "M30") return PERIOD_M30;
   if(t == "H1")  return PERIOD_H1;
   if(t == "H4")  return PERIOD_H4;
   if(t == "D1")  return PERIOD_D1;
   if(t == "W1")  return PERIOD_W1;
   if(t == "MN1") return PERIOD_MN1;
   return PERIOD_CURRENT;
  }

//+------------------------------------------------------------------+
//| OHLC history                                                     |
//|                                                                  |
//| Indicators have to be computed where the data is, because the     |
//| terminal owns the bars. The reply is capped at MAX_RATES and      |
//| newest-first ordering is reversed into oldest-first, matching     |
//| what every technical indicator expects.                           |
//+------------------------------------------------------------------+
string OpRates(const string json)
  {
   const string symbol = Str(json, "symbol");
   const string periodText = Str(json, "period", "M30");
   int count = (int)Dbl(json, "count", 100);
   if(StringLen(symbol) == 0) return Reject("symbol required");
   if(count <= 0) count = 100;
   if(count > MAX_RATES) count = MAX_RATES;
   if(!SymbolSelect(symbol, true)) return Reject("unknown symbol " + symbol);

   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   const ENUM_TIMEFRAMES period = ParsePeriod(periodText);
   if(CopyRates(symbol, period, 0, count, rates) < 1)
      return Reject("no bars available for " + symbol + " " + periodText);

   const int total = ArraySize(rates);
   string bars = "";
   for(int i = total - 1; i >= 0; i--)
     {
      if(bars != "") bars += ",";
      bars += "{\"t\":" + Int((long)rates[i].time)
            + ",\"o\":" + Num(rates[i].open)
            + ",\"h\":" + Num(rates[i].high)
            + ",\"l\":" + Num(rates[i].low)
            + ",\"c\":" + Num(rates[i].close)
            + ",\"v\":" + Num((double)rates[i].tick_volume)
            + "}";
     }
   return "{\"ok\":true,\"data\":{\"symbol\":" + Esc(symbol)
          + ",\"period\":" + Esc(periodText)
          + ",\"rates\":[" + bars + "]}}";
  }

//--- Volume must sit on the broker's lot step or OrderSend fails with
//--- TRADE_RETCODE_INVALID_VOLUME, so validate before spending a request.
bool VolumeOk(const string symbol, const double volume, string &reason)
  {
   const double minLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   const double maxLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   const double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   if(step <= 0.0) { reason = "broker reports a zero lot step"; return false; }
   const double steps = MathRound((volume - minLot) / step);
   const double normalized = NormalizeDouble(minLot + steps * step, 2);
   if(MathAbs(normalized - volume) > step * 0.5)
     { reason = "volume " + DoubleToString(volume, 4) + " is not a multiple of the " +
                DoubleToString(step, 4) + " lot step"; return false; }
   if(normalized < minLot - 1e-9 || normalized > maxLot + 1e-9)
     { reason = "volume " + DoubleToString(normalized, 4) + " is outside the broker range " +
                DoubleToString(minLot, 4) + "-" + DoubleToString(maxLot, 4); return false; }
   return true;
  }

int Deviation(const string symbol, const double maxSlippage)
  {
   const double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   if(point <= 0.0) return 0;
   const int raw = (int)MathRound(maxSlippage / point);
   if(raw < 0) return 0;
   if(raw > 1000) return 1000;
   return raw;
  }

//--- SL/TP closer than SYMBOL_TRADE_STOPS_LEVEL is rejected by the server
//--- as TRADE_RETCODE_INVALID_STOPS; catch it here with a useful message.
bool StopsOk(const string symbol, const ENUM_ORDER_TYPE type, const double price,
             const double sl, const double tp, string &reason)
  {
   const double floor = StopsFloor(symbol);
   if(sl <= 0.0 && tp <= 0.0) return true;
   if(sl > 0.0 && (type == ORDER_TYPE_BUY ? sl >= price : sl <= price))
     { reason = "stop loss sits on the wrong side of the market"; return false; }
   if(tp > 0.0 && (type == ORDER_TYPE_BUY ? tp <= price : tp >= price))
     { reason = "take profit sits on the wrong side of the market"; return false; }
   if(sl > 0.0 && MathAbs(price - sl) < floor)
     { reason = "stop loss is inside the broker stop level of " +
                DoubleToString(MathRound(floor / SymbolInfoDouble(symbol, SYMBOL_POINT)), 0) + " points"; return false; }
   if(tp > 0.0 && MathAbs(tp - price) < floor)
     { reason = "take profit is inside the broker stop level of " +
                DoubleToString(MathRound(floor / SymbolInfoDouble(symbol, SYMBOL_POINT)), 0) + " points"; return false; }
   return true;
  }

void FillCommon(MqlTradeRequest &req, const string symbol, const double maxSlippage,
                const string comment, const long magic)
  {
   req.symbol = symbol;
   req.deviation = Deviation(symbol, maxSlippage);
   req.magic = (ulong)magic;
   req.comment = comment;
   req.type_filling = Filling(symbol);
  }

//--- Locates the position opened at/after t0 for this symbol and magic.
//--- The newest ticket wins so back-to-back deals stay distinguishable.
ulong FindPositionTicket(const string symbol, const long magic, const long since)
  {
   ulong best = 0;
   const int total = PositionsTotal();
   for(int i = 0; i < total; i++)
     {
      const ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != symbol) continue;
      if((long)PositionGetInteger(POSITION_MAGIC) != magic) continue;
      if((long)PositionGetInteger(POSITION_TIME) + 5 < since) continue;
      if(ticket > best) best = ticket;
     }
   return best;
  }

string OpPlace(const string json)
  {
   const string symbol = Str(json, "symbol");
   const string side = Str(json, "side");
   const double lots = Dbl(json, "lots");
   const double sl = Dbl(json, "sl");
   const double tp = Dbl(json, "tp");
   const string comment = Str(json, "comment");
   const long magic = (long)Dbl(json, "magic");

   if(!Tradable(symbol)) return Reject("symbol " + symbol + " is not tradable on this account");

   string problem;
   if(!VolumeOk(symbol, lots, problem)) return Reject(problem);

   const ENUM_ORDER_TYPE type = side == "BUY" ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   const double price = Quote(symbol, type == ORDER_TYPE_BUY);
   if(price <= 0.0) return Reject("no quote for " + symbol);

   if(!StopsOk(symbol, type, price, sl, tp, problem)) return Reject(problem);

   const long t0 = (long)TimeGMT();

   MqlTradeRequest req;
   MqlTradeResult res;
   ZeroMemory(req);
   ZeroMemory(res);
   req.action = TRADE_ACTION_DEAL;
   FillCommon(req, symbol, Dbl(json, "maxSlippage"), comment, magic);
   req.type = type;
   req.volume = lots;
   req.price = price;
   if(sl > 0.0) req.sl = sl;
   if(tp > 0.0) req.tp = tp;

   if(!OrderSend(req, res)) return Reject("OrderSend failed: " + ResultText(res));

   //--- MqlTradeResult has no position ticket, so the position that this deal
   //--- opened is located by magic + symbol + open time. On netting accounts
   //--- that scan still resolves the single position for the symbol.
   const ulong ticket = FindPositionTicket(symbol, magic, t0);

   string out = "{\"ok\":" + ((res.retcode == TRADE_RETCODE_DONE || res.retcode == TRADE_RETCODE_DONE_PARTIAL) ? "true" : "false");
   out += ",\"retcode\":" + Int((long)res.retcode);
   out += ",\"retcodeText\":" + Esc(ResultText(res));
   out += ",\"brokerOrderId\":" + Esc(IntegerToString((long)(res.order > 0 ? res.order : res.deal)));
   out += ",\"dealId\":" + Esc(IntegerToString((long)res.deal));
   out += ",\"positionId\":" + Esc(IntegerToString((long)ticket));
   out += ",\"executedPrice\":" + Num(res.price, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS));
   out += ",\"comment\":" + Esc(res.comment);
   out += "}";
   return out;
  }

string OpClose(const string json)
  {
   const long ticket = (long)Dbl(json, "positionId");
   if(!PositionSelectByTicket((ulong)ticket)) return Reject("position " + Int(ticket) + " not found");

   const string symbol = PositionGetString(POSITION_SYMBOL);
   const double volume = PositionGetDouble(POSITION_VOLUME);
   const ENUM_POSITION_TYPE type = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
   const ENUM_ORDER_TYPE close = type == POSITION_TYPE_BUY ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
   const double price = Quote(symbol, close == ORDER_TYPE_SELL);
   if(price <= 0.0) return Reject("no quote for " + symbol);

   MqlTradeRequest req;
   MqlTradeResult res;
   ZeroMemory(req);
   ZeroMemory(res);
   req.action = TRADE_ACTION_DEAL;
   FillCommon(req, symbol, Dbl(json, "maxSlippage"), Str(json, "comment"), (long)Dbl(json, "magic"));
   req.position = (ulong)ticket;
   req.type = close;
   req.volume = volume;
   req.price = price;

   if(!OrderSend(req, res)) return Reject("OrderSend failed: " + ResultText(res));

   SnapshotPositions();
   string out = "{\"ok\":" + (res.retcode == TRADE_RETCODE_DONE || res.retcode == TRADE_RETCODE_DONE_PARTIAL ? "true" : "false");
   out += ",\"retcode\":" + Int((long)res.retcode);
   out += ",\"retcodeText\":" + Esc(ResultText(res));
   out += ",\"brokerOrderId\":" + Esc(IntegerToString((long)(res.order > 0 ? res.order : res.deal)));
   out += ",\"positionId\":" + Esc(Int(ticket));
   out += ",\"executedPrice\":" + Num(res.price, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS));
   out += "}";
   return out;
  }

string OpModify(const string json)
  {
   const long ticket = (long)Dbl(json, "positionId");
   if(!PositionSelectByTicket((ulong)ticket)) return Reject("position " + Int(ticket) + " not found");

   const string symbol = PositionGetString(POSITION_SYMBOL);
   const ENUM_POSITION_TYPE type = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
   const double sl = Has(json, "sl") ? Dbl(json, "sl") : PositionGetDouble(POSITION_SL);
   const double tp = Has(json, "tp") ? Dbl(json, "tp") : PositionGetDouble(POSITION_TP);
   const double open = PositionGetDouble(POSITION_PRICE_OPEN);

   string problem;
   if(!StopsOk(symbol, type == POSITION_TYPE_BUY ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, open, sl, tp, problem))
      return Reject(problem);

   MqlTradeRequest req;
   MqlTradeResult res;
   ZeroMemory(req);
   ZeroMemory(res);
   req.action = TRADE_ACTION_SLTP;
   req.position = (ulong)ticket;
   req.symbol = symbol;
   req.magic = (ulong)(long)Dbl(json, "magic");
   req.sl = sl;
   req.tp = tp;

   if(!OrderSend(req, res)) return Reject("OrderSend failed: " + ResultText(res));
   SnapshotPositions();

   string out = "{\"ok\":" + (res.retcode == TRADE_RETCODE_DONE ? "true" : "false");
   out += ",\"retcode\":" + Int((long)res.retcode);
   out += ",\"retcodeText\":" + Esc(ResultText(res));
   out += ",\"brokerOrderId\":" + Esc(IntegerToString((long)(res.order > 0 ? res.order : res.deal)));
   out += ",\"positionId\":" + Esc(Int(ticket));
   out += "}";
   return out;
  }

string Dispatch(const string json)
  {
   const string op = Str(json, "op");
   if(op == "ping")      return OpPing();
   if(op == "find_symbols") return OpFindSymbols(json);
   if(op == "rates")      return OpRates(json);
   if(op == "account")   return OpAccount();
   if(op == "symbols")   return OpSymbols(json);
   if(op == "positions") return OpPositions();
   if(op == "orders")    return OpOrders();
   if(op == "place")     return OpPlace(json);
   if(op == "close")     return OpClose(json);
   if(op == "modify")    return OpModify(json);
   return Reject("unknown op '" + op + "'");
  }

//+------------------------------------------------------------------+
//| Queue drain                                                      |
//+------------------------------------------------------------------+

void InitSequence()
  {
   g_highWater = GlobalVariableCheck(GV_SEQ) ? (long)GlobalVariableGet(GV_SEQ) : 0;
   g_next = g_highWater + 1;
  }

//--- Sequence numbers make the queue exactly-once: a command at or below
//--- the high-water mark was already executed in a previous terminal run, so
//--- replaying it (Bun crashed mid-flight) is skipped.
//---
//--- Extracts <n> from "aurum-cmd-<n>.json"; false for anything else.
bool CommandSeq(const string fname, long &out)
  {
   const string prefix = AURUM_PREFIX + "cmd-";
   if(StringFind(fname, prefix) != 0) return false;
   string rest = StringSubstr(fname, StringLen(prefix));
   const int dot = StringFind(rest, ".json");
   if(dot <= 0) return false;
   rest = StringSubstr(rest, 0, dot);
   for(int i = 0; i < StringLen(rest); i++)
     {
      const ushort c = StringGetCharacter(rest, i);
      if(c < '0' || c > '9') return false;
     }
   out = (long)StringToInteger(rest);
   return true;
  }

//--- Drains every pending command in ascending sequence order. The Bun client
//--- may leave gaps (concurrent callers, cleanup after a crash) and the service
//--- must not require its exact next number, or the queue deadlocks. The
//--- high-water mark still guards against replaying a command from a past run.
void DrainQueue()
  {
   for(int guard = 0; guard < 64; guard++)
     {
      string best = "";
      long bestSeq = 0;
      string fname = "";
      const long handle = FileFindFirst(AURUM_PREFIX + "cmd-*.json", fname, FILE_COMMON);
      if(handle == INVALID_HANDLE) return;
      do
        {
         long seq = 0;
         if(!CommandSeq(fname, seq)) continue;
         if(seq <= g_highWater) continue;
         if(best == "" || seq < bestSeq)
           {
            best = fname;
            bestSeq = seq;
           }
        }
      while(FileFindNext(handle, fname));
      FileFindClose(handle);

      if(best == "") return;

      string body;
      if(!Read(StringSubstr(best, StringLen(AURUM_PREFIX)), body)) return;

      const string reply = Dispatch(body);
      Write("res-" + Int(bestSeq) + ".json", reply);
      g_highWater = bestSeq;
      GlobalVariableSet(GV_SEQ, (double)g_highWater);
      Trace("seq " + Int(bestSeq) + " -> " + StringSubstr(reply, 0, 120));
     }
  }

//+------------------------------------------------------------------+
//| Lifecycle                                                        |
//+------------------------------------------------------------------+
string BridgeDescriptor()
  {
   string out = "{";
   out += "\"version\":1";
   out += ",\"protocol\":\"aurum-file-queue/1\"";
   out += ",\"build\":" + Int((long)TerminalInfoInteger(TERMINAL_BUILD));
   out += ",\"login\":" + Int((long)AccountInfoInteger(ACCOUNT_LOGIN));
   out += ",\"server\":" + Esc(AccountInfoString(ACCOUNT_SERVER));
   out += ",\"company\":" + Esc(AccountInfoString(ACCOUNT_COMPANY));
   out += ",\"dataPath\":" + Esc(TerminalInfoString(TERMINAL_DATA_PATH));
   out += ",\"commonPath\":" + Esc(TerminalInfoString(TERMINAL_COMMONDATA_PATH));
   out += "}";
   return out;
  }

bool g_running = false;

int Start()
  {
   if(g_running) return 1;
   //--- Written only to the common folder, which makes it the marker the bot
   //--- looks for when resolving Terminal\Common\Files. It also states where
   //--- the service believes it is writing, so a wrong guess on the host side
   //--- surfaces as a mismatch instead of a silently dead queue.
   Write("bridge.json", BridgeDescriptor());
   LoadWatch();
   InitSequence();
   SnapshotAll();
   g_running = true;
   Trace("started; watching " + Int(g_watchCount) + " symbols; next seq " + Int(g_next));
   return 0;
  }

void Stop()
  {
   if(!g_running) return;
   g_running = false;
   Trace("stopped");
  }

//--- A service receives no events other than Start, so OnStart must own the
//--- whole lifetime and return only when the terminal stops it. Returning here
//--- ends the service (journal: "service ... stopped (result code N)").
int OnStart()
  {
   if(Start() != 0) return 1;
   int ticks = 0;
   while(!IsStopped())
     {
      DrainQueue();
      if(++ticks >= SNAPSHOT_EVERY_TICKS)
        {
         ticks = 0;
         LoadWatch();
         SnapshotAll();
        }
      Sleep(POLL_MS);
     }
   Stop();
   return 0;
  }
