import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import './globals.css';

export const metadata: Metadata = {
  title: '世纪证券招采情报平台',
  description: '洞察同行建设方向、公开招采动态、供应商及价格信息',
  other: {
    google: 'notranslate',
  },
  icons: {
    icon: [{ url: '/brand/company-icon.png', type: 'image/png', sizes: '168x170' }],
    shortcut: ['/brand/company-icon.png'],
    apple: [{ url: '/brand/company-icon.png', type: 'image/png', sizes: '168x170' }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';

  return (
    <html lang="zh-CN" translate="no" className="notranslate">
      <head>
        <meta httpEquiv="Content-Language" content="zh-CN" />
      </head>
      <body className={`antialiased`}>
        {isDev && <Inspector />}
        {children}
      </body>
    </html>
  );
}
