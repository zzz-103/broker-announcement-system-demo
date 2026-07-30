import type { Metadata } from 'next';
import { DeploymentVersionGuard } from '@/components/deployment-version-guard';
import './globals.css';

export const metadata: Metadata = {
  title: '世纪证券业务信息平台',
  description: '聚合公开招采动态、券商 App 更新及相关业务信息',
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
  return (
    <html lang="zh-CN" translate="no" className="notranslate">
      <body className={`antialiased`}>
        <DeploymentVersionGuard />
        {children}
      </body>
    </html>
  );
}
