import type { Metadata, Viewport } from "next";
import "@fontsource-variable/vazirmatn";
import "./globals.css";

import { AgentSheet } from "@/components/agent-sheet";
import { BriefBar } from "@/components/brief-bar";
import { BriefProvider } from "@/components/brief-provider";
import { CompareTrayProvider } from "@/components/compare-tray";

export const metadata: Metadata = {
  title: "پاساژگرد",
  description: "دستیار خرید حضوری از پاساژهای تهران",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fa" dir="rtl" className="h-full antialiased">
      {/* bottom padding keeps the end of the page above the agent sheet */}
      <body className="min-h-full flex flex-col pb-14">
        <BriefProvider>
          <BriefBar />
          <CompareTrayProvider>
            {children}
            <AgentSheet />
          </CompareTrayProvider>
        </BriefProvider>
      </body>
    </html>
  );
}
