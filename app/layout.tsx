import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Planning Poker", description: "Rösta på estimat och spara resultat till CSV." };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) { return <html lang="sv"><body>{children}</body></html>; }
