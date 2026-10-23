import type { Metadata, Viewport } from "next";
import "@fontsource-variable/vazirmatn";
import "./globals.css";

import { AgentSheet } from "@/components/agent-sheet";
import { BriefProvider } from "@/components/brief-provider";
import { CompareTrayProvider } from "@/components/compare-tray";

export const metadata: Metadata = {
  title: "پاساژگرد",
  description: "دستیار خرید حضوری از پاساژهای تهران",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f5f9" },
    { media: "(prefers-color-scheme: dark)", color: "#15202b" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fa" dir="rtl" className="h-full antialiased">
      {/* bottom padding keeps the end of the page above the agent sheet */}
      <body className="min-h-full flex flex-col pb-14">
        <BriefProvider>
          <CompareTrayProvider>
            {children}
            <AgentSheet />
          </CompareTrayProvider>
        </BriefProvider>
      </body>
    </html>
  );
}
