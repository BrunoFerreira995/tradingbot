'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  FileText,
  Gauge,
  LayoutDashboard,
  List,
  Settings,
  Shield,
  SlidersHorizontal,
  Wallet,
} from 'lucide-react';
const links = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/signals', label: 'Signals', icon: Activity },
  { href: '/orders', label: 'Orders', icon: List },
  { href: '/positions', label: 'Positions', icon: ArrowLeftRight },
  { href: '/trades', label: 'Trades', icon: BarChart3 },
  { href: '/strategies', label: 'Strategies', icon: SlidersHorizontal },
  { href: '/risk', label: 'Risk Control', icon: Shield },
  { href: '/broker', label: 'Broker', icon: Wallet },
  { href: '/logs', label: 'Audit Logs', icon: FileText },
  { href: '/settings', label: 'Settings', icon: Settings },
];
export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="border-b border-slate-800 bg-[#0d1420] p-5 md:min-h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r md:p-6">
      <Link
        href="/dashboard"
        className="mb-9 flex items-center gap-3 text-lg font-bold tracking-wide"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-400 text-slate-950">
          <Gauge size={21} />
        </span>
        <span>
          AURUM<span className="text-amber-400">.</span>
        </span>
      </Link>
      <div className="mb-3 text-[10px] font-bold uppercase tracking-[.2em] text-slate-500">
        Workspace
      </div>
      <nav className="flex gap-1 overflow-x-auto md:flex-col">
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${pathname === href ? 'bg-amber-400/10 text-amber-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
      </nav>
      <div className="mt-10 hidden rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-xs text-slate-400 md:block">
        <div className="mb-2 font-bold text-amber-300">SAFETY NOTICE</div>
        Every order clears the risk engine and the per-symbol trading lock
        before routing. The active account and mode are shown on the dashboard.
      </div>
    </aside>
  );
}
