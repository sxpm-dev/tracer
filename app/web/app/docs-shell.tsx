"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type PageMapItem = {
  name?: string;
  route?: string;
  title?: string;
  type?: string;
  children?: PageMapItem[];
};

const packages = [
  {
    label: "@sx/runtime-context",
    slug: "runtime-context",
    href: "/runtime-context",
  },
  {
    label: "@sx/tracer",
    slug: "tracer",
    href: "/tracer",
  },
];

function packageFromPath(pathname: string) {
  return packages.find((item) => pathname.startsWith(item.href));
}

function visibleTitle(item: PageMapItem) {
  return item.title ?? item.name;
}

function renderNav(items: PageMapItem[]) {
  return (
    <ul>
      {items
        .filter((item) => item.route && item.name !== "_meta")
        .map((item) => (
          <li key={item.route}>
            <Link href={item.route!}>{visibleTitle(item)}</Link>
            {item.children && item.children.length > 0
              ? renderNav(item.children)
              : null}
          </li>
        ))}
    </ul>
  );
}

function findPackageNav(pageMap: PageMapItem[], slug: string) {
  return pageMap.find((item) => item.name === slug)?.children ?? [];
}

export function DocsShell({
  children,
  pageMap,
}: {
  children: React.ReactNode;
  pageMap: PageMapItem[];
}) {
  const pathname = usePathname();
  const activePackage = packageFromPath(pathname);
  const navItems = activePackage
    ? findPackageNav(pageMap, activePackage.slug)
    : [];
  const isHome = pathname === "/";

  return (
    <>
      <header className="sx-topbar">
        <Link href="/" className="sx-logo" aria-label="@sx documentation">
          <span className="sx-logo-mark" aria-hidden="true" />
          @sx
        </Link>
        <div className="sx-topbar-actions">
          <nav aria-label="Package selector" className="sx-package-selector">
            <Link href="/" aria-current={isHome ? "page" : undefined}>
              Home
            </Link>
            {packages.map((item) => (
              <Link
                key={item.slug}
                href={item.href}
                aria-current={activePackage?.slug === item.slug ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <div className={isHome ? "sx-landing-shell" : "sx-shell"}>
        {!isHome ? (
          <aside className="sx-sidebar" aria-label="Documentation navigation">
            <div className="sx-sidebar-title">{activePackage?.label}</div>
            {renderNav(navItems)}
          </aside>
        ) : null}
        <main className={isHome ? "sx-content sx-content-landing" : "sx-content"}>
          {children}
        </main>
      </div>
      <footer className="sx-footer">
        MIT {new Date().getFullYear()} © @sx runtime instrumentation primitives.
      </footer>
    </>
  );
}
