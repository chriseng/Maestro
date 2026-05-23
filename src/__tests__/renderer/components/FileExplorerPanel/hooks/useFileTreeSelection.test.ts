import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useFileTreeSelection } from '../../../../../renderer/components/FileExplorerPanel/hooks/useFileTreeSelection';
import type { FlattenedNode } from '../../../../../renderer/components/FileExplorerPanel/types';

const makeFlattened = (paths: string[]): FlattenedNode[] =>
	paths.map((path, i) => ({
		node: { name: path.split('/').pop()!, type: 'file' as const },
		path,
		depth: 0,
		globalIndex: i,
	}));

function renderSelectionHook(
	initialPaths: string[] = ['a.ts', 'b.ts', 'c.ts'],
	sessionId = 'session-1',
	selectedFileIndex = 0
) {
	const flattenedTreeRef = { current: makeFlattened(initialPaths) };
	const setSelectedFileIndex = vi.fn();

	return {
		...renderHook(() =>
			useFileTreeSelection({
				sessionId,
				selectedFileIndex,
				setSelectedFileIndex,
				flattenedTreeRef,
			})
		),
		flattenedTreeRef,
		setSelectedFileIndex,
	};
}

describe('useFileTreeSelection', () => {
	it('initialises with an empty selectedPaths set', () => {
		const { result } = renderSelectionHook();
		expect(result.current.selectedPaths.size).toBe(0);
	});

	it('plain click collapses multi-selection and calls setSelectedFileIndex', () => {
		const { result, setSelectedFileIndex } = renderSelectionHook();
		// First add a multi-selection
		act(() => {
			result.current.setSelectedPaths(new Set(['a.ts', 'b.ts']));
		});
		const e = { shiftKey: false, metaKey: false, ctrlKey: false } as React.MouseEvent;
		act(() => {
			result.current.handleRowSelectionClick(e, 2, 'c.ts');
		});
		expect(result.current.selectedPaths.size).toBe(0);
		expect(setSelectedFileIndex).toHaveBeenCalledWith(2);
	});

	it('cmd-click adds to the selection', () => {
		const { result } = renderSelectionHook(['a.ts', 'b.ts', 'c.ts'], 'sess', 0);
		const e = { shiftKey: false, metaKey: true, ctrlKey: false } as React.MouseEvent;
		act(() => {
			result.current.handleRowSelectionClick(e, 1, 'b.ts');
		});
		expect(result.current.selectedPaths.has('b.ts')).toBe(true);
	});

	it('cmd-click on empty selection folds in the previous single row first', () => {
		// selectedFileIndex = 0 (a.ts), click b.ts with cmd
		const { result } = renderSelectionHook(['a.ts', 'b.ts', 'c.ts'], 'sess', 0);
		const e = { shiftKey: false, metaKey: true, ctrlKey: false } as React.MouseEvent;
		act(() => {
			result.current.handleRowSelectionClick(e, 1, 'b.ts');
		});
		// Should have both a.ts and b.ts
		expect(result.current.selectedPaths.has('a.ts')).toBe(true);
		expect(result.current.selectedPaths.has('b.ts')).toBe(true);
	});

	it('cmd-click on an already-selected path removes it', () => {
		const { result } = renderSelectionHook();
		act(() => {
			result.current.setSelectedPaths(new Set(['a.ts', 'b.ts']));
		});
		const e = { shiftKey: false, metaKey: true, ctrlKey: false } as React.MouseEvent;
		act(() => {
			result.current.handleRowSelectionClick(e, 0, 'a.ts');
		});
		expect(result.current.selectedPaths.has('a.ts')).toBe(false);
		expect(result.current.selectedPaths.has('b.ts')).toBe(true);
	});

	it('shift-click selects a range from anchor (selectedFileIndex) to clicked row', () => {
		// anchor at index 0 (a.ts), shift-click index 2 (c.ts)
		const { result } = renderSelectionHook(['a.ts', 'b.ts', 'c.ts'], 'sess', 0);
		const e = { shiftKey: true, metaKey: false, ctrlKey: false } as React.MouseEvent;
		act(() => {
			result.current.handleRowSelectionClick(e, 2, 'c.ts');
		});
		expect(result.current.selectedPaths.has('a.ts')).toBe(true);
		expect(result.current.selectedPaths.has('b.ts')).toBe(true);
		expect(result.current.selectedPaths.has('c.ts')).toBe(true);
	});

	it('shift-click anchor does not move (stickiness)', () => {
		// Simulate two consecutive shift-clicks — the anchor stays at index 0
		const { result } = renderSelectionHook(['a.ts', 'b.ts', 'c.ts', 'd.ts'], 'sess', 0);
		const eShift = { shiftKey: true, metaKey: false, ctrlKey: false } as React.MouseEvent;
		// First shift-click: index 0 to 2
		act(() => {
			result.current.handleRowSelectionClick(eShift, 2, 'c.ts');
		});
		// Second shift-click: index 0 (anchor) to 3
		act(() => {
			result.current.handleRowSelectionClick(eShift, 3, 'd.ts');
		});
		// All 4 should be selected because anchor is still 0
		expect(result.current.selectedPaths.size).toBe(4);
	});

	it('selectedPathsRef mirror stays in sync', () => {
		const { result } = renderSelectionHook();
		act(() => {
			result.current.setSelectedPaths(new Set(['x.ts']));
		});
		expect(result.current.selectedPathsRef.current.has('x.ts')).toBe(true);
	});

	it('clears selection when sessionId changes', () => {
		let sessionId = 'sess-1';
		const { result, rerender } = renderHook(
			({ sid }) => {
				const flatRef = { current: makeFlattened(['a.ts']) };
				return useFileTreeSelection({
					sessionId: sid,
					selectedFileIndex: 0,
					setSelectedFileIndex: vi.fn(),
					flattenedTreeRef: flatRef,
				});
			},
			{ initialProps: { sid: 'sess-1' } }
		);
		act(() => {
			result.current.setSelectedPaths(new Set(['a.ts']));
		});
		expect(result.current.selectedPaths.size).toBe(1);

		rerender({ sid: 'sess-2' });
		expect(result.current.selectedPaths.size).toBe(0);
	});
});
