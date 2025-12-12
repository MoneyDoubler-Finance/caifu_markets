"use client"

import Link from "next/link"
import { ArrowLeft, Globe2, ShieldCheck, SlidersHorizontal, Zap } from "lucide-react"

export default function SettingsPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-transparent via-[var(--background)] to-[var(--background)] pb-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-10">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-10">
          <div>
            <div className="flex items-center text-sm text-[var(--text-secondary)] gap-2 mb-2">
              <Link href="/" className="inline-flex items-center gap-1 hover:text-white transition-colors">
                <ArrowLeft className="w-3 h-3" />
                Back to markets
              </Link>
            </div>
            <h1 className="text-3xl sm:text-4xl font-semibold text-white tracking-tight">
              Platform Settings
            </h1>
            <p className="text-sm sm:text-base text-[var(--text-secondary)] mt-2 max-w-2xl">
              Fine-tune your Caifu workspace. These preferences persist in your browser and help
              you stay aligned with the correct network and telemetry defaults.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <aside className="lg:col-span-1 space-y-4">
            <div className="glass-card rounded-xl p-4 border border-[var(--border-color)]/60">
              <h2 className="text-sm font-semibold text-white uppercase tracking-wide mb-3">Sections</h2>
              <nav className="space-y-2">
                {[
                  { href: "#environment", label: "Environment" },
                  { href: "#security", label: "Wallet & security" },
                  { href: "#performance", label: "Performance" },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block px-3 py-2 rounded-lg text-sm text-[var(--text-secondary)] hover:text-white hover:bg-[var(--hover-background)] transition-all duration-200"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>

            <div className="glass-card rounded-xl p-4 border border-[var(--border-color)]/60">
              <h2 className="text-sm font-semibold text-white uppercase tracking-wide mb-3">Need help?</h2>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                If you run into issues with the beta environment, gather the timestamped artifacts
                from <code className="text-[var(--primary-yellow)]">devtools-artifacts/beta-cycle/</code> and share them in the ops channel.
              </p>
            </div>
          </aside>

          <section className="lg:col-span-2 space-y-6">
            <div id="environment" className="glass-card rounded-xl p-6 border border-[var(--border-color)]/60">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-300">
                  <Globe2 className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Environment</h2>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Verify you are connected to the sanctioned RPC endpoints for testnet operations.
                  </p>
                </div>
              </div>
              <dl className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <dt className="text-sm text-[var(--text-secondary)]">HTTP RPC URL</dt>
                  <dd className="text-sm font-mono text-white break-all">
                    {process.env.NEXT_PUBLIC_RPC_URL || "Not configured"}
                  </dd>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <dt className="text-sm text-[var(--text-secondary)]">Websocket RPC URL</dt>
                  <dd className="text-sm font-mono text-white break-all">
                    {process.env.NEXT_PUBLIC_RPC_WS_URL || "Not configured"}
                  </dd>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <dt className="text-sm text-[var(--text-secondary)]">Chain ID</dt>
                  <dd className="text-sm font-mono text-white">
                    {process.env.NEXT_PUBLIC_CHAIN_ID || "Unknown"}
                  </dd>
                </div>
              </dl>
            </div>

            <div id="security" className="glass-card rounded-xl p-6 border border-[var(--border-color)]/60">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-300">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Wallet & security</h2>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Settings applied locally to keep your test wallets safe during beta validation.
                  </p>
                </div>
              </div>
              <ul className="space-y-3 text-sm text-[var(--text-secondary)]">
                <li className="flex items-start gap-3">
                  <span className="w-2 h-2 rounded-full bg-[var(--primary-yellow)] mt-1"></span>
                  Disable auto-approve in injected wallets and inspect every transaction before signing.
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-2 h-2 rounded-full bg-[var(--primary-yellow)] mt-1"></span>
                  Keep a backup of your burner keys in the team vault; never store them in browser extensions.
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-2 h-2 rounded-full bg-[var(--primary-yellow)] mt-1"></span>
                  Rotate your RPC keys when the quota nears the limit to avoid downtime.
                </li>
              </ul>
            </div>

            <div id="performance" className="glass-card rounded-xl p-6 border border-[var(--border-color)]/60">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-300">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Performance & telemetry</h2>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Tune the client behaviour to line up with backend reconciliation cadence.
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between bg-black/20 rounded-lg p-4 border border-[var(--border-color)]/40">
                  <div>
                    <p className="text-sm font-medium text-white">Auto-refresh markets</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      Uses the settled reconciliation interval (15s) to refresh odds.
                    </p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-full bg-[var(--hover-background)] text-[var(--text-secondary)]">
                    Managed automatically
                  </span>
                </div>

                <div className="flex items-center justify-between bg-black/20 rounded-lg p-4 border border-[var(--border-color)]/40">
                  <div>
                    <p className="text-sm font-medium text-white">Enable beta instrumentation</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      Captures console/network traces for the DevTools artifacts pipeline.
                    </p>
                  </div>
                  <SlidersHorizontal className="w-4 h-4 text-[var(--text-secondary)]" />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
