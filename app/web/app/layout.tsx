import { getPageMap } from "nextra/page-map";
import { DocsShell } from "./docs-shell";
import "./styles.css";

export const metadata = {
  title: {
    default: "@sx Docs",
    template: "%s | @sx Docs",
  },
  description:
    "Documentation for @sx/runtime-context and @sx/tracer, small runtime instrumentation primitives for JavaScript.",
  icons: {
    icon: "/icon.svg",
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
