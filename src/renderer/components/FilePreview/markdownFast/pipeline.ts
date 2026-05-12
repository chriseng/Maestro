import { splitFrontmatter } from './frontmatter';
import { createParser } from './parser';
import { tokensToBlocks } from './blocks';
import { applyHeadingSlugs } from './headingSlugger';
import type { MarkdownBlock } from './types';

/**
 * Top-level orchestrator: takes a raw markdown source string and returns the
 * ordered block array that the virtualizer will render.
 *
 * Pure (no DOM, no React) — fully unit-testable.
 *
 * Pipeline stages:
 *   1. Strip and render YAML frontmatter (frontmatter.ts).
 *   2. Tokenize the body with markdown-it (parser.ts).
 *   3. Group tokens into top-level blocks (blocks.ts).
 *   4. Prepend the frontmatter block (if any) and renumber ids so the array
 *      is a single contiguous sequence.
 */
export function buildBlocks(source: string): MarkdownBlock[] {
	const { frontmatterHtml, body } = splitFrontmatter(source);

	const md = createParser();
	const tokens = md.parse(body, {});
	applyHeadingSlugs(md, tokens);
	const bodyBlocks = tokensToBlocks(md, tokens);

	const all: MarkdownBlock[] = [];
	let id = 0;
	if (frontmatterHtml) {
		all.push({ id: id++, html: frontmatterHtml });
	}
	for (const block of bodyBlocks) {
		all.push({ ...block, id: id++ });
	}
	return all;
}
