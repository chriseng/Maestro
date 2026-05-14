import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { EditorState, EditorSelection, StateEffect, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { buildBaseExtensions } from './extensions';
import { buildEditorTheme } from './themeAdapter';
import { loadLanguageExtension, hasLanguageSupport } from './languageLoader';
import { findAllInDoc } from './searchEngine';
import type { GiantPreviewHandle, GiantPreviewProps } from './types';

/**
 * Giant tier preview for multi-MB / multi-million-line files.
 *
 * Uses CodeMirror 6 in read-only mode. CM6 renders the document via its own
 * virtualization (only the visible viewport is in the DOM), so 50 MB files
 * mount instantly. Built-in search panel + CodeMirror language packs cover
 * find / syntax highlighting.
 *
 * Thin React shell — the heavy lifting (extension composition, theme
 * mapping, language loading, search bridge) lives in sibling modules.
 *
 * Lifecycle:
 *   1. Mount: create `EditorState` synchronously with base extensions
 *      (read-only, search, line numbers) + theme. Document mounts immediately.
 *   2. Async: kick off `loadLanguageExtension(language)`. When it resolves,
 *      dispatch a `reconfigure` to inject the language extension. The text
 *      already on screen re-tokenizes — usually unnoticeable.
 *   3. Cleanup: `view.destroy()` on unmount.
 *
 * Content / theme changes: rather than mutating the existing state we
 * destroy and rebuild the view. CM6 transactions COULD mutate the doc, but
 * for huge documents the rebuild cost is negligible and the code is simpler.
 */
export const GiantPreview = forwardRef<GiantPreviewHandle, GiantPreviewProps>(function GiantPreview(
	{ content, language, theme, containerRef, filePath: _filePath },
	ref
) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const viewRef = useRef<EditorView | null>(null);
	const [_isReady, setIsReady] = useState(false);

	// Base extensions don't depend on content — memoize to avoid rebuilding on each render.
	const baseExtensions = useMemo<Extension[]>(
		() => [buildBaseExtensions(), buildEditorTheme(theme)],
		[theme]
	);

	// Mount / remount the editor when content, language or theme changes.
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		const state = EditorState.create({
			doc: content,
			extensions: baseExtensions,
		});

		const view = new EditorView({ state, parent: host });
		viewRef.current = view;
		setIsReady(true);

		// Asynchronously load the language pack and reconfigure once it
		// arrives. Plain text / unsupported languages skip this entirely.
		let cancelled = false;
		if (hasLanguageSupport(language)) {
			void loadLanguageExtension(language).then((langExt) => {
				if (cancelled || !langExt || !viewRef.current) return;
				viewRef.current.dispatch({
					effects: StateEffect.reconfigure.of([...baseExtensions, langExt]),
				});
			});
		}

		return () => {
			cancelled = true;
			view.destroy();
			viewRef.current = null;
			setIsReady(false);
		};
	}, [content, language, baseExtensions]);

	// Bridge CM6's content element (not the host) to the parent containerRef.
	// useFilePreviewSearch walks this container for DOM ranges to register CSS
	// Highlights; scoping to `.cm-content` excludes the gutter (line numbers)
	// so a search like "123" doesn't paint highlights on gutter digits and
	// also keeps the all-matches count accurate when CM6's own match-count
	// has to agree with the DOM-walker fallback.
	useEffect(() => {
		if (!containerRef) return;
		const host = hostRef.current;
		const contentEl = host?.querySelector<HTMLElement>('.cm-content') ?? host;
		containerRef.current = contentEl;
	});

	useImperativeHandle(
		ref,
		() => ({
			findInContent: (query: string) => {
				const view = viewRef.current;
				if (!view) return [];
				// `Text.toString()` materializes the full document. For Giant tier
				// (capped well below 200MB by tier selection) this is acceptable —
				// one pass per query change, gated by useFilePreviewSearch's count
				// effect (B1) so navigation doesn't re-run it.
				return findAllInDoc(view.state.doc.toString(), query);
			},
			scrollToMatch: (hit) => {
				const view = viewRef.current;
				if (!view) return;
				const docLength = view.state.doc.length;
				const from = Math.max(0, Math.min(hit.sourceOffset, docLength));
				const to = Math.max(from, Math.min(hit.sourceOffset + hit.length, docLength));
				view.dispatch({
					selection: EditorSelection.single(from, to),
					effects: EditorView.scrollIntoView(from, { y: 'center' }),
				});
			},
		}),
		[]
	);

	return (
		<div
			ref={hostRef}
			data-testid="giant-preview-root"
			className="file-preview-content"
			style={{
				height: '100%',
				overflow: 'hidden',
				display: 'flex',
				flexDirection: 'column',
			}}
		/>
	);
});

export default GiantPreview;
