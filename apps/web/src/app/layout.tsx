import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Providers } from "@/app/providers";
import "@/shared/styles/globals.css";

export const metadata: Metadata = {
  title: "Capella HR",
  description: "نظام إدارة الموارد البشرية"
};

/**
 * Root layout. `lang="ar"` + `dir="rtl"` make Arabic right-to-left the
 * document default; Tailwind logical utilities (ms-/me-/ps-/pe-) flip with it.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
