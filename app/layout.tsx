import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: "RuiFit 健康测评",
  description: "用 3 分钟了解身体状态，获得清晰的健康趋势预览。",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "RuiFit 健康测评",
    description: "更了解身体，再开始改变。",
    type: "website",
    locale: "zh_CN",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "RuiFit 健康测评" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "RuiFit 健康测评",
    description: "更了解身体，再开始改变。",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
