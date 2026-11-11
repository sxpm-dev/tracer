import Link from "next/link";
import { existsSync } from "node:fs";
import path from "node:path";
import { generateStaticParamsFor, importPage } from "nextra/pages";
import { guides } from "../../lib/guides.mjs";

type PageProps = { params: Promise<{ mdxPath?: string[] }> };
export const generateStaticParams = generateStaticParamsFor("mdxPath");
export const dynamicParams = false;
export async function generateMetadata(props: PageProps) {
  const params = await props.params;
  const { metadata } = await importPage(params.mdxPath);
  return metadata;
}
export default async function Page(props: PageProps) {
  const params = await props.params;
  const { default: MDXContent, toc } = await importPage(params.mdxPath);
  const current = guides.findIndex(([, slug]) => params.mdxPath?.join('/') === `guide/${slug}`);
  const contentPath = params.mdxPath?.join('/') || 'index';
  const legacySource = existsSync(path.join(process.cwd(), 'content', `${contentPath}.mdx`)) ? `${contentPath}.mdx` : `${contentPath}/index.mdx`;
  const source = current >= 0 ? guides[current][3] : `app/web/content/${legacySource}`;
  const headings = toc.filter(heading => heading.depth === 2);
  return <div className="sx-article-layout">
    <article className="sx-article">
      <MDXContent {...props} params={params} />
      <div className="sx-article-source"><a href={`https://github.com/tuchk4/sx-tracing/blob/main/${source}`}>View page source on GitHub</a></div>
      {current >= 0 && <nav className="sx-pagination" aria-label="Adjacent guides">
        {current > 0 ? <Link href={`/guide/${guides[current - 1][1]}/`}><span>Previous</span>{guides[current - 1][2]}</Link> : <span />}
        {current < guides.length - 1 && <Link href={`/guide/${guides[current + 1][1]}/`}><span>Next</span>{guides[current + 1][2]}</Link>}
      </nav>}
    </article>
    {headings.length > 0 && <aside className="sx-toc" aria-label="On this page"><p>On this page</p><ul>{headings.map(heading => <li key={heading.id}><a href={`#${heading.id}`}>{heading.value}</a></li>)}</ul></aside>}
  </div>;
}
