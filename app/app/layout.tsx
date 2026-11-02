import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import { Sidebar } from '@/components/Sidebar';
import { config } from '@/lib/config';
import { Providers } from './providers';
import './globals.css';

/**
 * The original stylesheet referenced 'Inter' but never loaded it, so it silently
 * fell back to system-ui. next/font loads it properly and exposes it as a CSS
 * variable the stylesheet consumes.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: config.title,
  description: `Entity resolution and data quality for ${config.domain}`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <Providers>
          <div className="app-shell">
            <Sidebar />
            <div className="app-body">
              <main id="main-content">
                {children}
                <div className="footer-strip">
                  <span>{config.title}</span>
                  <span>Snowflake App Runtime</span>
                </div>
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
