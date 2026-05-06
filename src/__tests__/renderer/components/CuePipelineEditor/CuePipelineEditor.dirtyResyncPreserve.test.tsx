/**
 * Regression test for the "single-pipeline node drifts back after a few
 * seconds" bug.
 *
 * Symptom: in single-pipeline editing mode the user moves a node, then a few
 * seconds later it pops back to its previous position. Root cause: the
 * `displayNodes <- computedNodes` resync effect ran on every `activeRuns`
 * polling tick (its deps include the running-state Sets returned fresh from
 * usePipelineState's memos), unconditionally overwriting positions. While
 * `pipelineState` was still dirty (drag committed locally but not saved to
 * disk), the recomputed `computedNodes` could lag the live `displayNodes`
 * positions and a poll-driven recompute would snap the node back.
 *
 * Fix: while `isDirty` is true, the resync preserves per-node positions from
 * the live `displayNodes` and only merges in non-positional updates from
 * `computedNodes` (data, badges, running flags, etc.). Once the user saves
 * (`isDirty -> false`), full resync resumes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

let capturedNodes: any[] = [];
let capturedSetDisplayNodes: ((updater: any) => void) | null = null;

vi.mock('reactflow', () => ({
	default: (props: any) => <div data-testid="react-flow">{props.children}</div>,
	ReactFlowProvider: ({ children }: any) => <>{children}</>,
	useReactFlow: () => ({
		fitView: vi.fn(),
		screenToFlowPosition: vi.fn((pos: any) => pos),
		setViewport: vi.fn(),
	}),
	useNodesInitialized: () => false,
	applyNodeChanges: (_changes: any[], nodes: any[]) => nodes,
	Background: () => null,
	Controls: () => null,
	MiniMap: () => null,
	ConnectionMode: { Loose: 'loose' },
	Position: { Left: 'left', Right: 'right' },
	Handle: () => null,
	MarkerType: { ArrowClosed: 'arrowclosed' },
}));

vi.mock('../../../../renderer/components/CuePipelineEditor/PipelineCanvas', () => ({
	PipelineCanvas: React.memo((props: any) => {
		capturedNodes = props.nodes;
		// `setDisplayNodes` is forwarded into usePipelineCanvasCallbacks via the
		// `display.setDisplayNodes` slot — but PipelineCanvas itself doesn't
		// accept it directly. We surface it instead through the canvasCallbacks
		// hook by wiring it into onNodesChange. Tests below trigger position
		// updates by calling onNodesChange with a position change.
		(window as any).__test_onNodesChange = props.onNodesChange;
		capturedSetDisplayNodes = (window as any).__test_onNodesChange ?? null;
		return <div data-testid="pipeline-canvas" />;
	}),
}));
vi.mock('../../../../renderer/components/CuePipelineEditor/PipelineToolbar', () => ({
	PipelineToolbar: () => <div />,
}));
vi.mock('../../../../renderer/components/CuePipelineEditor/PipelineContextMenu', () => ({
	PipelineContextMenu: () => null,
}));

const mockUsePipelineState = vi.fn();
vi.mock('../../../../renderer/hooks/cue/usePipelineState', () => ({
	usePipelineState: (...args: any[]) => mockUsePipelineState(...args),
	DEFAULT_TRIGGER_LABELS: {},
	validatePipelines: vi.fn(),
}));

vi.mock('../../../../renderer/hooks/cue/usePipelineSelection', () => ({
	usePipelineSelection: () => ({
		selectedNodeId: null,
		setSelectedNodeId: vi.fn(),
		selectedEdgeId: null,
		setSelectedEdgeId: vi.fn(),
		selectedNode: null,
		selectedNodePipelineId: null,
		selectedNodeHasOutgoingEdge: false,
		hasIncomingAgentEdges: false,
		incomingAgentEdgeCount: 0,
		incomingTriggerEdges: [],
		selectedEdge: null,
		selectedEdgePipelineId: null,
		selectedEdgePipelineColor: '#06b6d4',
		edgeSourceNode: null,
		edgeTargetNode: null,
		onCanvasSessionIds: new Set<string>(),
		onNodeClick: vi.fn(),
		onEdgeClick: vi.fn(),
		onPaneClick: vi.fn(),
		handleConfigureNode: vi.fn(),
	}),
}));

// `convertToReactFlowNodes` is the source of the "polling-driven recompute"
// in this regression. The test toggles its return value between renders to
// simulate computedNodes carrying stale positions while the user has already
// dragged a node locally.
const mockConvertToReactFlowNodes = vi.fn();
vi.mock('../../../../renderer/components/CuePipelineEditor/utils/pipelineGraph', () => ({
	convertToReactFlowNodes: (...args: any[]) => mockConvertToReactFlowNodes(...args),
	convertToReactFlowEdges: vi.fn(() => []),
	computePipelineYOffsets: vi.fn(() => new Map()),
}));

import { CuePipelineEditor } from '../../../../renderer/components/CuePipelineEditor/CuePipelineEditor';
import { mockTheme } from '../../../helpers/mockTheme';

function buildStateHookReturn(overrides: Record<string, unknown> = {}) {
	return {
		pipelineState: {
			pipelines: [
				{
					id: 'p1',
					name: 'Pipeline 1',
					color: '#06b6d4',
					nodes: [
						{
							id: 'agent-1',
							type: 'agent',
							position: { x: 0, y: 0 },
							data: { sessionId: 's1', sessionName: 'Agent', toolType: 'claude-code' },
						},
					],
					edges: [],
				},
			],
			selectedPipelineId: 'p1',
		},
		setPipelineState: vi.fn(),
		isAllPipelinesView: false,
		isDirty: false,
		setIsDirty: vi.fn(),
		saveStatus: 'idle',
		validationErrors: [],
		cueSettings: {
			timeout_minutes: 30,
			timeout_on_fail: 'break',
			max_concurrent: 1,
			queue_size: 10,
		},
		setCueSettings: vi.fn(),
		showSettings: false,
		setShowSettings: vi.fn(),
		runningPipelineIds: new Set<string>(),
		runningAgentsByPipeline: new Map(),
		runningSubscriptionsByPipeline: new Map(),
		optimisticTriggeredPipelineIds: new Set<string>(),
		markPipelineTriggered: vi.fn(),
		persistLayout: vi.fn(),
		pendingSavedViewportRef: { current: null },
		pipelinesLoaded: true,
		handleSave: vi.fn(),
		handleDiscard: vi.fn(),
		createPipeline: vi.fn(),
		deletePipeline: vi.fn(),
		renamePipeline: vi.fn(),
		selectPipeline: vi.fn(),
		changePipelineColor: vi.fn(),
		onUpdateNode: vi.fn(),
		onUpdateEdgePrompt: vi.fn(),
		onDeleteNode: vi.fn(),
		onUpdateEdge: vi.fn(),
		onDeleteEdge: vi.fn(),
		...overrides,
	};
}

function makeNode(id: string, x: number, y: number) {
	return {
		id,
		type: 'agent',
		position: { x, y },
		data: { compositeId: id, sessionId: 's1', sessionName: 'Agent', toolType: 'claude-code' },
	};
}

describe('CuePipelineEditor — dirty-state position preservation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capturedNodes = [];
		capturedSetDisplayNodes = null;
	});

	function renderEditor() {
		return render(
			<CuePipelineEditor
				sessions={[]}
				graphSessions={[]}
				onSwitchToSession={vi.fn()}
				onClose={vi.fn()}
				theme={mockTheme}
			/>
		);
	}

	it('clean state: resync overwrites displayNodes from computedNodes', () => {
		mockUsePipelineState.mockReturnValue(buildStateHookReturn({ isDirty: false }));
		mockConvertToReactFlowNodes.mockReturnValue([makeNode('p1:agent-1', 0, 0)]);

		const { rerender } = renderEditor();
		expect(capturedNodes).toEqual([
			expect.objectContaining({ id: 'p1:agent-1', position: { x: 0, y: 0 } }),
		]);

		// Simulate a polling tick: usePipelineState returns a new running-state
		// Set identity (which forces computedNodes to recompute) but no real
		// position changes. Clean state should follow computedNodes verbatim.
		mockUsePipelineState.mockReturnValue(
			buildStateHookReturn({ isDirty: false, runningPipelineIds: new Set(['p1']) })
		);
		mockConvertToReactFlowNodes.mockReturnValue([makeNode('p1:agent-1', 0, 0)]);
		rerender(
			<CuePipelineEditor
				sessions={[]}
				graphSessions={[]}
				onSwitchToSession={vi.fn()}
				onClose={vi.fn()}
				theme={mockTheme}
			/>
		);

		expect(capturedNodes).toEqual([
			expect.objectContaining({ id: 'p1:agent-1', position: { x: 0, y: 0 } }),
		]);
	});

	it('dirty state: live displayNodes positions are preserved across resyncs', () => {
		mockUsePipelineState.mockReturnValue(buildStateHookReturn({ isDirty: true }));
		mockConvertToReactFlowNodes.mockReturnValue([makeNode('p1:agent-1', 0, 0)]);

		renderEditor();
		expect(capturedNodes).toEqual([
			expect.objectContaining({ id: 'p1:agent-1', position: { x: 0, y: 0 } }),
		]);

		// User drags the node — onNodesChange flushes the position change into
		// the live displayNodes. We simulate that by calling the captured
		// callback ReactFlow normally drives.
		expect(capturedSetDisplayNodes).toBeTruthy();
		capturedSetDisplayNodes!([
			{ type: 'position', id: 'p1:agent-1', position: { x: 350, y: 100 }, dragging: false },
		]);

		// A poll tick fires before save. computedNodes recomputes from
		// pipelineState which still holds the OLD position. Without the fix,
		// the resync would snap the node back to (0, 0).
		mockUsePipelineState.mockReturnValue(
			buildStateHookReturn({ isDirty: true, runningPipelineIds: new Set(['p1']) })
		);
		mockConvertToReactFlowNodes.mockReturnValue([makeNode('p1:agent-1', 0, 0)]);

		// Force a re-render to flush the resync effect.
		const { rerender } = render(
			<CuePipelineEditor
				sessions={[]}
				graphSessions={[]}
				onSwitchToSession={vi.fn()}
				onClose={vi.fn()}
				theme={mockTheme}
			/>
		);
		// Re-arm captures from the second mount and trigger the same drag flow.
		capturedSetDisplayNodes!([
			{ type: 'position', id: 'p1:agent-1', position: { x: 350, y: 100 }, dragging: false },
		]);
		mockUsePipelineState.mockReturnValue(
			buildStateHookReturn({ isDirty: true, runningPipelineIds: new Set(['p1']) })
		);
		rerender(
			<CuePipelineEditor
				sessions={[]}
				graphSessions={[]}
				onSwitchToSession={vi.fn()}
				onClose={vi.fn()}
				theme={mockTheme}
			/>
		);

		// After the resync, the dragged position must survive.
		const movedNode = capturedNodes.find((n) => n.id === 'p1:agent-1');
		expect(movedNode).toBeTruthy();
		expect(movedNode!.position).toEqual({ x: 350, y: 100 });
	});

	it('dirty state: new nodes appearing in computedNodes are still added to displayNodes', () => {
		mockUsePipelineState.mockReturnValue(buildStateHookReturn({ isDirty: true }));
		mockConvertToReactFlowNodes.mockReturnValue([makeNode('p1:agent-1', 0, 0)]);

		const { rerender } = renderEditor();

		// Simulate a node drop / paste that adds a new node to computedNodes.
		mockUsePipelineState.mockReturnValue(buildStateHookReturn({ isDirty: true }));
		mockConvertToReactFlowNodes.mockReturnValue([
			makeNode('p1:agent-1', 0, 0),
			makeNode('p1:agent-2', 500, 500),
		]);

		rerender(
			<CuePipelineEditor
				sessions={[]}
				graphSessions={[]}
				onSwitchToSession={vi.fn()}
				onClose={vi.fn()}
				theme={mockTheme}
			/>
		);

		const ids = capturedNodes.map((n) => n.id).sort();
		expect(ids).toEqual(['p1:agent-1', 'p1:agent-2']);
		const newNode = capturedNodes.find((n) => n.id === 'p1:agent-2');
		expect(newNode!.position).toEqual({ x: 500, y: 500 });
	});

	it('dirty state: nodes removed from computedNodes are dropped from displayNodes', () => {
		mockUsePipelineState.mockReturnValue(buildStateHookReturn({ isDirty: true }));
		mockConvertToReactFlowNodes.mockReturnValue([
			makeNode('p1:agent-1', 0, 0),
			makeNode('p1:agent-2', 100, 100),
		]);

		const { rerender } = renderEditor();
		expect(capturedNodes.map((n) => n.id).sort()).toEqual(['p1:agent-1', 'p1:agent-2']);

		// One node deleted in pipelineState — computedNodes returns only the survivor.
		mockUsePipelineState.mockReturnValue(buildStateHookReturn({ isDirty: true }));
		mockConvertToReactFlowNodes.mockReturnValue([makeNode('p1:agent-1', 0, 0)]);

		rerender(
			<CuePipelineEditor
				sessions={[]}
				graphSessions={[]}
				onSwitchToSession={vi.fn()}
				onClose={vi.fn()}
				theme={mockTheme}
			/>
		);

		expect(capturedNodes.map((n) => n.id)).toEqual(['p1:agent-1']);
	});
});
