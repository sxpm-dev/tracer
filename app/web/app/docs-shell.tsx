"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { guides } from "../lib/guides.mjs";

type PageMapItem = { name?: string; route?: string; title?: string; children?: PageMapItem[] };
const sections = [...new Set(guides.map(([section]) => section))];
const cleanPath = (path: string) => path.replace(/\/$/, "") || "/";

export function DocsShell({ children, pageMap }: { children: React.ReactNode; pageMap: PageMapItem[] }) {
  const pathname = cleanPath(usePathname());
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const visible = guides.filter((row) => `${row[0]} ${row[2]}`.toLowerCase().includes(query.trim().toLowerCase()));
  const legacy = pageMap.find(item => item.name && ["tracer", "runtime-context"].includes(item.name) && pathname.startsWith(`/${item.name}`));
  function navLink(href: string, title: string) {
    return <Link href={href} aria-current={pathname === cleanPath(href) ? "page" : undefined} onClick={() => setOpen(false)}>{title}</Link>;
  }
  function legacyNav(items: PageMapItem[]): React.ReactNode {
    return <ul>{items.filter(item => item.route).map(item => <li key={item.route}>{navLink(item.route!, item.title || item.name || "Overview")}{item.children ? legacyNav(item.children) : null}</li>)}</ul>;
  }
  return <>
    <a className="sx-skip" href="#main-content">Skip to content</a>
    <header className="sx-topbar">
      <Link href="/" className="sx-logo" aria-label="sx-tracing overview"><svg width="25" height="25" viewBox="0 0 25 25" aria-hidden="true"><path d="M5 4v17M5 8h9v6h6M5 18h9" fill="none" stroke="currentColor" strokeWidth="1.5"/><circle cx="20" cy="14" r="2" fill="currentColor"/></svg>sx-tracing</Link>
      <span className="sx-topbar-description">Runtime instrumentation for JavaScript</span>
      <a className="sx-repository" href="https://github.com/tuchk4/sx-tracing">GitHub <span aria-hidden="true">↗</span></a>
    </header>
    <div className="sx-shell">
      <aside className="sx-sidebar" aria-label="Documentation navigation">
        <button className="sx-menu-toggle" aria-expanded={open} aria-controls="site-navigation" onClick={() => setOpen(!open)}>Browse documentation <span aria-hidden="true">{open ? '−' : '+'}</span></button>
        <nav id="site-navigation" className={open ? "sx-navigation is-open" : "sx-navigation"}>
          <label className="sx-filter-label" htmlFor="filter-guides">Find a topic</label>
          <input id="filter-guides" type="search" placeholder="Filter topics…" value={query} onChange={event => setQuery(event.target.value)} />
          {navLink("/", "Technical overview")}
          {sections.map(section => {
            const items = visible.filter(([group]) => group === section);
            return items.length ? <section className="sx-nav-group" key={section}><h2>{section}</h2><ul>{items.map(([, slug, title]) => <li key={slug}>{navLink(`/guide/${slug}/`, title)}</li>)}</ul></section> : null;
          })}
          {query && !visible.length && <p role="status" className="sx-no-results">No matching topics. Try “stack”, “cache”, or “dashboard”.</p>}
          {!query && <section className="sx-nav-group"><h2>Independent libraries</h2><ul><li>{navLink('/runtime-context/', '@sx/runtime-context')}</li><li>{navLink('/tracer/', '@sx/tracer')}</li></ul>{legacy?.children ? legacyNav(legacy.children) : null}</section>}
        </nav>
      </aside>
      <main id="main-content" className="sx-content" tabIndex={-1}>{children}</main>
    </div>
    <footer className="sx-footer"><span>sx-tracing · MIT</span><a href="https://github.com/tuchk4/sx-tracing/tree/main/docs">Read the Markdown on GitHub</a></footer>
  </>;
}
