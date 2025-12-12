/**
 * Live trade tape component
 * Shows recent trades with links to block explorer
 */

import { memo } from 'react'
import { ExternalLink } from 'lucide-react'

export interface TapeRow {
  time: string
  price: string
  size: string
  side: 'buy' | 'sell'
  outcomeLabel: 'Yes' | 'No'
  tx: string
}

export interface LiveTapeProps {
  rows: TapeRow[]
  chainId?: number
}

function LiveTape({ rows, chainId = 56 }: LiveTapeProps) {
  const explorerUrl = chainId === 56 
    ? 'https://bscscan.com' 
    : 'https://testnet.bscscan.com'

  const renderTxLink = (tx: string) => {
    if (!tx || !tx.startsWith('0x')) {
      return <span className="text-[var(--text-muted)]">—</span>
    }

    return (
      <a
        href={`${explorerUrl}/tx/${tx}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[var(--primary-yellow)] hover:drop-shadow-[0_0_5px_rgba(255,208,0,0.5)] transition-all duration-300"
        aria-label={`View transaction ${tx} on BscScan`}
      >
        {tx.slice(0, 6)}
        <ExternalLink className="w-3 h-3" />
      </a>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="glass-card rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <span className="w-2 h-2 bg-[var(--success-green)] rounded-full animate-pulse shadow-[0_0_10px_var(--success-green)]"></span>
          Live Trades
        </h3>
        <p className="text-xs text-[var(--text-muted)] text-center py-4">
          No trades yet. Waiting for on-chain activity...
        </p>
      </div>
    )
  }

  return (
    <div className="glass-card rounded-lg p-4 hover:shadow-xl transition-shadow duration-300">
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <span className="w-2 h-2 bg-[var(--success-green)] rounded-full animate-pulse shadow-[0_0_10px_var(--success-green)]"></span>
        Live Trades
      </h3>
      
      <div className="hidden sm:block space-y-2">
        <div className="grid grid-cols-4 gap-2 text-xs font-medium text-[var(--text-muted)] pb-2 border-b border-[var(--border-color)]">
          <div>Time</div>
          <div className="text-right">Fill Price</div>
          <div className="text-right">Size / Outcome</div>
          <div className="text-right">Tx</div>
        </div>

        <div className="max-h-[300px] overflow-y-auto space-y-1">
          {rows.map((row, idx) => (
            <div 
              key={`${row.tx}-${idx}`}
              className="grid grid-cols-4 gap-2 text-xs text-white py-1.5 px-2 hover:bg-[var(--hover-background)]/30 rounded transition-all duration-300"
            >
              <div className="text-[var(--text-secondary)]">{row.time}</div>
              <div className={`text-right font-mono font-bold ${row.side === 'buy' ? 'text-emerald-300' : 'text-red-300'}`}>
                {row.price}
              </div>
              <div className="flex items-center justify-end gap-2">
                <span className={`font-mono ${row.side === 'buy' ? 'text-emerald-200' : 'text-red-200'}`}>
                  {row.size}
                </span>
                <span
                  className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border ${
                    row.side === 'buy'
                      ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200'
                      : 'bg-red-500/15 border-red-400/40 text-red-200'
                  }`}
                >
                  {row.side === 'buy' ? 'Buy' : 'Sell'} {row.outcomeLabel}
                </span>
              </div>
              <div className="text-right">
                {renderTxLink(row.tx)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="sm:hidden flex flex-col gap-3 max-h-[360px] overflow-y-auto pr-1">
        {rows.map((row, idx) => (
          <div
            key={`${row.tx}-mobile-${idx}`}
            className="rounded-2xl border border-[var(--border-color)]/60 bg-[var(--background)]/70 p-3"
          >
            <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
              <span>{row.time}</span>
              {renderTxLink(row.tx)}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <div className="text-2xl font-mono text-white">{row.price}</div>
              <span
                className={`px-3 py-1 text-[11px] font-semibold rounded-full border ${
                  row.side === 'buy'
                    ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200'
                    : 'bg-red-500/15 border-red-400/40 text-red-200'
                }`}
              >
                {row.side === 'buy' ? 'Buy' : 'Sell'} {row.outcomeLabel}
              </span>
            </div>
            <div className="mt-1 text-xs text-[var(--text-secondary)] flex items-center justify-between">
              <span className="font-mono">{row.size} {row.outcomeLabel}</span>
              <span className="uppercase tracking-wide text-[10px]">
                {row.side === 'buy' ? 'Bullish' : 'Bearish'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default memo(LiveTape)
