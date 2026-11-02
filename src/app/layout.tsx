import type { Metadata } from "next";
import { Geist, Geist_Mono, Patrick_Hand } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const hand = Patrick_Hand({ variable: "--font-hand", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "Paper Worlds",
  description: "Draw a game level on paper and play it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${hand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
