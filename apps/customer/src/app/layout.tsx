import type { Metadata } from 'next';
import { Providers } from './providers';
import CustomerSidebar from '../components/CustomerSidebar';
import './globals.css';

export const metadata: Metadata = { title: 'My Account - Hikonnect' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", margin: 0 }}>
        <Providers>
          <CustomerSidebar>{children}</CustomerSidebar>
        </Providers>
      </body>
    </html>
  );
}
