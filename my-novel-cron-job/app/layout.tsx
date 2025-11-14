import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Novel Cron Job",
  description: "A cron job to update novels.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
