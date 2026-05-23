import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlattenedNode } from '../types';

interface UseFileTreeSelectionArgs {
	sessionId: string;
	selectedFileIndex: number;
	setSelectedFileIndex: (n: number) => void;
	flattenedTreeRef: React.MutableRefObject<FlattenedNode[]>;
}

interface UseFileTreeSelectionResult {
	selectedPaths: Set<string>;
	selectedPathsRef: React.MutableRefObject<Set<string>>;
	setSelectedPaths: React.Dispatch<React.SetStateAction<Set<string>>>;
	handleRowSelectionClick: (e: React.MouseEvent, globalIndex: number, fullPath: string) => void;
}

export function useFileTreeSelection({
	sessionId,
	selectedFileIndex,
	setSelectedFileIndex,
	flattenedTreeRef,
}: UseFileTreeSelectionArgs): UseFileTreeSelectionResult {
	// Multi-selection state. Holds *explicitly* selected paths (Cmd/Shift+click).
	// When empty, the row at `selectedFileIndex` is the implicit single selection.
	// When non-empty, these are the rows highlighted and dragged as a group.
	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());

	// Ref mirror so the memoized TreeRow renderer can read the current selection
	// without listing it as a dep (which would force every row to re-render on
	// every click).
	const selectedPathsRef = useRef(selectedPaths);
	useEffect(() => {
		selectedPathsRef.current = selectedPaths;
	}, [selectedPaths]);

	// Drop the multi-selection when switching agents — paths are session-scoped
	// and would otherwise resolve against a different working directory.
	useEffect(() => {
		setSelectedPaths(new Set());
	}, [sessionId]);

	// Multi-select aware row click. Plain click = single select (clear extras).
	// Cmd/Ctrl+click = toggle this row in the multi-selection. Shift+click =
	// extend selection from selectedFileIndex (anchor) to this row.
	const handleRowSelectionClick = useCallback(
		(e: React.MouseEvent, globalIndex: number, fullPath: string) => {
			if (e.shiftKey) {
				// Finder/Explorer semantics: the anchor (selectedFileIndex) stays put
				// across successive shift-clicks so the range pivots from the last
				// plain/Cmd-click rather than the last shift-click. Plain click,
				// Cmd-click, and arrow-key navigation all move the anchor; shift-click
				// does not. Applied uniformly across Windows, Linux, and macOS.
				const anchor = selectedFileIndex;
				const tree = flattenedTreeRef.current;
				const start = Math.min(anchor, globalIndex);
				const end = Math.max(anchor, globalIndex);
				const next = new Set<string>();
				for (let i = start; i <= end; i++) {
					const item = tree[i];
					if (item) next.add(item.path);
				}
				setSelectedPaths(next);
				return;
			}
			if (e.metaKey || e.ctrlKey) {
				const current = selectedPathsRef.current;
				const next = new Set(current);
				// If the selection was empty, fold in the previously-selected single
				// row so toggling adds (or removes) relative to a 1-item baseline.
				if (next.size === 0) {
					const prevItem = flattenedTreeRef.current[selectedFileIndex];
					if (prevItem && prevItem.path !== fullPath) next.add(prevItem.path);
				}
				if (next.has(fullPath)) next.delete(fullPath);
				else next.add(fullPath);
				setSelectedPaths(next);
				setSelectedFileIndex(globalIndex);
				return;
			}
			// Plain click — collapse to single selection.
			if (selectedPathsRef.current.size > 0) setSelectedPaths(new Set());
			setSelectedFileIndex(globalIndex);
		},
		[selectedFileIndex, setSelectedFileIndex, flattenedTreeRef]
	);

	return { selectedPaths, selectedPathsRef, setSelectedPaths, handleRowSelectionClick };
}
