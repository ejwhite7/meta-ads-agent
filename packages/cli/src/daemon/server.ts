/**
 * IPC server for the meta-ads-agent daemon.
 *
 * Listens on a Unix domain socket for commands from the CLI
 * and dashboard. Handles: start, stop, pause, resume, status,
 * run-once, get-decisions, get-campaigns.
 */

import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { type Server, type Socket, createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { logger } from "../utils/logger.js";

/** Default socket path */
const DEFAULT_SOCKET_PATH = join(homedir(), ".meta-ads-agent", "agent.sock");

/**
 * JSON-RPC style request/response messages.
 */
interface IpcRequest {
	id: string;
	method: string;
	params: unknown;
}

interface IpcResponse {
	id: string;
	result?: unknown;
	error?: string;
}

/**
 * Handler function type for IPC methods.
 */
export type IpcHandler = (params: unknown) => Promise<unknown>;

/**
 * Unix domain socket server for daemon IPC.
 *
 * The CLI client (IpcClient) connects, sends a JSON line, and
 * receives a JSON line response. Each connection handles exactly
 * one request-response pair.
 */
export class IpcServer {
	private server: Server | null = null;
	private readonly socketPath: string;
	private readonly handlers: Map<string, IpcHandler> = new Map();

	constructor(socketPath?: string) {
		this.socketPath = socketPath ?? DEFAULT_SOCKET_PATH;
	}

	/**
	 * Register a handler for an IPC method.
	 */
	on(method: string, handler: IpcHandler): void {
		this.handlers.set(method, handler);
	}

	/**
	 * Start listening on the Unix domain socket.
	 */
	async start(): Promise<void> {
		/* Ensure the parent directory exists with owner-only permissions. */
		const dir = dirname(this.socketPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		} else {
			try {
				chmodSync(dir, 0o700);
			} catch {
				/* not fatal */
			}
		}

		// Clean up stale socket file
		if (existsSync(this.socketPath)) {
			try {
				unlinkSync(this.socketPath);
			} catch {
				// ignore
			}
		}

		return new Promise<void>((resolve, reject) => {
			this.server = createServer((socket: Socket) => {
				this.handleConnection(socket);
			});

			this.server.on("error", (err: Error) => {
				logger.error("IPC server error: %s", err.message);
				reject(err);
			});

			this.server.listen(this.socketPath, () => {
				/* Restrict the socket itself to owner read/write. */
				try {
					chmodSync(this.socketPath, 0o600);
				} catch (err: unknown) {
					logger.debug("Failed to chmod socket: %s", (err as Error).message);
				}
				logger.info("IPC server listening on %s", this.socketPath);
				resolve();
			});
		});
	}

	/**
	 * Stop the IPC server and clean up the socket file.
	 */
	async stop(): Promise<void> {
		return new Promise<void>((resolve) => {
			if (!this.server) {
				resolve();
				return;
			}

			this.server.close(() => {
				try {
					if (existsSync(this.socketPath)) {
						unlinkSync(this.socketPath);
					}
				} catch {
					// ignore
				}
				this.server = null;
				resolve();
			});
		});
	}

	/**
	 * Handle an incoming socket connection.
	 */
	private handleConnection(socket: Socket): void {
		let buffer = "";

		socket.on("data", (chunk: Buffer) => {
			buffer += chunk.toString();

			const newlineIndex = buffer.indexOf("\n");
			if (newlineIndex === -1) return;

			const line = buffer.slice(0, newlineIndex);
			buffer = buffer.slice(newlineIndex + 1);

			void this.processMessage(socket, line);
		});

		socket.on("error", (err: Error) => {
			logger.debug("IPC socket error: %s", err.message);
		});
	}

	/**
	 * Parse and dispatch an IPC request message.
	 */
	private async processMessage(socket: Socket, raw: string): Promise<void> {
		let request: IpcRequest;

		try {
			request = JSON.parse(raw) as IpcRequest;
		} catch {
			const response: IpcResponse = { id: "unknown", error: "Invalid JSON" };
			socket.write(`${JSON.stringify(response)}\n`);
			socket.end();
			return;
		}

		const handler = this.handlers.get(request.method);

		if (!handler) {
			const response: IpcResponse = {
				id: request.id,
				error: `Unknown method: ${request.method}`,
			};
			socket.write(`${JSON.stringify(response)}\n`);
			socket.end();
			return;
		}

		try {
			const result = await handler(request.params);
			const response: IpcResponse = { id: request.id, result };
			socket.write(`${JSON.stringify(response)}\n`);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			const response: IpcResponse = { id: request.id, error: message };
			socket.write(`${JSON.stringify(response)}\n`);
		}

		socket.end();
	}
}
