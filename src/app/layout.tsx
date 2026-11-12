import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
export const metadata: Metadata = {
  title: "ComicFlow AI — Recap Studio",
  description: "Turn authorized comic pages into cinematic recap videos.",
  applicationName: "ComicFlow AI"
};
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
