/** MetaTrader ACCOUNT_TRADE_MODE: 0 demo, 1 contest, 2 real. */
export type TradingMode = 'paper' | 'live';
export type TradingModePolicy = TradingMode | 'auto';

export function resolveAccountMode(
  beat: { tradeMode: number; login: number },
  policy: TradingModePolicy,
  liveAck: string | undefined,
): TradingMode {
  if (!Number.isSafeInteger(beat.login) || beat.login <= 0)
    throw new Error('Invalid MetaTrader account login');
  if (beat.tradeMode !== 0 && beat.tradeMode !== 1 && beat.tradeMode !== 2)
    throw new Error(`Unknown MetaTrader account trade mode: ${beat.tradeMode}`);
  const detected: TradingMode = beat.tradeMode === 2 ? 'live' : 'paper';
  if (policy !== 'auto' && policy !== detected)
    throw new Error(`TRADING_MODE=${policy} but terminal account ${beat.login} is ${detected}`);
  if (detected === 'live' && liveAck !== String(beat.login))
    throw new Error(`Real account ${beat.login} requires matching MT5_LIVE_ACK`);
  return detected;
}
