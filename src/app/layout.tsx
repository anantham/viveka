import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Viveka",
  description: "Attentional scaffolding for human-AI interaction",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-stone-950 text-stone-200 min-h-screen font-mono antialiased">
        {children}
      </body>
    </html>
  );
}
