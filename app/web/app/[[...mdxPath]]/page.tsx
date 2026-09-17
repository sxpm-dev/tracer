import { generateStaticParamsFor, importPage } from "nextra/pages";

type PageProps = {
  params: Promise<{
    mdxPath?: string[];
  }>;
};

export const generateStaticParams = generateStaticParamsFor("mdxPath");

export async function generateMetadata(props: PageProps) {
  const params = await props.params;
  const { metadata } = await importPage(params.mdxPath);
  return metadata;
}

export default async function Page(props: PageProps) {
  const params = await props.params;
  const { default: MDXContent } = await importPage(params.mdxPath);

  return <MDXContent {...props} params={params} />;
}
