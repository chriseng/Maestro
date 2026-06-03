/**
 * Application quit handler.
 * Manages quit confirmation flow and cleanup on application exit.
 */

import { app, ipcMain, BrowserWindow } from 'electron';
import { logger } from '../utils/logger';
import type { ProcessManager } from '../process-manager';
import type { WebServer } from '../web-server';
import { tunnelManager as tunnelManagerInstance } from '../tunnel-manager';
import type { HistoryManager } from '../history-manager';
import { isWebContentsAvailable } from '../utils/safe-send';
import { deleteCliServerInfo } from '../../shared/cli-server-discovery';
import { stopAllCueRuns } from '../cue/cue-executor';
import { stopAllCueShellRuns } from '../cue/cue-shell-executor';
import { stopAllCueCliRuns } from '../cue/cue-cli-executor';
import { flushTelemetry } from '../cue/cue-telemetry';
import { captureException } from '../utils/sentry';
import { powerManager as powerManagerInstance } from '../power-manager';

/**
 * Safety timeout for quit confirmation from the renderer.
 * If the renderer doesn't respond within this time (e.g., window already closing,
 * renderer crashed), force-quit to prevent the app from lingering in the background.
 */
const QUIT_CONFIRMATION_TIMEOUT_MS = 5000;

/**
 * Grace window between running cleanup and hard-exiting via app.exit() on a
 * normal user quit.
 *
 * After performCleanup() the only work left is fire-and-forget (telemetry POST,
 * the tunnel's SIGTERM->exit, web-server socket close). The critical teardown
 * (PTY SIGKILL, stats DB close) already ran synchronously. We let those tails
 * make progress for this long, then call app.exit() to bypass Electron's native
 * Node-environment teardown — which can deadlock on native addon finalizers
 * (e.g. node-pty ThreadSafeFunctions, MAESTRO-3B) and leave the process alive
 * forever, forcing the user to kill it manually. Kept short so quit still feels
 * instant; the trade is a sub-second delay for a guaranteed exit.
 */
const FORCE_EXIT_GRACE_MS = 750;

/** Dependencies for quit handler */
export interface QuitHandlerDependencies {
	/** Function to get the main window */
	getMainWindow: () => BrowserWindow | null;
	/** Function to get the process manager */
	getProcessManager: () => ProcessManager | null;
	/** Function to get the web server (may be null if not started) */
	getWebServer: () => WebServer | null;
	/** Function to get the history manager */
	getHistoryManager: () => HistoryManager;
	/** Tunnel manager instance */
	tunnelManager: typeof tunnelManagerInstance;
	/** Function to get active grooming session count */
	getActiveGroomingSessionCount: () => number;
	/** Function to cleanup all grooming sessions */
	cleanupAllGroomingSessions: (pm: ProcessManager) => Promise<void>;
	/** Function to close the stats database */
	closeStatsDB: () => void;
	/** Function to stop CLI watcher (optional, may not be started yet) */
	stopCliWatcher?: () => void;
	/** Function to stop settings file watcher (optional, may not be started yet) */
	stopSettingsWatcher?: () => void;
	/** Power manager instance for clearing sleep prevention on shutdown */
	powerManager: typeof powerManagerInstance;
	/** Function to stop group chat moderator cleanup interval */
	stopSessionCleanup?: () => void;
}

/** Quit handler state */
interface QuitHandlerState {
	/** Whether quit has been confirmed by user (or no busy agents) */
	quitConfirmed: boolean;
	/** Whether we're currently waiting for quit confirmation from renderer */
	isRequestingConfirmation: boolean;
	/** Safety timeout for quit confirmation — forces quit if renderer never responds */
	confirmationTimeout: ReturnType<typeof setTimeout> | null;
	/**
	 * Whether this quit is the auto-updater installing an update. On that path we
	 * must let Electron's graceful will-quit/quit teardown run so electron-updater
	 * can apply the update (Squirrel.Mac install-on-quit, the Windows NSIS handoff).
	 * The force-exit fallback is skipped when this is set.
	 */
	installingUpdate: boolean;
	/** Guards against re-entrant before-quit running cleanup / arming the timer twice. */
	cleanupStarted: boolean;
}

/** Quit handler instance */
export interface QuitHandler {
	/** Set up quit-related IPC handlers and before-quit event */
	setup: () => void;
	/** Check if quit has been confirmed */
	isQuitConfirmed: () => boolean;
	/** Mark quit as confirmed (for programmatic quit) */
	confirmQuit: () => void;
}

/**
 * Creates a quit handler that manages application quit flow.
 *
 * The quit flow:
 * 1. User attempts to quit (Cmd+Q, menu, etc.)
 * 2. before-quit is intercepted if not confirmed
 * 3. Renderer is asked to check for busy agents
 * 4. User confirms or cancels via IPC
 * 5. On confirm, cleanup runs and app quits
 *
 * @param deps - Dependencies for quit handling
 * @returns QuitHandler instance
 */
export function createQuitHandler(deps: QuitHandlerDependencies): QuitHandler {
	const {
		getMainWindow,
		getProcessManager,
		getWebServer,
		getHistoryManager,
		tunnelManager,
		getActiveGroomingSessionCount,
		cleanupAllGroomingSessions,
		closeStatsDB,
		stopCliWatcher,
		stopSettingsWatcher,
		powerManager,
		stopSessionCleanup,
	} = deps;

	const state: QuitHandlerState = {
		quitConfirmed: false,
		isRequestingConfirmation: false,
		confirmationTimeout: null,
		installingUpdate: false,
		cleanupStarted: false,
	};

	return {
		setup: () => {
			// Handle quit confirmation from renderer
			ipcMain.on('app:quitConfirmed', () => {
				logger.info('Quit confirmed by renderer', 'Window');
				clearConfirmationTimeout();
				state.isRequestingConfirmation = false;
				state.quitConfirmed = true;
				app.quit();
			});

			// Handle quit cancellation (user declined)
			ipcMain.on('app:quitCancelled', () => {
				logger.info('Quit cancelled by renderer', 'Window');
				clearConfirmationTimeout();
				state.isRequestingConfirmation = false;
				// Nothing to do - app stays running
			});

			// IMPORTANT: This handler must be synchronous for event.preventDefault() to work!
			// Async handlers return a Promise immediately, which breaks preventDefault in Electron.
			app.on('before-quit', (event) => {
				const mainWindow = getMainWindow();

				// If quit not yet confirmed, intercept and ask renderer
				if (!state.quitConfirmed) {
					event.preventDefault();

					// Prevent multiple confirmation requests (race condition protection)
					if (state.isRequestingConfirmation) {
						logger.debug(
							'Quit confirmation already in progress, ignoring duplicate request',
							'Window'
						);
						return;
					}

					// Ask renderer to check for busy agents
					if (isWebContentsAvailable(mainWindow)) {
						state.isRequestingConfirmation = true;

						// Arm safety timeout BEFORE send() so it's always active even if
						// send() throws (e.g., renderer disposed between the availability
						// check and the actual IPC call). Prevents the app from lingering
						// in the background with no window (issue #623).
						state.confirmationTimeout = setTimeout(() => {
							if (state.isRequestingConfirmation) {
								logger.warn(
									'Quit confirmation timed out — renderer did not respond, forcing quit',
									'Window'
								);
								state.isRequestingConfirmation = false;
								state.quitConfirmed = true;
								app.quit();
							}
						}, QUIT_CONFIRMATION_TIMEOUT_MS);

						logger.info('Requesting quit confirmation from renderer', 'Window');
						mainWindow.webContents.send('app:requestQuitConfirmation');
					} else {
						// No window, just quit
						state.quitConfirmed = true;
						app.quit();
					}
					return;
				}

				// Quit confirmed. Guard against a re-entrant before-quit (e.g. another
				// path calling app.quit() during the grace window) running cleanup or
				// arming the timer twice.
				if (state.cleanupStarted) {
					return;
				}
				state.cleanupStarted = true;

				// Proceed with cleanup (async operations are fire-and-forget).
				performCleanup();

				// On the update-install path, let Electron's graceful teardown run so
				// electron-updater can apply the update. Otherwise, take control of the
				// exit: hold the event loop open (preventDefault) and hard-exit via
				// app.exit() after a short grace window. This dodges the native
				// Node-environment teardown that can deadlock on native addon
				// finalizers and hang the process forever (see FORCE_EXIT_GRACE_MS).
				if (!state.installingUpdate) {
					event.preventDefault();
					setTimeout(() => {
						logger.info('Force-exiting after cleanup grace window', 'Shutdown');
						app.exit(0);
					}, FORCE_EXIT_GRACE_MS);
				}
			});
		},

		isQuitConfirmed: () => state.quitConfirmed,

		confirmQuit: () => {
			clearConfirmationTimeout();
			state.quitConfirmed = true;
			// confirmQuit() is only invoked from the auto-updater's
			// onBeforeQuitAndInstall hook (the renderer's user-quit path goes through
			// the 'app:quitConfirmed' IPC handler instead). Mark this so the
			// before-quit handler skips the force-exit and lets the updater apply the
			// update via the graceful will-quit/quit teardown.
			state.installingUpdate = true;
		},
	};

	/** Clears the quit confirmation safety timeout if active. */
	function clearConfirmationTimeout(): void {
		if (state.confirmationTimeout) {
			clearTimeout(state.confirmationTimeout);
			state.confirmationTimeout = null;
		}
	}

	/**
	 * Performs cleanup operations before app quits.
	 * Called synchronously from before-quit, so async operations are fire-and-forget.
	 */
	function performCleanup(): void {
		logger.info('Application shutting down', 'Shutdown');

		// Stop history manager watcher
		getHistoryManager().stopWatching();

		// Stop CLI activity watcher
		if (stopCliWatcher) {
			stopCliWatcher();
		}

		// Stop settings file watcher
		if (stopSettingsWatcher) {
			stopSettingsWatcher();
		}

		// Stop group chat moderator cleanup interval
		if (stopSessionCleanup) {
			stopSessionCleanup();
		}

		// Clean up active grooming sessions (context merge/transfer operations)
		const processManager = getProcessManager();
		const groomingSessionCount = getActiveGroomingSessionCount();
		if (groomingSessionCount > 0 && processManager) {
			logger.info(`Cleaning up ${groomingSessionCount} active grooming session(s)`, 'Shutdown');
			// Fire and forget - don't await
			cleanupAllGroomingSessions(processManager).catch((err) => {
				logger.error(`Error cleaning up grooming sessions: ${err}`, 'Shutdown');
			});
		}

		// Kill all active Cue processes (tracked separately from ProcessManager)
		logger.info('Killing active Cue processes', 'Shutdown');
		stopAllCueRuns();
		stopAllCueShellRuns();
		stopAllCueCliRuns();

		// Flush Cue telemetry outbox before quit so events captured between the
		// last autorun and shutdown aren't deferred to the next launch (or lost
		// if the user uninstalls). Fire-and-forget — performCleanup is sync and
		// the network call may not finish before quit, but unflushed rows
		// survive in SQLite for the next session.
		flushTelemetry({ reason: 'app-quit' }).catch((error) => {
			// Errors already logged inside flushTelemetry; report unexpected
			// failures to Sentry so we can spot regressions, but don't rethrow
			// — a network failure during shutdown shouldn't crash cleanup.
			captureException(error, {
				context: 'quit-handler.performCleanup.flushTelemetry',
			});
		});

		// Clean up all running processes. shutdown:true makes PTYs SIGKILL
		// immediately (no SIGTERM grace, no escalation timer, no onExit
		// listener) so node-pty's worker threads exit and release their
		// N-API ThreadSafeFunctions before Electron tears down the Node
		// environment. Otherwise CleanupHandles can finalize a TSFN whose
		// underlying mutex is already gone, aborting the main process
		// (Sentry MAESTRO-3B).
		logger.info('Killing all running processes', 'Shutdown');
		processManager?.killAll({ shutdown: true });

		// Clear power save blocker AFTER killAll() to prevent late process output
		// from re-arming the blocker via addBlockReason()
		powerManager.clearAllReasons();

		// Stop tunnel and web server (fire and forget)
		logger.info('Stopping tunnel', 'Shutdown');
		tunnelManager.stop().catch((err: unknown) => {
			logger.error(`Error stopping tunnel: ${err}`, 'Shutdown');
		});

		const webServer = getWebServer();
		logger.info('Stopping web server', 'Shutdown');
		webServer?.stop().catch((err: unknown) => {
			logger.error(`Error stopping web server: ${err}`, 'Shutdown');
		});

		// Delete CLI server discovery file so CLI knows we're gone
		logger.info('Deleting CLI server discovery file', 'Shutdown');
		deleteCliServerInfo();

		// Close stats database
		logger.info('Closing stats database', 'Shutdown');
		closeStatsDB();

		logger.info('Shutdown complete', 'Shutdown');
	}
}
