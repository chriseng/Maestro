/**
 * CodexPlanUsage
 *
 * Per-account Codex quota burndown for the Usage Dashboard Overview tab.
 * Mirrors ClaudePlanUsage's account-tab + horizontal-bar pattern, but reads
 * sanitized ChatGPT/Codex quota snapshots from `codexUsageStore`.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Clock, Loader2, RefreshCw } from 'lucide-react';
import type { Theme } from '../../types';
import { useCodexUsageStore, type CodexUsageSnapshot } from '../../stores/codexUsageStore';
import { useSessionStore } from '../../stores/sessionStore';
import { formatFutureTime } from '../../../shared/formatters';
import { getHomeDir, getHomeDirAsync } from '../../utils/homeDir';

function deriveAccountShortName(codexHomeKey: string | undefined): string {
	if (!codexHomeKey) return 'default';
	const trimmed = codexHomeKey.replace(/\/+$/, '');
	const basename = trimmed.slice(trimmed.lastIndexOf('/') + 1);
	if (!basename || basename === '.codex') return 'default';
	if (basename.startsWith('.codex-')) return basename.slice('.codex-'.length);
	if (basename.startsWith('.codex')) return basename.slice('.codex'.length) || 'default';
	return basename;
}

function deriveAccountDisplayName(codexHomeKey: string | undefined): string {
	const shortName = deriveAccountShortName(codexHomeKey);
	return shortName === 'default' ? 'Default account' : shortName;
}

function normalizeCodexHomeKey(value: string): string {
	return value.replace(/\/+$/, '');
}

interface CodexPlanUsageProps {
	theme: Theme;
	accountKeys?: string[];
	showAllAccounts?: boolean;
	autoRefresh?: boolean;
	showRefreshButton?: boolean;
}

interface BarRowProps {
	label: string;
	percent: number;
	resetsAt?: string;
	theme: Theme;
}

const WARNING_THRESHOLD = 75;
const LIMIT_THRESHOLD = 99;
const REFRESH_OPTIONS = [
	{ value: 0, label: 'Off' },
	{ value: 60_000, label: '1 min' },
	{ value: 5 * 60_000, label: '5 min' },
	{ value: 15 * 60_000, label: '15 min' },
	{ value: 30 * 60_000, label: '30 min' },
];

function resolveFillColor(percent: number, theme: Theme): string {
	if (percent >= LIMIT_THRESHOLD) return theme.colors.error ?? theme.colors.warning;
	if (percent >= WARNING_THRESHOLD) return theme.colors.warning;
	return theme.colors.accent;
}

const BarRow = memo(function BarRow({ label, percent, resetsAt, theme }: BarRowProps) {
	const clampedPercent = Math.min(100, Math.max(0, percent));
	const fillColor = resolveFillColor(clampedPercent, theme);
	const showInsideLabel = clampedPercent >= 22;
	const displayPercent = Math.round(clampedPercent);

	return (
		<div className="flex items-center gap-4">
			<div
				className="w-44 text-sm whitespace-nowrap flex-shrink-0"
				style={{ color: theme.colors.textMain }}
			>
				{label}
			</div>
			<div
				className="flex-1 h-7 rounded overflow-hidden relative"
				style={{ backgroundColor: theme.colors.border }}
				role="progressbar"
				aria-label={`${label}: ${displayPercent}%`}
				aria-valuenow={displayPercent}
				aria-valuemin={0}
				aria-valuemax={100}
			>
				<div
					className="h-full rounded flex items-center"
					style={{
						width: `${Math.max(clampedPercent, 2)}%`,
						backgroundColor: fillColor,
						opacity: 0.9,
						transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
					}}
				>
					{showInsideLabel && (
						<span
							className="text-sm font-semibold px-2"
							style={{
								color: theme.colors.bgMain,
								textShadow: '0 1px 2px rgba(0,0,0,0.15)',
							}}
						>
							{displayPercent}%
						</span>
					)}
				</div>
				{!showInsideLabel && (
					<span
						className="absolute top-1/2 -translate-y-1/2 text-sm font-medium"
						style={{
							left: `calc(${Math.max(clampedPercent, 2)}% + 8px)`,
							color: theme.colors.textMain,
						}}
					>
						{displayPercent}%
					</span>
				)}
			</div>
			<div
				className="text-xs text-left whitespace-nowrap flex-shrink-0 ml-auto"
				style={{ color: theme.colors.textDim, minWidth: '12rem' }}
				title={resetsAt ? `Resets at ${new Date(resetsAt).toLocaleString()}` : undefined}
			>
				{resetsAt ? `resets ${formatFutureTime(resetsAt)}` : 'reset unknown'}
			</div>
		</div>
	);
});

const AccountPill = memo(function AccountPill({
	codexHomeKey,
	theme,
}: {
	codexHomeKey: string;
	theme: Theme;
}) {
	return (
		<span
			className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
			style={{
				color: theme.colors.accent,
				backgroundColor: `${theme.colors.accent}15`,
				border: `1px solid ${theme.colors.accent}35`,
			}}
			title={codexHomeKey}
		>
			{deriveAccountDisplayName(codexHomeKey)}
		</span>
	);
});

interface AccountRowProps {
	codexHomeKey: string;
	snapshot: CodexUsageSnapshot;
	theme: Theme;
}

const AccountRow = memo(function AccountRow({ codexHomeKey, snapshot, theme }: AccountRowProps) {
	const shortName = deriveAccountShortName(codexHomeKey);
	const hasBars =
		snapshot.session || snapshot.weekly || (snapshot.additionalLimits?.length ?? 0) > 0;

	return (
		<div className="space-y-2" data-testid={`codex-plan-row-${shortName}`}>
			<div className="flex items-center gap-2">
				<AccountPill codexHomeKey={codexHomeKey} theme={theme} />
				{snapshot.email && (
					<div className="text-xs" style={{ color: theme.colors.textDim, opacity: 0.7 }}>
						{snapshot.email}
					</div>
				)}
				{snapshot.planType && (
					<div
						className="text-xs px-1.5 py-0.5 rounded"
						style={{
							color: theme.colors.accent,
							backgroundColor: `${theme.colors.accent}15`,
						}}
					>
						{snapshot.planType}
					</div>
				)}
			</div>

			{snapshot.authState !== 'authenticated' ? (
				<div
					className="flex items-center gap-2 px-3 py-2 rounded text-xs"
					style={{
						backgroundColor: `${theme.colors.warning ?? theme.colors.accent}15`,
						color: theme.colors.textMain,
						border: `1px solid ${theme.colors.warning ?? theme.colors.accent}40`,
					}}
					data-testid={`codex-plan-row-${shortName}-${snapshot.authState}`}
				>
					<span style={{ color: theme.colors.warning ?? theme.colors.accent }}>●</span>
					<span>{snapshot.error ?? 'Codex quota is unavailable for this account.'}</span>
				</div>
			) : hasBars ? (
				<>
					{snapshot.session && (
						<BarRow
							label="Session (5h)"
							percent={snapshot.session.percent}
							resetsAt={snapshot.session.resetsAt}
							theme={theme}
						/>
					)}
					{snapshot.weekly && (
						<BarRow
							label="Weekly"
							percent={snapshot.weekly.percent}
							resetsAt={snapshot.weekly.resetsAt}
							theme={theme}
						/>
					)}
					{(snapshot.additionalLimits ?? []).map((limit) => (
						<BarRow
							key={limit.name}
							label={limit.name}
							percent={limit.percent}
							resetsAt={limit.resetsAt}
							theme={theme}
						/>
					))}
				</>
			) : (
				<div
					className="flex items-center gap-2 px-3 py-2 rounded text-xs"
					style={{
						backgroundColor: `${theme.colors.accent}10`,
						color: theme.colors.textMain,
						border: `1px solid ${theme.colors.accent}30`,
					}}
				>
					<span style={{ color: theme.colors.accent }}>○</span>
					<span>Quota endpoint returned no rate-limit windows for this account.</span>
				</div>
			)}
		</div>
	);
});

const PendingRow = memo(function PendingRow({
	codexHomeKey,
	theme,
}: {
	codexHomeKey: string;
	theme: Theme;
}) {
	const shortName = deriveAccountShortName(codexHomeKey);
	return (
		<div className="space-y-2" data-testid={`codex-plan-row-${shortName}-pending`}>
			<div className="flex items-center gap-2">
				<AccountPill codexHomeKey={codexHomeKey} theme={theme} />
				<div className="text-xs" style={{ color: theme.colors.textDim, opacity: 0.7 }}>
					{codexHomeKey}
				</div>
			</div>
			<div
				className="flex items-center gap-2 px-3 py-2 rounded text-xs"
				style={{
					backgroundColor: `${theme.colors.accent}10`,
					color: theme.colors.textMain,
					border: `1px solid ${theme.colors.accent}30`,
				}}
			>
				<span style={{ color: theme.colors.accent }}>○</span>
				<span>
					No snapshot cached for this account yet. Hit{' '}
					<strong style={{ color: theme.colors.accent }}>Refresh</strong>.
				</span>
			</div>
		</div>
	);
});

export const CodexPlanUsage = memo(function CodexPlanUsage({
	theme,
	accountKeys = [],
	showAllAccounts = false,
	autoRefresh = true,
	showRefreshButton = true,
}: CodexPlanUsageProps) {
	const snapshots = useCodexUsageStore((s) => s.snapshots);
	const refreshing = useCodexUsageStore((s) => s.refreshing);
	const sessions = useSessionStore((s) => s.sessions);
	const [agentLevelEnvVars, setAgentLevelEnvVars] = useState<Record<string, string>>({});
	const [discoveredAccountKeys, setDiscoveredAccountKeys] = useState<string[]>([]);
	const [homeDir, setHomeDir] = useState<string | undefined>(getHomeDir);

	useEffect(() => {
		let cancelled = false;
		window.maestro.agents
			.getCustomEnvVars('codex')
			.then((env) => {
				if (!cancelled && env) setAgentLevelEnvVars(env);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		const getKeys = window.maestro.agents.getCodexUsageAccountKeys;
		if (typeof getKeys !== 'function') return;
		Promise.resolve(getKeys())
			.then((keys) => {
				if (!cancelled && Array.isArray(keys)) {
					setDiscoveredAccountKeys(keys.map(normalizeCodexHomeKey));
				}
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!homeDir) {
			getHomeDirAsync()?.then(setHomeDir);
		}
	}, [homeDir]);

	const defaultCodexHomeKey = homeDir ? normalizeCodexHomeKey(`${homeDir}/.codex`) : null;

	const configuredAccountKeys = useMemo(() => {
		const keys = new Set<string>();
		for (const key of accountKeys) {
			keys.add(normalizeCodexHomeKey(key));
		}
		for (const key of discoveredAccountKeys) {
			keys.add(normalizeCodexHomeKey(key));
		}
		for (const s of sessions) {
			if (s.toolType !== 'codex') continue;
			const sessionEnv = (s.customEnvVars ?? {}) as Record<string, string>;
			const merged = { ...agentLevelEnvVars, ...sessionEnv };
			const dir = merged.CODEX_HOME;
			if (typeof dir === 'string' && dir.length > 0) {
				keys.add(normalizeCodexHomeKey(dir));
			} else if (defaultCodexHomeKey) {
				keys.add(defaultCodexHomeKey);
			}
		}
		for (const key of Object.keys(snapshots)) {
			keys.add(normalizeCodexHomeKey(key));
		}
		return Array.from(keys).sort((a, b) =>
			deriveAccountShortName(a).localeCompare(deriveAccountShortName(b))
		);
	}, [
		accountKeys,
		discoveredAccountKeys,
		sessions,
		agentLevelEnvVars,
		snapshots,
		defaultCodexHomeKey,
	]);

	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	useEffect(() => {
		if (configuredAccountKeys.length === 0) {
			if (selectedKey !== null) setSelectedKey(null);
			return;
		}
		if (selectedKey === null || !configuredAccountKeys.includes(selectedKey)) {
			setSelectedKey(configuredAccountKeys[0]);
		}
	}, [configuredAccountKeys, selectedKey]);

	const effectiveSelectedKey = selectedKey ?? configuredAccountKeys[0] ?? null;
	const selectedSnapshot = effectiveSelectedKey ? (snapshots[effectiveSelectedKey] ?? null) : null;
	const snapshotCount = Object.keys(snapshots).length;

	const [visualBusy, setVisualBusy] = useState(false);
	const [refreshIntervalMs, setRefreshIntervalMs] = useState(0);
	const handleRefresh = useCallback(async () => {
		if (refreshing || visualBusy) return;
		setVisualBusy(true);
		const minVisibleMs = 900;
		const start = Date.now();
		try {
			await window.maestro.agents.refreshCodexUsageSnapshots();
		} catch {
			// Main logs carry the detailed failure. Keep the last renderer snapshot.
		}
		await useCodexUsageStore.getState().refresh();
		const elapsed = Date.now() - start;
		if (elapsed < minVisibleMs) {
			await new Promise((r) => setTimeout(r, minVisibleMs - elapsed));
		}
		setVisualBusy(false);
	}, [refreshing, visualBusy]);
	const handleRefreshRef = useRef(handleRefresh);
	useEffect(() => {
		handleRefreshRef.current = handleRefresh;
	}, [handleRefresh]);

	const autoRefreshFiredRef = useRef(false);
	useEffect(() => {
		if (!autoRefresh) return;
		if (autoRefreshFiredRef.current) return;
		if (configuredAccountKeys.length === 0) return;
		if (snapshotCount > 0) return;
		if (refreshing || visualBusy) return;
		autoRefreshFiredRef.current = true;
		void handleRefresh();
	}, [
		autoRefresh,
		configuredAccountKeys.length,
		snapshotCount,
		refreshing,
		visualBusy,
		handleRefresh,
	]);

	useEffect(() => {
		if (!showRefreshButton) return;
		if (refreshIntervalMs <= 0) return;
		if (configuredAccountKeys.length === 0) return;
		if (snapshotCount === 0) return;
		const timer = window.setInterval(() => {
			void handleRefreshRef.current();
		}, refreshIntervalMs);
		return () => window.clearInterval(timer);
	}, [showRefreshButton, refreshIntervalMs, configuredAccountKeys.length, snapshotCount]);

	const isBusy = refreshing || visualBusy;
	const renderAccount = useCallback(
		(codexHomeKey: string) => {
			const snapshot = snapshots[codexHomeKey];
			return snapshot ? (
				<AccountRow
					key={codexHomeKey}
					codexHomeKey={codexHomeKey}
					snapshot={snapshot}
					theme={theme}
				/>
			) : (
				<PendingRow key={codexHomeKey} codexHomeKey={codexHomeKey} theme={theme} />
			);
		},
		[snapshots, theme]
	);

	return (
		<div
			className="p-4 rounded-lg"
			style={{ backgroundColor: theme.colors.bgMain }}
			data-testid="codex-plan-usage"
		>
			<div className="flex flex-wrap items-center justify-between gap-3 mb-4">
				<h3 className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
					Codex Plan Usage
				</h3>
				{showRefreshButton && (
					<div className="flex flex-wrap items-center justify-end gap-2">
						<label className="relative flex items-center">
							<Clock
								className="w-3.5 h-3.5 absolute left-2.5 pointer-events-none"
								style={{ color: theme.colors.textDim }}
							/>
							<select
								value={refreshIntervalMs}
								onChange={(event) => setRefreshIntervalMs(Number(event.target.value))}
								className="pl-8 pr-7 py-1.5 rounded text-xs border cursor-pointer outline-none appearance-none"
								style={{
									backgroundColor: theme.colors.bgActivity,
									borderColor: theme.colors.border,
									color: theme.colors.textMain,
								}}
								aria-label="Codex usage auto refresh interval"
								data-testid="codex-plan-refresh-interval"
							>
								{REFRESH_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										Auto refresh: {option.label}
									</option>
								))}
							</select>
							<ChevronDown
								className="absolute right-2 w-3 h-3 pointer-events-none"
								style={{ color: theme.colors.textDim }}
								aria-hidden="true"
							/>
						</label>
						<button
							type="button"
							onClick={handleRefresh}
							disabled={isBusy}
							className="relative flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:cursor-not-allowed overflow-hidden"
							style={{
								color: isBusy ? theme.colors.bgMain : theme.colors.accent,
								backgroundColor: isBusy ? theme.colors.accent : `${theme.colors.accent}15`,
								border: `1px solid ${theme.colors.accent}40`,
								minWidth: '7.25rem',
							}}
							data-testid="codex-plan-refresh"
							aria-label="Refresh Codex usage snapshots"
							aria-busy={isBusy}
						>
							{isBusy ? (
								<>
									<span
										className="absolute inset-0 pointer-events-none codex-plan-refresh-sweep"
										style={{
											backgroundImage: `linear-gradient(90deg, transparent 0%, ${theme.colors.bgMain}66 50%, transparent 100%)`,
										}}
										aria-hidden="true"
									/>
									<Loader2 className="w-3.5 h-3.5 animate-spin relative" aria-hidden="true" />
									<span className="relative">Sampling...</span>
								</>
							) : (
								<>
									<RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
									<span>Refresh</span>
								</>
							)}
						</button>
					</div>
				)}
			</div>

			{showAllAccounts && configuredAccountKeys.length > 0 && (
				<div className="space-y-4">{configuredAccountKeys.map(renderAccount)}</div>
			)}

			{!showAllAccounts && configuredAccountKeys.length >= 1 && (
				<div
					className="flex items-center gap-1 mb-4 border-b"
					style={{ borderColor: theme.colors.border }}
					role="tablist"
					aria-label="Codex account selector"
					data-testid="codex-plan-account-tabs"
				>
					{configuredAccountKeys.map((codexHomeKey) => {
						const shortName = deriveAccountShortName(codexHomeKey);
						const isActive = effectiveSelectedKey === codexHomeKey;
						const tabSnapshot = snapshots[codexHomeKey];
						const hasSnapshot = !!tabSnapshot;
						const isWarning = tabSnapshot && tabSnapshot.authState !== 'authenticated';
						return (
							<button
								key={codexHomeKey}
								type="button"
								role="tab"
								aria-selected={isActive}
								onClick={() => setSelectedKey(codexHomeKey)}
								className="px-3 py-1.5 text-sm font-medium transition-colors relative -mb-px"
								style={{
									color: isActive ? theme.colors.accent : theme.colors.textDim,
									borderBottom: `2px solid ${isActive ? theme.colors.accent : 'transparent'}`,
								}}
								title={codexHomeKey}
								data-testid={`codex-plan-tab-${shortName}`}
							>
								<span className="flex items-center gap-1.5">
									{deriveAccountDisplayName(codexHomeKey)}
									{isWarning ? (
										<span
											className="text-[10px]"
											style={{ color: theme.colors.warning ?? theme.colors.accent }}
											title="Needs attention"
										>
											●
										</span>
									) : !hasSnapshot ? (
										<span
											className="text-[10px]"
											style={{ color: theme.colors.textDim, opacity: 0.6 }}
											title="No snapshot yet - hit Refresh"
										>
											○
										</span>
									) : null}
								</span>
							</button>
						);
					})}
				</div>
			)}

			{configuredAccountKeys.length === 0 ? (
				<div
					className="flex items-center justify-center h-24 text-sm text-center px-4"
					style={{ color: theme.colors.textDim }}
					data-testid="codex-plan-empty"
				>
					No Codex sessions configured. Create or open a Codex session to sample CODEX_HOME quota.
				</div>
			) : showAllAccounts ? null : effectiveSelectedKey && selectedSnapshot ? (
				<AccountRow
					key={effectiveSelectedKey}
					codexHomeKey={effectiveSelectedKey}
					snapshot={selectedSnapshot}
					theme={theme}
				/>
			) : effectiveSelectedKey ? (
				<PendingRow codexHomeKey={effectiveSelectedKey} theme={theme} />
			) : null}
		</div>
	);
});

export default CodexPlanUsage;
