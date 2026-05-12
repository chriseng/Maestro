import type { Theme } from '../../../constants/themes';
import type { FileTreeIndices } from '../../../utils/remarkFileLinks';

/**
 * One rendered top-level block from a markdown document. The Fast tier emits an
 * ordered array of these and feeds them to a virtualizer; each block is a
 * standalone unit of layout that can be mounted/unmounted independently.
 */
export interface MarkdownBlock {
	/** Stable index within a single parse output (0-based, monotonic). */
	id: number;
	/** Unsanitized HTML for this block. Sanitization happens at render time. */
	html: string;
	/**
	 * Slug of the heading that opens this block, when the block IS a heading.
	 * Used by the TOC scroll-to mechanism to map a clicked TOC entry to a
	 * block index for `virtuoso.scrollToIndex`. Undefined for non-heading
	 * blocks (paragraphs, lists, code, etc.).
	 */
	headingSlug?: string;
}

/**
 * Imperative handle exposed by the Fast tier preview so the parent's TOC
 * can scroll to a heading by slug. The slug-to-block-index lookup is owned
 * by the preview because it has the parsed block array; callers only need
 * to know the slug.
 */
export interface MarkdownPreviewFastHandle {
	scrollToHeading: (slug: string) => boolean;
}

/**
 * Props accepted by the Fast tier markdown preview component.
 *
 * The component is intentionally read-only: edit mode lives in the parent
 * FilePreview and uses a separate textarea path.
 */
export interface MarkdownPreviewFastProps {
	content: string;
	theme: Theme;
	/** Bridged ref so the parent's existing search/scroll hooks can target the scrollable element. */
	markdownContainerRef: React.MutableRefObject<HTMLDivElement | null>;
	fileTreeIndices?: FileTreeIndices | null;
	cwd?: string;
	homeDir?: string;
	projectRoot?: string;
	filePath?: string;
	onFileClick?: (filePath: string, opts?: { openInNewTab?: boolean }) => void;
	onExternalLinkClick?: (href: string, opts?: { ctrlKey?: boolean }) => void;
}

/**
 * Click modifiers extracted from a DOM MouseEvent. Decoupled so linkRouter can
 * be tested without constructing a real event.
 */
export interface ClickModifiers {
	metaKey: boolean;
	ctrlKey: boolean;
	button: number;
}

/**
 * Minimal description of a clicked anchor element. Decouples linkRouter from
 * DOM APIs so it can be unit-tested with plain objects.
 */
export interface LinkDescriptor {
	href: string;
	dataMaestroFile: string | null;
}

/**
 * Outcome of routing a click on a markdown link. The router decides what
 * should happen; the caller wires the corresponding side effect.
 */
export type LinkAction =
	| { kind: 'maestro-file'; path: string; openInNewTab: boolean }
	| { kind: 'external'; href: string; openInNewTab: boolean }
	| { kind: 'anchor'; hash: string }
	| { kind: 'none' };
