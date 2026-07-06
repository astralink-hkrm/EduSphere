import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EduSphere OCR",
  description: "Multi-Model OCR Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
          height: "44px", display: "flex", alignItems: "center", gap: "4px",
          padding: "0 12px", background: "#fff",
          borderBottom: "1px solid var(--border)",
          fontSize: "0.85rem",
        }}>
          <a href="/" style={{ color: "var(--accent)", fontWeight: 700, textDecoration: "none", fontSize: "1rem", marginRight: "16px" }}>
            EduSphere OCR
          </a>
          <a href="/" style={{ color: "var(--text-secondary)", textDecoration: "none", padding: "4px 12px", borderRadius: "4px" }}>
            Home
          </a>
          <a href="/settings" style={{ color: "var(--text-secondary)", textDecoration: "none", padding: "4px 12px", borderRadius: "4px" }}>
            Settings
          </a>
          <div style={{ flexGrow: 1 }} />
          <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>AI Document Analysis</span>
        </div>
        <div style={{ paddingTop: "44px", minHeight: "100vh" }}>
          {children}
        </div>
      </body>
    </html>
  );
}
