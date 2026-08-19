export const metadata = {
  title: 'Blob Battle — Overlay',
  description: 'Overlay TikTok Live style agar.io',
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ margin: 0, background: 'transparent' }}>{children}</body>
    </html>
  );
}
