import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'DriftDraw',
  description: 'An async multiplayer telephone drawing game.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
