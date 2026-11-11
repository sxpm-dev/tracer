import { getPageMap } from "nextra/page-map";
import { DocsShell } from "./docs-shell";
import "./styles.css";

export const metadata = {
  title: {
    default: "sx-tracing · Technical overview",
    template: "%s | sx-tracing",
  },
  description:
    "Stack-based runtime tracing, recordings, extensible dashboards, and evidence-driven execution analysis.",
  icons: {
    icon: `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/icon.svg`,
  },
};

type PageMapItem = {
  name?: string;
  route?: string;
  title?: string;
  type?: string;
  children?: PageMapItem[];
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pageMap = (await getPageMap()) as PageMapItem[];

  return (
    <html lang="en" dir="ltr">
      <body>
        <DocsShell pageMap={pageMap}>{children}</DocsShell>
      </body>
    </html>
  );
}
