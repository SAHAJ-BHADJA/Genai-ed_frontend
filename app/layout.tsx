import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'sonner';
import ModelWarmupBootstrap from '@/components/ModelWarmupBootstrap';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://app.cogitatis.ai'),
  title: 'Cogitatis AI',
  description: 'Cogitatis AI learning platform',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
  openGraph: {
    title: 'Cogitatis AI',
    description: 'Cogitatis AI learning platform',
    images: [
      {
        url: 'https://bolt.new/static/og_default.png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Cogitatis AI',
    description: 'Cogitatis AI learning platform',
    images: [
      {
        url: 'https://bolt.new/static/og_default.png',
      },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ModelWarmupBootstrap />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
