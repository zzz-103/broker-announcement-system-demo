import type { Metadata } from 'next';
import { DeploymentVersionGuard } from '@/components/deployment-version-guard';
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
  return (
    <html lang="zh-CN" translate="no" className="notranslate">
      <body className={`antialiased`}>
        <DeploymentVersionGuard />
        {children}
      </body>
    </html>
  );
}
