/**
 * Integration tests for UsageDashboardModal — Phase 04 Cue tab gating.
 *
 * Verifies:
 * - The "Cue" tab is visible when both encoreFeatures.maestroCue and
 *   encoreFeatures.usageStats are true.
 * - The "Cue" tab is hidden when EITHER Encore flag is off (matches the IPC
 *   handler's gating; otherwise the user lands on a generic error/retry note
 *   instead of the friendly disabled state).
 * - Switching to the Cue tab renders <CueStats>.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { UsageDashboardModal } from '../../../../renderer/components/UsageDashboard/UsageDashboardModal';
import { useSettingsStore } from '../../../../renderer/stores/settingsStore';
import { useClaudeUsageStore } from '../../../../renderer/stores/claudeUsageStore';
import { useCodexUsageStore } from '../../../../renderer/stores/codexUsageStore';
import { mockTheme } from '../../../helpers/mockTheme';
import type { StatsAggregation } from '../../../../shared/stats-types';

// useModalLayer needs a LayerStackProvider in real renders. The stack
// behavior is irrelevant to this test, so stub the context hook.
vi.mock('../../../../renderer/contexts/LayerStackContext', () => ({
	useLayerStack: () => ({
		registerLayer: vi.fn(() => 'layer-test'),
		unregisterLayer: vi.fn(),
		updateLayerHandler: vi.fn(),
	}),
}));

// Stub CueStats so the integration test focuses on tab visibility/switching
// rather than the full CueStats render tree (covered by CueStats.test.tsx).
vi.mock('../../../../renderer/components/UsageDashboard/CueStats', () => ({
	CueStats: ({ timeRange, colorBlindMode }: { timeRange: string; colorBlindMode?: boolean }) => (
		<div
			data-testid="cue-stats-mock"
			data-time-range={timeRange}
			data-colorblind={String(Boolean(colorBlindMode))}
		>
			CueStats stub
		</div>
	),
}));

vi.mock('../../../../renderer/components/UsageDashboard/ClaudePlanUsage', () => ({
	ClaudePlanUsage: () => <div data-testid="anthropic-usage-mock">Anthropic Usage stub</div>,
}));

vi.mock('../../../../renderer/components/UsageDashboard/CodexPlanUsage', () => ({
	CodexPlanUsage: () => <div data-testid="codex-usage-mock">Codex Usage stub</div>,
}));

// Populated aggregation so the dashboard renders the tab panel (the empty
// state branch swallows everything before tabs become reachable).
const populatedAggregation: StatsAggregation = {
	totalQueries: 42,
	totalDuration: 3_600_000,
	avgDuration: 85_714,
	queryDurationPercentiles: {
		count: 42,
		min: 5_000,
		p50: 60_000,
		p75: 120_000,
		p90: 180_000,
		p95: 240_000,
		p99: 300_000,
		max: 600_000,
	},
	queryDurationPercentilesByAgent: {
		'claude-code': {
			count: 30,
			min: 5_000,
			p50: 60_000,
			p75: 120_000,
			p90: 180_000,
			p95: 240_000,
			p99: 300_000,
			max: 600_000,
		},
	},
	autoRunTaskDurationPercentiles: {
		count: 0,
		min: 0,
		p50: 0,
		p75: 0,
		p90: 0,
		p95: 0,
		p99: 0,
		max: 0,
	},
	byAgent: {
		'claude-code': { count: 30, duration: 2_400_000 },
		codex: { count: 12, duration: 1_200_000 },
	},
	bySource: { user: 25, auto: 17 },
	byLocation: { local: 40, remote: 2 },
	byDay: [
		{ date: '2026-04-22', count: 20, duration: 1_800_000 },
		{ date: '2026-04-23', count: 22, duration: 1_800_000 },
	],
	byHour: [
		{ hour: 9, count: 15, duration: 900_000 },
		{ hour: 14, count: 27, duration: 2_700_000 },
	],
	totalSessions: 6,
	sessionsByAgent: { 'claude-code': 4, codex: 2 },
	sessionsByDay: [
		{ date: '2026-04-22', count: 3 },
		{ date: '2026-04-23', count: 3 },
	],
	avgSessionDuration: 600_000,
	byAgentByDay: {},
	bySessionByDay: {},
	bySessionSource: {},
};

const emptyAggregation: StatsAggregation = {
	totalQueries: 0,
	totalDuration: 0,
	avgDuration: 0,
	byAgent: {},
	bySource: { user: 0, auto: 0 },
	byLocation: { local: 0, remote: 0 },
	byDay: [],
	byHour: [],
	totalSessions: 0,
	sessionsByAgent: {},
	sessionsByDay: [],
	avgSessionDuration: 0,
	byAgentByDay: {},
	bySessionByDay: {},
	bySessionSource: {},
};

const mockStats = {
	getAggregation: vi.fn(),
	getDatabaseSize: vi.fn(),
	onStatsUpdate: vi.fn(() => () => {}),
	exportCsv: vi.fn(),
};

const mockDialog = { saveFile: vi.fn() };
const mockFs = { writeFile: vi.fn() };
const mockAgents = {
	getClaudeUsageSnapshots: vi.fn(),
	getCodexUsageSnapshots: vi.fn(),
	refreshClaudeUsageSnapshots: vi.fn(),
	refreshCodexUsageSnapshots: vi.fn(),
};

function setEncoreFlags({ maestroCue, usageStats }: { maestroCue: boolean; usageStats: boolean }) {
	useSettingsStore.setState({
		encoreFeatures: {
			directorNotes: false,
			usageStats,
			symphony: false,
			maestroCue,
		},
	});
}

function seedAnthropicUsageSnapshots() {
	useClaudeUsageStore.setState({
		loaded: true,
		refreshing: false,
		snapshots: {
			'/Users/me/.claude-work': {
				sampledAt: '2026-05-23T00:00:00.000Z',
				configDirKey: '/Users/me/.claude-work',
				authState: 'authenticated',
				session: { percent: 20, resetsAt: '2026-05-23T05:00:00.000Z' },
				weekAllModels: { percent: 40, resetsAt: '2026-05-30T00:00:00.000Z' },
				weekSonnetOnly: { percent: 10, resetsAt: '2026-05-30T00:00:00.000Z' },
			},
		},
	} as any);
}

function seedCodexUsageSnapshots() {
	useCodexUsageStore.setState({
		loaded: true,
		refreshing: false,
		snapshots: {
			'/Users/me/.codex-work': {
				sampledAt: '2026-05-23T00:00:00.000Z',
				codexHomeKey: '/Users/me/.codex-work',
				authState: 'authenticated',
				session: { percent: 15, resetsAt: '2026-05-23T05:00:00.000Z' },
				weekly: { percent: 33, resetsAt: '2026-05-30T00:00:00.000Z' },
			},
		},
	} as any);
}

beforeEach(() => {
	vi.clearAllMocks();
	useClaudeUsageStore.getState().__resetForTests();
	useCodexUsageStore.getState().__resetForTests();
	mockAgents.getClaudeUsageSnapshots.mockResolvedValue({});
	mockAgents.getCodexUsageSnapshots.mockResolvedValue({});
	mockAgents.refreshClaudeUsageSnapshots.mockResolvedValue({ refreshed: 1 });
	mockAgents.refreshCodexUsageSnapshots.mockResolvedValue({ refreshed: 1 });
	(window as unknown as { maestro: Record<string, unknown> }).maestro = {
		stats: mockStats,
		dialog: mockDialog,
		fs: mockFs,
		agents: mockAgents,
		// Minimum surface needed by `useGlobalAgentStats` (called from the
		// dashboard's Achievement share image flow).
		agentSessions: {
			getGlobalStats: vi.fn().mockResolvedValue(null),
			onGlobalStatsUpdate: vi.fn().mockReturnValue(() => {}),
		},
	};
	mockStats.getAggregation.mockResolvedValue(populatedAggregation);
	mockStats.getDatabaseSize.mockResolvedValue(1024 * 1024);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('UsageDashboardModal — Cue tab gating', () => {
	it('shows the "Cue" tab when both maestroCue and usageStats are enabled', async () => {
		setEncoreFlags({ maestroCue: true, usageStats: true });

		render(<UsageDashboardModal isOpen={true} onClose={() => {}} theme={mockTheme} />);

		await waitFor(() => {
			expect(screen.getByTestId('usage-dashboard-content')).toBeInTheDocument();
		});

		expect(screen.getByRole('tab', { name: 'Cue' })).toBeInTheDocument();
	});

	it.each([
		['maestroCue is disabled', { maestroCue: false, usageStats: true }],
		['usageStats is disabled', { maestroCue: true, usageStats: false }],
		['both flags are disabled', { maestroCue: false, usageStats: false }],
	])('hides the "Cue" tab when %s (rest of dashboard still renders)', async (_label, flags) => {
		setEncoreFlags(flags);

		render(<UsageDashboardModal isOpen={true} onClose={() => {}} theme={mockTheme} />);

		await waitFor(() => {
			expect(screen.getByTestId('usage-dashboard-content')).toBeInTheDocument();
		});

		expect(screen.queryByRole('tab', { name: 'Cue' })).not.toBeInTheDocument();
		// Confirm the base tabs are still wired up.
		expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'Agent Overview' })).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'Agents' })).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'Activity' })).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'Auto Run' })).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'Shortcuts' })).toBeInTheDocument();
		expect(screen.queryByRole('tab', { name: 'Token Quota Cockpit' })).not.toBeInTheDocument();
	});

	it('renders <CueStats> when the Cue tab is selected', async () => {
		setEncoreFlags({ maestroCue: true, usageStats: true });

		render(
			<UsageDashboardModal
				isOpen={true}
				onClose={() => {}}
				theme={mockTheme}
				colorBlindMode={true}
			/>
		);

		await waitFor(() => {
			expect(screen.getByTestId('usage-dashboard-content')).toBeInTheDocument();
		});

		// Cue tab is not the default — switch to it explicitly.
		const cueTab = screen.getByRole('tab', { name: 'Cue' });
		await act(async () => {
			fireEvent.click(cueTab);
		});

		await waitFor(() => {
			expect(screen.getByTestId('cue-stats-mock')).toBeInTheDocument();
		});

		const stub = screen.getByTestId('cue-stats-mock');
		// Default time range is 'week' and we passed colorBlindMode=true through.
		expect(stub).toHaveAttribute('data-time-range', 'week');
		expect(stub).toHaveAttribute('data-colorblind', 'true');
	});
});

describe('UsageDashboardModal — provider quota tabs', () => {
	it('shows Anthropic Usage and Codex Usage only when useful provider snapshots exist', async () => {
		setEncoreFlags({ maestroCue: true, usageStats: true });
		seedAnthropicUsageSnapshots();
		seedCodexUsageSnapshots();

		render(<UsageDashboardModal isOpen={true} onClose={() => {}} theme={mockTheme} />);

		await waitFor(() => {
			expect(screen.getByTestId('usage-dashboard-content')).toBeInTheDocument();
		});

		expect(screen.queryByRole('tab', { name: 'Token Quota Cockpit' })).not.toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'Anthropic Usage' })).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'Codex Usage' })).toBeInTheDocument();

		await act(async () => {
			fireEvent.click(screen.getByRole('tab', { name: 'Anthropic Usage' }));
		});

		await waitFor(() => {
			expect(screen.getByTestId('anthropic-usage-mock')).toBeInTheDocument();
		});

		await act(async () => {
			fireEvent.click(screen.getByRole('tab', { name: 'Codex Usage' }));
		});

		expect(screen.getByTestId('codex-usage-mock')).toBeInTheDocument();
		expect(mockAgents.refreshClaudeUsageSnapshots).not.toHaveBeenCalled();
		expect(mockAgents.refreshCodexUsageSnapshots).not.toHaveBeenCalled();
	});

	it('hides provider quota tabs when usageStats is disabled even if snapshots exist', async () => {
		setEncoreFlags({ maestroCue: false, usageStats: false });
		seedAnthropicUsageSnapshots();
		seedCodexUsageSnapshots();

		render(<UsageDashboardModal isOpen={true} onClose={() => {}} theme={mockTheme} />);

		await waitFor(() => {
			expect(screen.getByTestId('usage-dashboard-content')).toBeInTheDocument();
		});

		expect(screen.queryByRole('tab', { name: 'Anthropic Usage' })).not.toBeInTheDocument();
		expect(screen.queryByRole('tab', { name: 'Codex Usage' })).not.toBeInTheDocument();
	});

	it('hides provider quota tabs when snapshots contain no useful quota details', async () => {
		setEncoreFlags({ maestroCue: false, usageStats: true });
		useClaudeUsageStore.setState({
			loaded: true,
			refreshing: false,
			snapshots: {
				'/Users/me/.claude-work': {
					sampledAt: '2026-05-23T00:00:00.000Z',
					configDirKey: '/Users/me/.claude-work',
					authState: 'unauthenticated',
					session: { percent: 0, resetsAt: '2026-05-23T05:00:00.000Z' },
					weekAllModels: { percent: 0, resetsAt: '2026-05-30T00:00:00.000Z' },
					weekSonnetOnly: { percent: 0, resetsAt: '2026-05-30T00:00:00.000Z' },
				},
			},
		} as any);
		useCodexUsageStore.setState({
			loaded: true,
			refreshing: false,
			snapshots: {
				'/Users/me/.codex-work': {
					sampledAt: '2026-05-23T00:00:00.000Z',
					codexHomeKey: '/Users/me/.codex-work',
					authState: 'error',
					error: 'Endpoint unavailable',
				},
			},
		} as any);

		render(<UsageDashboardModal isOpen={true} onClose={() => {}} theme={mockTheme} />);

		await waitFor(() => {
			expect(screen.getByTestId('usage-dashboard-content')).toBeInTheDocument();
		});

		expect(screen.queryByRole('tab', { name: 'Anthropic Usage' })).not.toBeInTheDocument();
		expect(screen.queryByRole('tab', { name: 'Codex Usage' })).not.toBeInTheDocument();
	});

	it('bypasses the AI-query empty state because provider quota snapshots do not come from stats.db', async () => {
		setEncoreFlags({ maestroCue: false, usageStats: true });
		seedCodexUsageSnapshots();
		mockStats.getAggregation.mockResolvedValueOnce(emptyAggregation);

		render(<UsageDashboardModal isOpen={true} onClose={() => {}} theme={mockTheme} />);

		await act(async () => {
			fireEvent.click(screen.getByRole('tab', { name: 'Codex Usage' }));
		});

		await waitFor(() => {
			expect(screen.getByTestId('codex-usage-mock')).toBeInTheDocument();
		});
		expect(screen.queryByText(/No usage data yet/i)).not.toBeInTheDocument();
	});
});
