"""Research-only walk-forward simulation for the MT5 SMA strategy.

Run from the repository root: python3 reports/optimize_sma_research.py
It never sends broker orders or updates strategy settings.
"""

import csv
import itertools
import json
import os
from bisect import bisect_right
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parent
LOT = float(os.environ.get('SMA_RESEARCH_LOT', '0.01'))
if LOT not in (0.01, 0.03, 0.10):
    raise ValueError('Research lot must be 0.01, 0.03 or 0.10')
STOP_USD = 0.27
STOP_USD = float(os.environ.get('SMA_RESEARCH_STOP_USD', str(STOP_USD)))
if STOP_USD <= 0 or STOP_USD > 10:
    raise ValueError('Research monetary stop must be positive and at most 10 USD')
SERVER_OFFSET_SECONDS = 7200
SYMBOLS = ['EURUSD','USDJPY','USDCAD','AUDUSD','NZDUSD','USDCNH','Gasoline','GBPUSD','USDCHF']
BAR_FILES = {'M1':'post-trade-rates-2026-11-04.json','M5':'macro-m5-rates-2026-11-04.json',
             'M15':'macro-m15-rates-2026-11-04.json','M30':'m30-rates-2026-11-04.json',
             'H1':'h1-rates-2026-11-04.json'}
MACRO_TIMEFRAME = {'M1':'M5','M5':'M15','M15':'M30','M30':'H1'}
SPECS = {
    'EURUSD': (.00001,1.0,1.0), 'USDJPY': (.001,.63133306,.63150450),
    'USDCAD': (.00001,.71535364,.71560447), 'AUDUSD': (.00001,1.0,1.0),
    'NZDUSD': (.00001,1.0,1.0), 'USDCNH': (.00001,.14980623,.14992032),
    'Gasoline': (.0001,.1,.1), 'GBPUSD': (.00001,1.0,1.0),
    'USDCHF': (.00001,1.22324159,1.22473974),
}

def observed_spreads():
    values=defaultdict(list)
    with (ROOT/'trades-mt5-2026-11-04.csv').open(encoding='utf-8-sig') as f:
        for trade in csv.DictReader(f):
            if trade['strategy_id'] and trade['spread_at_entry']:
                values[trade['symbol']].append(float(trade['spread_at_entry']))
    return {symbol:median(values[symbol]) for symbol in SYMBOLS}

SPREADS=observed_spreads()
BARS={timeframe:json.loads((ROOT/name).read_text()) for timeframe,name in BAR_FILES.items()}

def sma(values,period):
    out=[None]*len(values); total=0.0
    for i,value in enumerate(values):
        total+=value
        if i>=period:total-=values[i-period]
        if i>=period-1:out[i]=total/period
    return out

def atr(bars,period=14):
    out=[None]*len(bars); seed=0.0
    for i,bar in enumerate(bars):
        prior=bars[i-1]['c'] if i else None
        tr=max(bar['h']-bar['l'],abs(bar['h']-prior) if prior is not None else 0,abs(bar['l']-prior) if prior is not None else 0)
        if i<period: seed+=tr
        if i==period-1:out[i]=seed/period
        elif i>=period:out[i]=(out[i-1]*(period-1)+tr)/period
    return out

def session_open(server_timestamp):
    local=datetime.fromtimestamp(server_timestamp-SERVER_OFFSET_SECONDS,timezone.utc)-timedelta(hours=3)
    minute=local.hour*60+local.minute
    # Current enabled database windows: Sydney 18:00-03:00 (Sun-Sat),
    # Asia 21:00-06:00 (Sun-Sat), New York 13:00-17:00 (Mon-Fri).
    weekday=(local.weekday()+1)%7
    syd=(minute>=18*60 or minute<3*60) and ((weekday if minute>=18*60 else (weekday+6)%7) in range(6))
    asia=(minute>=21*60 or minute<6*60) and ((weekday if minute>=21*60 else (weekday+6)%7) in range(6))
    ny=13*60<=minute<17*60 and weekday in (1,2,3,4,5)
    return syd or asia or ny

@dataclass(frozen=True)
class Params:
    timeframe: str
    fast: int
    slow: int
    price_side: bool
    slow_slope: bool
    macro: bool
    reverse: bool

def signal_at(i,bars,fast,slow,atr_values,params):
    j=i-1
    if j<1 or None in (fast[j],slow[j],fast[j-1],slow[j-1],atr_values[j]):return None
    if fast[j-1]<=slow[j-1] and fast[j]>slow[j]:side='BUY'
    elif fast[j-1]>=slow[j-1] and fast[j]<slow[j]:side='SELL'
    else:return None
    if params.price_side and ((side=='BUY' and bars[j]['c']<=fast[j]) or (side=='SELL' and bars[j]['c']>=fast[j])):return None
    if params.slow_slope and ((side=='BUY' and slow[j]<=slow[j-1]) or (side=='SELL' and slow[j]>=slow[j-1])):return None
    return side

def simulate_symbol(params,symbol,segment,spread_multiplier=1):
    bars=BARS[params.timeframe][symbol][:-1]  # newest CopyRates bar is forming
    count=len(bars); split=int(count*.6)
    begin,end=(0,split) if segment=='train' else (split,count)
    macro_bars=BARS[MACRO_TIMEFRAME[params.timeframe]][symbol]
    closes=[b['c'] for b in bars]
    fast=sma(closes,params.fast); slow=sma(closes,params.slow); atr_values=atr(bars)
    macro_fast=sma([b['c'] for b in macro_bars],params.fast)
    macro_slow=sma([b['c'] for b in macro_bars],params.slow)
    macro_times=[b['t'] for b in macro_bars]
    tick,tick_value,tick_loss=SPECS[symbol]
    spread=SPREADS[symbol]*spread_multiplier
    slip=tick
    stop_ticks=int(STOP_USD/(tick_loss*LOT)+1e-10)
    stop_distance=stop_ticks*tick
    position=None; trades=[]

    def exit_position(index,bid_price,reason):
        nonlocal position
        if position is None:return
        side=position['side']
        exit_price=bid_price-slip if side=='BUY' else bid_price+spread+slip
        movement=(exit_price-position['entry']) * (1 if side=='BUY' else -1)
        value=tick_value if movement>=0 else tick_loss
        pnl=movement/tick*value*LOT
        trades.append({'symbol':symbol,'entry_at':position['at'],'exit_at':bars[index]['t'],'side':side,'pnl':pnl,'reason':reason})
        position=None

    for i in range(max(2,begin),end):
        bar=bars[i]
        decision=signal_at(i,bars,fast,slow,atr_values,params)
        atr_at_signal=atr_values[i-1]
        if decision and params.macro:
            k=bisect_right(macro_times,bar['t'])-2
            if k<0 or macro_fast[k] is None or macro_slow[k] is None or (decision=='BUY' and macro_fast[k]<=macro_slow[k]) or (decision=='SELL' and macro_fast[k]>=macro_slow[k]):
                decision=None
        entry_allowed=bool(decision and session_open(bar['t']) and atr_at_signal and spread<=1.5*atr_at_signal and stop_distance>=0.5*atr_at_signal and stop_distance>=spread+tick)
        if position and decision and decision!=position['side'] and params.reverse and entry_allowed:
            exit_position(i,bar['o'],'OPPOSITE')
        if position is None and entry_allowed:
            entry=bar['o']+spread+slip if decision=='BUY' else bar['o']-slip
            position={'side':decision,'entry':entry,'at':bar['t'],
                      'stop':entry-stop_distance if decision=='BUY' else entry+stop_distance,
                      'target':entry+3*stop_distance if decision=='BUY' else entry-3*stop_distance}
        if position:
            if position['side']=='BUY':
                stop_hit=bar['l']<=position['stop']; target_hit=bar['h']>=position['target']
                if stop_hit: exit_position(i,min(bar['o'],position['stop']),'STOP')
                elif target_hit: exit_position(i,position['target'],'TARGET')
            else:
                stop_hit=bar['h']+spread>=position['stop']; target_hit=bar['l']+spread<=position['target']
                if stop_hit: exit_position(i,max(bar['o']+spread,position['stop'])-spread,'STOP')
                elif target_hit: exit_position(i,position['target']-spread,'TARGET')
    if position:exit_position(end-1,bars[end-1]['c'],'SEGMENT_END')
    return trades

def summarize(trades):
    profits=[trade['pnl'] for trade in trades]
    wins=[p for p in profits if p>0]; losses=[p for p in profits if p<0]
    by_symbol={symbol:round(sum(t['pnl'] for t in trades if t['symbol']==symbol),2) for symbol in SYMBOLS}
    total=0.0; peak=0.0; max_drawdown=0.0
    for trade in sorted(trades,key=lambda item:item['exit_at']):
        total+=trade['pnl']; peak=max(peak,total); max_drawdown=max(max_drawdown,peak-total)
    by_day=defaultdict(float)
    for trade in trades:
        day=datetime.fromtimestamp(trade['exit_at']-SERVER_OFFSET_SECONDS,timezone.utc).date().isoformat()
        by_day[day]+=trade['pnl']
    return {'trades':len(trades),'net_usd':round(sum(profits),2),'win_rate_pct':round(100*len(wins)/len(profits),1) if profits else None,
            'profit_factor':round(sum(wins)/-sum(losses),2) if losses else None,
            'worst_symbol_usd':min(by_symbol.values()),'worst_day_usd':round(min(by_day.values()),2) if by_day else None,
            'max_trade_drawdown_usd':round(max_drawdown,2),'end_mark_count':sum(t['reason']=='SEGMENT_END' for t in trades),
            'active_symbols':sum(any(t['symbol']==s for t in trades) for s in SYMBOLS),
            'by_symbol':by_symbol}

def evaluate(params,segment,spread_multiplier=1):
    return summarize([trade for symbol in SYMBOLS for trade in simulate_symbol(params,symbol,segment,spread_multiplier)])

def main():
    candidates=[]
    for timeframe in ('M1','M5','M15','M30'):
        for fast,slow,price_side,slow_slope,macro,reverse in itertools.product((3,5,9,12),(14,21,30,40),(False,True),(False,True),(False,True),(False,True)):
            if fast>=slow:continue
            params=Params(timeframe,fast,slow,price_side,slow_slope,macro,reverse)
            train=evaluate(params,'train')
            if train['trades']>=8 and train['active_symbols']>=4:
                candidates.append((params,train))
    by_net=sorted(candidates,key=lambda item:(item[1]['net_usd'],item[1]['worst_symbol_usd']),reverse=True)
    by_min=sorted(candidates,key=lambda item:(item[1]['worst_symbol_usd'],item[1]['net_usd']),reverse=True)
    by_cost=sorted(
        ((p,train,evaluate(p,'train',1.5)) for p,train in candidates),
        key=lambda item:(min(item[1]['net_usd'],item[2]['net_usd']),item[1]['net_usd']),reverse=True,
    )
    baseline=[Params(frame,9,21,False,False,False,True) for frame in ('M1','M5','M15','M30')]
    baseline += [Params(frame,9,21,False,False,True,True) for frame in ('M1','M5','M15','M30')]
    selected=[]
    seen=set()
    optimized=[]
    if by_net: optimized.append(('max_train_net',by_net[0][0]))
    if by_min: optimized.append(('maximin_train_symbol',by_min[0][0]))
    if by_cost: optimized.append(('maximin_train_cost',by_cost[0][0]))
    for label,params in [('baseline',p) for p in baseline]+optimized:
        key=(label,params)
        if key in seen:continue
        seen.add(key)
        selected.append({'label':label,'parameters':asdict(params),'train':evaluate(params,'train'),
                         'train_1_5x_spread':evaluate(params,'train',1.5),
                         'holdout':evaluate(params,'holdout'),
                         'holdout_1_5x_spread':evaluate(params,'holdout',1.5),
                         'holdout_2x_spread':evaluate(params,'holdout',2)})
    result={'method':'60% chronological train / 40% untouched holdout for each symbol and timeframe',
            'candidate_count':len(candidates),'monetary_stop_usd':STOP_USD,'lots':LOT,
            'current_account_maximum_lot':0.01,
            'spread_assumption':'median realized entry spread by symbol, one tick adverse slippage per fill; 2x spread holdout stress',
            'data_windows':{frame:{'first_bar':datetime.fromtimestamp(min(BARS[frame][s][0]['t'] for s in SYMBOLS)-SERVER_OFFSET_SECONDS,timezone.utc).isoformat(),
                                   'last_closed_bar':datetime.fromtimestamp(max(BARS[frame][s][-2]['t'] for s in SYMBOLS)-SERVER_OFFSET_SECONDS,timezone.utc).isoformat()}
                            for frame in ('M1','M5','M15','M30')},
            'selected':selected,
            'top_train_net':[{'parameters':asdict(p),'train':s,'holdout':evaluate(p,'holdout')} for p,s in by_net[:10]],
            'top_train_maximin':[{'parameters':asdict(p),'train':s,'holdout':evaluate(p,'holdout')} for p,s in by_min[:10]],
            'spreads':SPREADS}
    filename='sma-optimization-2026-11-04.json' if LOT==0.01 and STOP_USD==0.27 else f'sma-optimization-2026-11-04-lot-{LOT:.2f}.json'
    if STOP_USD!=0.27:
        filename=filename.replace('.json',f'-stop-{STOP_USD:.2f}.json')
    (ROOT/filename).write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'candidates':len(candidates),'selected':selected},indent=2))

if __name__=='__main__':main()
