import type { MDXComponents } from "nextra/mdx-components";
import { useMDXComponents as useNextraComponents } from "nextra/mdx-components";

export function useMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...useNextraComponents(components ?? {}),
  };
}
