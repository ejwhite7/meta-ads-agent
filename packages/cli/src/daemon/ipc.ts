/**
 * IPC (Inter-Process Communication) client for controlling a running
 * meta-ads-agent daemon.
 *
 * Uses a Unix domain socket (or named pipe on Windows) located at
 * ~/.meta-ads-agent/agent.sock for bidirectional JSON-RPC communication
 * between the CLI process and the background agent daemon.
 *
 * Message format:
 *   Request:  { id: string, method: string, params: unknown }
 *   Response: { id: string, result?: unknown, error?: string }
 */

import { randomUUID } from "node:crypto";
import { type Socket, connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { CliError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

/** Path to the Unix domain socket for daemon IPC. */
const SOCKET_PATH = join(homedir(), ".meta-ads-agent", "agent.sock");

/** Default timeout for IPC requests in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * JSON-RPC style request message.
 */
interface IpcRequest {
	/** Unique request identifier for correlating responses. */
	id: string;
	/** The command method name (e.g. "start", "stop", "status"). */
	method: string;
	/** Arbitrary parameters for the command. */
	params: unknown;
}

/**
 * JSON-RPC style response message.
 */
interface IpcResponse {
	/** Matching request identifier. */
	id: string;
	/** Response payload on success. */
	result?: unknown;
	/** Error description on failure. */
	error?: string;
}

/**
 * Client for sending commands to the agent daemon over IPC.
 *
 * Each call to `send()` opens a short-lived socket connection,
 * sends a JSON message, waits for a response, and closes.
 */
export class IpcClient {
	private readonly socketPath: string;
	private readonly timeoutMs: number;

	constructor(socketPath?: string, timeoutMs?: number) {
		this.socketPath = socketPath ?? SOCKET_PATH;
		this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
	}

	/**
	 * Send a command to the daemon and wait for a response.
	 *
	 * @param method - The command name (e.g. "start", "stop", "pause").
	 * @param params - Parameters for the command.
	 * @returns The response payload from the daemon.
	 * @throws CliError if the connection fails or the daemon returns an error.
	 */
	async send(method: string, params: unknown): Promise<unknown> {
		const requestId = randomUUID();

		const request: IpcRequest = {
			id: requestId,
			method,
			params,
		};

		return new Promise<unknown>((resolve, reject) => {
			const socket: Socket = connect(this.socketPath);
			let buffer = "";

			const timeout = setTimeout(() => {
				socket.destroy();
				reject(new CliError("ECONNREFUSED", `IPC request timed out after ${this.timeoutMs}ms`));
			}, this.timeoutMs);

			socket.on("connect", () => {
				logger.debug("IPC connected, sending: %s", method);
				socket.write(`${JSON.stringify(request)}\n`);
			});

			socket.on("data", (chunk: Buffer) => {
				buffer += chunk.toString();

				const newlineIndex = buffer.indexOf("\n");
				if (newlineIndex === -1) return;

				const line = buffer.slice(0, newlineIndex);
				buffer = buffer.slice(newlineIndex + 1);

				clearTimeout(timeout);
				socket.end();

				try {
					const response = JSON.parse(line) as IpcResponse;

					if (response.id !== requestId) {
						reject(new CliError("SESSION_NOT_FOUND", "IPC response ID mismatch"));
						return;
					}

					if (response.error) {
						reject(new CliError("SESSION_NOT_FOUND", response.error));
						return;
					}

					resolve(response.result);
				} catch (parseError: unknown) {
					reject(new CliError("SESSION_NOT_FOUND", "Failed to parse IPC response"));
				}
			});

			socket.on("error", (err: Error) => {
				clearTimeout(timeout);
				const code = (err as NodeJS.ErrnoException).code;
				if (code === "ECONNREFUSED" || code === "ENOENT") {
					reject(new CliError("ECONNREFUSED"));
				} else {
					reject(err);
				}
			});
		});
	}
}
