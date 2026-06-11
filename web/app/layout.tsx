import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { APP_NAME } from "@/lib/env";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const DESCRIPTION =
  "Search ranked, timestamped moments inside long-form videos by what was said and what was on screen. Surfaced as a web portal and a remote MCP server.";

export const metadata: Metadata = {
  metadataBase: new URL("https://acq-search-v1.vercel.app"),
  title: { default: APP_NAME, template: `%s — ${APP_NAME}` },
  description: DESCRIPTION,
  openGraph: {
    title: APP_NAME,
    description: DESCRIPTION,
    type: "website",
    url: "/",
    siteName: APP_NAME,
  },
  twitter: {
    card: "summary",
    title: APP_NAME,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
