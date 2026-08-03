import type { Metadata } from 'next';
import './globals.css';
import { basePath } from '@/lib/public-path';

export const metadata: Metadata = {
  title: '世纪证券业务信息平台',
  description: '公开招采动态与券商 App 更新静态看板',
  other: {
    google: 'notranslate',
  },
  icons: {
    icon: [{ url: `${basePath}/brand/company-icon.png`, type: 'image/png', sizes: '168x170' }],
    shortcut: [`${basePath}/brand/company-icon.png`],
    apple: [{ url: `${basePath}/brand/company-icon.png`, type: 'image/png', sizes: '168x170' }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" translate="no" className="notranslate">
      <body className={`antialiased`}>
        {children}
      </body>
    </html>
  );
}
