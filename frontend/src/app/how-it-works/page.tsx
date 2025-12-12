'use client'

import Link from 'next/link'
import {
  ArrowRight,
  HandCoins,
  Sparkles,
  ShieldCheck,
  SquareStack,
  ClipboardCheck,
  Blocks,
} from 'lucide-react'

const CARD_BASE =
  'relative overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--card-background)]/80 p-6 shadow-lg shadow-black/20 backdrop-blur transition-all hover:-translate-y-1 hover:border-[var(--primary-yellow)]/60 hover:shadow-[var(--primary-yellow)]/20'

const Glow = ({ className }: { className?: string }) => (
  <div
    className={`pointer-events-none absolute rounded-full blur-3xl opacity-60 bg-[var(--primary-yellow)] ${className}`}
  />
)

const StepCard = ({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType
  title: string
  description: string
}) => (
  <div className={CARD_BASE}>
    <Glow className="w-56 h-56 -top-16 -right-10" />
    <div className="relative flex items-center gap-5">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--hover-background)] text-[var(--primary-yellow)] shadow-inner shadow-[var(--primary-yellow)]/40">
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="text-sm text-[var(--text-muted)] leading-6">{description}</p>
      </div>
    </div>
  </div>
)

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-[var(--background)] pb-24">
      <section className="relative overflow-hidden border-b border-[var(--border-color)] bg-gradient-to-b from-[#11131f] via-[#0b0d18] to-transparent py-16">
        <Glow className="w-[420px] h-[420px] top-[-120px] left-[-120px]" />
        <Glow className="w-[480px] h-[480px] top-[-200px] right-[-160px]" />
        <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 text-center">
          <span className="mx-auto inline-flex items-center gap-2 rounded-full border border-[var(--border-color)] bg-[var(--card-background)]/60 px-4 py-1 text-xs font-medium uppercase tracking-[0.3em] text-[var(--text-secondary)]">
            Learn the Flow
          </span>
          <h1 className="text-4xl font-bold text-white md:text-5xl">
            How Caifu Prediction Markets Work
          </h1>
          <p className="mx-auto max-w-2xl text-base text-[var(--text-muted)] md:text-lg">
            Bid on real world outcomes, mint your own markets, and bring custom artwork to the front
            page. Here’s the playbook for getting everything up and running in minutes.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/markets"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--primary-yellow)] px-6 py-3 text-sm font-semibold text-black shadow-lg shadow-[var(--primary-yellow)]/40 transition hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-[var(--primary-yellow)]/70 focus:ring-offset-2 focus:ring-offset-black"
            >
              Explore markets <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/admin/market/new"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border-color)] px-6 py-3 text-sm font-semibold text-white transition hover:border-[var(--primary-yellow)]/60"
            >
              Create a market
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-16 max-w-5xl px-4">
        <h2 className="mb-6 text-3xl font-semibold text-white">Pick a side and enter the market</h2>
        <p className="mb-10 text-[var(--text-muted)] md:text-lg">
          Market prices reflect crowd sentiment. Every trade keeps the{' '}
          <span className="text-[var(--primary-yellow)]">constant product market maker</span>{' '}
          balanced: buying <em>Yes</em> nudges the probability upward, while buying <em>No</em>{' '}
          pushes it down.
        </p>
        <div className="grid gap-6 md:grid-cols-2">
          <StepCard
            icon={HandCoins}
            title="1. Connect & fund"
            description="Connect your wallet, mint testnet USDF, and you’re ready. No faucets, no hoops."
          />
          <StepCard
            icon={Sparkles}
            title="2. Pick your conviction"
            description="Select a market, choose Yes or No, enter how much to risk, and confirm the swap."
          />
          <StepCard
            icon={ShieldCheck}
            title="3. Hold or flip"
            description="Your position tracks the price in real time. Sell early or hold until the outcome settles."
          />
          <StepCard
            icon={ClipboardCheck}
            title="4. Redeem on resolution"
            description="Once an admin resolves the market, winning tokens convert back to USDF 1:1."
          />
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-5xl px-4">
        <div className={CARD_BASE}>
          <Glow className="w-72 h-72 -left-24 top-0" />
          <div className="relative grid gap-10 md:grid-cols-[1.2fr_1fr]">
            <div className="space-y-6">
              <h2 className="text-3xl font-semibold text-white">Create a market in three clicks</h2>
              <p className="text-[var(--text-muted)]">
                Admins can spin up battles in seconds. Pick a question, lock in a category, set
                outcomes, and seed the pool with a single click. The backend auto-mints the FPMM,
                syncs trades, and broadcasts live updates.
              </p>
              <ul className="space-y-4 text-sm text-[var(--text-muted)]">
                <li className="flex items-start gap-3">
                  <Blocks className="mt-1 h-4 w-4 text-[var(--primary-yellow)]" />
                  <span>
                    <span className="text-white">Binary by design</span> – two opposing outcomes keep
                    pricing fast and intuitive.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <SquareStack className="mt-1 h-4 w-4 text-[var(--primary-yellow)]" />
                  <span>
                    <span className="text-white">Auto liquidity</span> – seeding deploys the pool,
                    mints balances, and queues the indexer without manual sweeps.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Sparkles className="mt-1 h-4 w-4 text-[var(--primary-yellow)]" />
                  <span>
                    <span className="text-white">Custom polish</span> – drop background art for tags
                    or categories so the homepage tiles are actually worth scrolling.
                  </span>
                </li>
              </ul>
              <Link
                href="/admin/market/new"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border-color)] px-5 py-2 text-sm font-semibold text-white transition hover:border-[var(--primary-yellow)]/70"
              >
                Launch a market
              </Link>
            </div>
            <div className="space-y-4 rounded-2xl border border-[var(--border-color)] bg-[#101321]/80 p-6">
              <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-[var(--text-muted)]">
                Quick recipe
              </h3>
              <ol className="space-y-3 text-sm text-[var(--text-muted)]">
                <li className="rounded-lg bg-black/30 px-4 py-3">
                  <span className="text-white">Question:</span> Will BTC make a new all-time high in
                  2025?
                </li>
                <li className="rounded-lg bg-black/30 px-4 py-3">
                  <span className="text-white">Outcomes:</span> Yes / No
                </li>
                <li className="rounded-lg bg-black/30 px-4 py-3">
                  <span className="text-white">Category & tags:</span> Crypto · Bitcoin, Markets
                </li>
                <li className="rounded-lg bg-black/30 px-4 py-3">
                  <span className="text-white">Seed:</span> 1,000 USDF → pool deploys instantly
                </li>
              </ol>
              <p className="rounded-lg border border-dashed border-[var(--border-color)]/60 bg-black/20 px-4 py-3 text-xs text-[var(--text-muted)]">
                Need a hero image? Head to{' '}
                <Link
                  className="font-semibold text-[var(--primary-yellow)] hover:underline"
                  href="/admin/tile-backgrounds"
                >
                  /admin/tile-backgrounds
                </Link>{' '}
                to upload a tag background. Tiles matching “Taylor Swift” or “Israel” will render the
                art automatically.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-5xl px-4">
        <h2 className="mb-6 text-3xl font-semibold text-white">Tips to trade like a pro</h2>
        <div className="grid gap-6 md:grid-cols-3">
          <div className={CARD_BASE}>
            <Glow className="w-48 h-48 -top-12 left-1/2 -translate-x-1/2" />
            <h3 className="relative text-lg font-semibold text-white">Watch the odds</h3>
            <p className="relative text-sm text-[var(--text-muted)] leading-6">
              Prices are probabilities. 0.63 implies a 63% chance. Buying pushes odds toward your
              side; selling swings it back.
            </p>
          </div>
          <div className={CARD_BASE}>
            <Glow className="w-40 h-40 -bottom-16 right-0" />
            <h3 className="relative text-lg font-semibold text-white">Check liquidity</h3>
            <p className="relative text-sm text-[var(--text-muted)] leading-6">
              TVL matters. Deeper pools mean tighter fills and less slippage, especially for larger
              trades.
            </p>
          </div>
          <div className={CARD_BASE}>
            <Glow className="w-40 h-40 top-0 right-0" />
            <h3 className="relative text-lg font-semibold text-white">Ride the momentum</h3>
            <p className="relative text-sm text-[var(--text-muted)] leading-6">
              Use the live ticker and price chart to see how sentiment moves when news hits. Fast
              traders scoop the edge.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-5xl px-4">
        <div className="rounded-3xl border border-[var(--border-color)] bg-[#0f121f] p-10 text-center shadow-xl shadow-black/30">
          <h2 className="mb-4 text-3xl font-semibold text-white">Ready to try it live?</h2>
          <p className="mx-auto mb-8 max-w-2xl text-[var(--text-muted)]">
            Markets update in real time, assets stay on-chain, and every trade tilts the odds. Jump
            into the live boards or craft the next big story.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border-color)] px-6 py-3 text-sm font-semibold text-white transition hover:border-[var(--primary-yellow)]/70"
            >
              Back to homepage
            </Link>
            <Link
              href="/admin/tile-backgrounds"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--primary-yellow)] px-6 py-3 text-sm font-semibold text-black shadow-lg shadow-[var(--primary-yellow)]/40 transition hover:scale-[1.02]"
            >
              Personalize tiles <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
