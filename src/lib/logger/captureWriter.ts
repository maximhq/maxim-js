import { CommitLog } from "./components/types";
import { ILogWriter } from "./types";

/**
 * A writer that captures CommitLogs instead of sending them.
 * Used by LogLine to generate log lines using the actual container classes.
 */
export class CaptureWriter implements ILogWriter {
	private _logs: CommitLog[] = [];
	public readonly raiseExceptions: boolean = false;

	/**
	 * Captures a commit log instead of sending it.
	 */
	public commit(log: CommitLog): void {
		this._logs.push(log);
	}

	/**
	 * Returns all captured logs and clears the internal buffer.
	 */
	public drain(): CommitLog[] {
		const logs = this._logs;
		this._logs = [];
		return logs;
	}

	/**
	 * Returns all captured logs without clearing.
	 */
	public get logs(): CommitLog[] {
		return [...this._logs];
	}

	/**
	 * Clears all captured logs.
	 */
	public clear(): void {
		this._logs = [];
	}
}
