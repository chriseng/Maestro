/**
 * Tests for CodexPlanUsage
 *
 * Mirrors the ClaudePlanUsage coverage for the Codex quota widget:
 *   - empty state when no Codex accounts are configured
 *   - configured CODEX_HOME accounts with no cached snapshot
 *   - multi-account tab selection
 *   - accessible quota progress bars
 *   - non-authenticated/error rows
 *   - refresh IPC wiring
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CodexPlanUsage } from '../../../../renderer/components/UsageDashboard/CodexPlanUsage';
import { useCodexUsageStore } from '../../../../renderer/stores/codexUsageStore';
import { useSessionStore } from '../../../../renderer/stores/sessionStore';
import { THEMES } from '../../../../shared/themes';

const theme = THEMES['dracula'];

const refreshCodexUsageSnapshotsMock = vi.fn();
const getCodexUsageSnapshotsMock = vi.fn();
const getCustomEnvVarsMock = vi.fn();

beforeEach(() => {
	refreshCodexUsageSnapshotsMock.mockReset().mockResolvedValue({ refreshed: 1 });
	getCodexUsageSnapshotsMock.mockReset().mockResolvedValue({});
	getCustomEnvVarsMock.mockReset().mockResolvedValue({});

	(global as any).window = (global as any).window ?? {};
	(window as any).maestro = {
		agents: {
			getCodexUsageSnapshots: getCodexUsageSnapshotsMock,
			refreshCodexUsageSnapshots: refreshCodexUsageSnapshotsMock,
			getCustomEnvVars: getCustomEnvVarsMock,
		},
	};

	useCodexUsageStore.getState().__resetForTests();
	useSessionStore.setState({ sessions: [] } as any);
	cleanup();
});

function seedSnapshots(snapshots: Record<string, any>) {
	useCodexUsageStore.setState({ snapshots, loaded: true, refreshing: false } as any);
}

function seedSessions(codexHomes: string[]) {
	const sessions = codexHomes.map((dir, i) => ({
		id: `sess-${i}`,
		name: `sess-${i}`,
		toolType: 'codex',
		cwd: '/tmp',
		customEnvVars: { CODEX_HOME: dir },
	}));
	useSessionStore.setState({ sessions } as any);
}

describe('CodexPlanUsage — empty state', () => {
	it('renders the empty message when no Codex accounts are configured and no snapshots are cached', () => {
		render(<CodexPlanUsage theme={theme} />);

		expect(screen.getByTestId('codex-plan-empty')).toBeInTheDocument();
		expect(screen.queryByTestId('codex-plan-row-default')).toBeNull();
	});
});

describe('CodexPlanUsage — configured account without snapshot', () => {
	it('renders a "hit Refresh" CTA for a session-configured account with no snapshot yet', () => {
		seedSessions(['/Users/me/.codex-pending']);

		render(<CodexPlanUsage theme={theme} />);

		expect(screen.getByTestId('codex-plan-row-pending-pending')).toBeInTheDocument();
		expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
	});

	it('mixes a configured-but-empty tab with an authenticated one', () => {
		seedSnapshots({
			'/Users/me/.codex': {
				sampledAt: '2026-05-15T00:00:00.000Z',
				codexHomeKey: '/Users/me/.codex',
				authState: 'authenticated',
				session: { percent: 50, resetsAt: '2026-05-15T05:00:00.000Z' },
				weekly: { percent: 30, resetsAt: '2026-05-22T00:00:00.000Z' },
			},
		});
		seedSessions(['/Users/me/.codex', '/Users/me/.codex-pending']);

		render(<CodexPlanUsage theme={theme} />);

		expect(screen.getByTestId('codex-plan-tab-default')).toBeInTheDocument();
		expect(screen.getByTestId('codex-plan-tab-pending')).toBeInTheDocument();

		fireEvent.click(screen.getByTestId('codex-plan-tab-pending'));
		expect(screen.getByTestId('codex-plan-row-pending-pending')).toBeInTheDocument();
		expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
	});
});

describe('CodexPlanUsage — multi-account tabs', () => {
	it('renders a tab per account but only one selected row at a time', () => {
		seedSnapshots({
			'/Users/me/.codex': {
				sampledAt: '2026-05-15T00:00:00.000Z',
				codexHomeKey: '/Users/me/.codex',
				authState: 'authenticated',
				session: { percent: 50, resetsAt: '2026-05-15T05:00:00.000Z' },
				weekly: { percent: 30, resetsAt: '2026-05-22T00:00:00.000Z' },
			},
			'/Users/me/.codex-work': {
				sampledAt: '2026-05-15T00:00:00.000Z',
				codexHomeKey: '/Users/me/.codex-work',
				authState: 'authenticated',
				session: { percent: 97, resetsAt: '2026-05-15T05:00:00.000Z' },
				weekly: { percent: 80, resetsAt: '2026-05-22T00:00:00.000Z' },
			},
		});

		render(<CodexPlanUsage theme={theme} />);

		expect(screen.getByTestId('codex-plan-account-tabs')).toBeInTheDocument();
		expect(screen.getByTestId('codex-plan-tab-default')).toBeInTheDocument();
		expect(screen.getByTestId('codex-plan-tab-work')).toBeInTheDocument();

		expect(screen.getByTestId('codex-plan-row-default')).toBeInTheDocument();
		expect(screen.queryByTestId('codex-plan-row-work')).toBeNull();
		expect(screen.getAllByRole('progressbar')).toHaveLength(2);
	});

	it('switches the visible row when another Codex account tab is clicked', () => {
		seedSnapshots({
			'/Users/me/.codex': {
				sampledAt: '2026-05-15T00:00:00.000Z',
				codexHomeKey: '/Users/me/.codex',
				authState: 'authenticated',
				session: { percent: 50, resetsAt: '2026-05-15T05:00:00.000Z' },
				weekly: { percent: 30, resetsAt: '2026-05-22T00:00:00.000Z' },
			},
			'/Users/me/.codex-work': {
				sampledAt: '2026-05-15T00:00:00.000Z',
				codexHomeKey: '/Users/me/.codex-work',
				authState: 'authenticated',
				session: { percent: 97, resetsAt: '2026-05-15T05:00:00.000Z' },
				weekly: { percent: 80, resetsAt: '2026-05-22T00:00:00.000Z' },
			},
		});

		render(<CodexPlanUsage theme={theme} />);

		fireEvent.click(screen.getByTestId('codex-plan-tab-work'));

		expect(screen.queryByTestId('codex-plan-row-default')).toBeNull();
		expect(screen.getByTestId('codex-plan-row-work')).toBeInTheDocument();
	});

	it('exposes percentage values via aria-valuenow on each quota bar', () => {
		seedSnapshots({
			'/Users/me/.codex-work': {
				sampledAt: '2026-05-15T00:00:00.000Z',
				codexHomeKey: '/Users/me/.codex-work',
				authState: 'authenticated',
				session: { percent: 42, resetsAt: '2026-05-15T05:00:00.000Z' },
				weekly: { percent: 7, resetsAt: '2026-05-22T00:00:00.000Z' },
				additionalLimits: [{ name: 'gpt-5.5', percent: 99, resetsAt: '2026-05-16T00:00:00.000Z' }],
			},
		});

		render(<CodexPlanUsage theme={theme} />);

		const values = screen
			.getAllByRole('progressbar')
			.map((bar) => bar.getAttribute('aria-valuenow'));
		expect(values).toEqual(['42', '7', '99']);
	});
});

describe('CodexPlanUsage — non-authenticated row', () => {
	it('renders an auth warning in place of bars when authState is unauthenticated', () => {
		seedSnapshots({
			'/Users/me/.codex-0din': {
				sampledAt: '2026-05-15T00:00:00.000Z',
				codexHomeKey: '/Users/me/.codex-0din',
				authState: 'unauthenticated',
				error: 'Codex auth token was rejected. Run `codex login` for this CODEX_HOME.',
			},
		});

		render(<CodexPlanUsage theme={theme} />);

		expect(screen.getByTestId('codex-plan-row-0din-unauthenticated')).toBeInTheDocument();
		expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
		expect(screen.getByText(/codex login/i)).toBeInTheDocument();
	});

	it('renders an error row in place of bars when sampling fails', () => {
		seedSnapshots({
			'/Users/me/.codex-work': {
				sampledAt: '2026-05-15T00:00:00.000Z',
				codexHomeKey: '/Users/me/.codex-work',
				authState: 'error',
				error: 'Codex quota endpoint returned HTTP 500.',
			},
		});

		render(<CodexPlanUsage theme={theme} />);

		expect(screen.getByTestId('codex-plan-row-work-error')).toBeInTheDocument();
		expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
		expect(screen.getByText(/HTTP 500/i)).toBeInTheDocument();
	});
});

describe('CodexPlanUsage — refresh wiring', () => {
	it('calls the refresh IPC and re-pulls sanitized snapshots on click', async () => {
		getCodexUsageSnapshotsMock.mockResolvedValue({
			'/Users/me/.codex': {
				sampledAt: '2026-05-15T01:00:00.000Z',
				codexHomeKey: '/Users/me/.codex',
				authState: 'authenticated',
				session: { percent: 11, resetsAt: '2026-05-15T05:00:00.000Z' },
				weekly: { percent: 2, resetsAt: '2026-05-22T00:00:00.000Z' },
			},
		});

		render(<CodexPlanUsage theme={theme} />);
		fireEvent.click(screen.getByTestId('codex-plan-refresh'));

		await waitFor(() => {
			expect(refreshCodexUsageSnapshotsMock).toHaveBeenCalledTimes(1);
			expect(getCodexUsageSnapshotsMock).toHaveBeenCalledTimes(1);
		});

		await waitFor(() => {
			expect(screen.getByTestId('codex-plan-row-default')).toBeInTheDocument();
		});
	});

	it('disables the refresh button while a refresh is already in flight', () => {
		useCodexUsageStore.setState({
			snapshots: {},
			loaded: true,
			refreshing: true,
		} as any);

		render(<CodexPlanUsage theme={theme} />);
		const button = screen.getByTestId('codex-plan-refresh') as HTMLButtonElement;

		expect(button.disabled).toBe(true);
		expect(button.textContent).toContain('Sampling');
	});
});
