import type { Metadata } from "next";
import { IBM_Plex_Sans, Work_Sans } from "next/font/google";
import { getCompanySettings } from "@/lib/company";
import "./globals.css";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const workSans = Work_Sans({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const company = await getCompanySettings();
  return {
    title: {
      default: company.legalName,
      template: `%s | ${company.legalName}`,
    },
    description: `Invoicing and accounting for ${company.legalName}.`,
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${ibmPlexSans.variable} ${workSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
