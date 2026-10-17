import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, Instrument_Sans } from 'next/font/google';
import './globals.css';

const brand = Cormorant_Garamond({ subsets: ['latin'], weight: ['500', '600'], style: ['normal', 'italic'], variable: '--font-brand' });
const ui = Instrument_Sans({ subsets: ['latin'], variable: '--font-ui' });

export const metadata: Metadata = {
  title: 'Divina S58 · Exhaust Acoustic Simulator',
  description: 'Physics-based digital-waveguide simulation of the BMW S58 with the Divina quad-tip equal-length exhaust.',
};
export const viewport: Viewport = { themeColor: '#050505', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${brand.variable} ${ui.variable}`}>
      <body className="min-h-screen bg-ink text-sand antialiased">{children}</body>
    </html>
  );
}
