import type {Metadata} from 'next';
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: 'The Ledger - Apocrypha DXD: ForeverWorlds',
  description: 'Persistent writing library, document archive, and receipt provenance system for Apocrypha DXD: ForeverWorlds.',
  openGraph: {
    title: 'The Ledger - Apocrypha DXD: ForeverWorlds',
    description: 'Persistent writing library, document archive, and receipt provenance system for Apocrypha DXD: ForeverWorlds.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Ledger - Apocrypha DXD: ForeverWorlds',
    description: 'Persistent writing library, document archive, and receipt provenance system for Apocrypha DXD: ForeverWorlds.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
