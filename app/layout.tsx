import "mapbox-gl/dist/mapbox-gl.css";
import "./globals.css";

export const metadata = {
  title: "StoryMap",
  description: "Every photo, on the spot where it was taken.",
};

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body className="bg-neutral-950 text-neutral-900 antialiased dark:text-neutral-100">{children}</body>
    </html>
  );
}
