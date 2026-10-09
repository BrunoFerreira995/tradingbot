import './globals.css';
import type { Metadata } from 'next';
import { Sidebar } from '../components/sidebar';
export const metadata: Metadata = {
  title: 'Aurum Terminal',
  description: 'TradingView paper trading terminal',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="min-h-screen md:flex">
          <Sidebar />
          <main className="min-w-0 flex-1 px-5 py-6 md:px-9 md:py-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
