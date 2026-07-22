import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "世纪证券招采情报平台",
  description: "Coze 对公展示版",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
