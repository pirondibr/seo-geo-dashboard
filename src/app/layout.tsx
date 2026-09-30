import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GEO Dashboard",
  description: "Visibilidade em IA — painel da agência",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
