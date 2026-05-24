import type { Metadata } from "next";
import "./globals.css";
import { SideNav } from "./_components/SideNav";

export const metadata: Metadata = {
  title: "AI Invoice Auditor",
  description: "Multi-agent invoice auditing dashboard powered by LangGraph + Groq",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col gap-4 px-4 py-6 md:flex-row md:gap-6 md:py-6 lg:px-8">
          <SideNav />
          <main className="min-w-0 flex-1 pb-12">{children}</main>
        </div>
      </body>
    </html>
  );
}
