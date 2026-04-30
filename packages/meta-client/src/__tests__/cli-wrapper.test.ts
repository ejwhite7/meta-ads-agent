/**
 * @module __tests__/cli-wrapper
 *
 * Unit tests for the CLIWrapper class. Validates exit code mapping to
 * typed errors, JSON output parsing, timeout handling, and subprocess
 * argument construction. Uses mocked child_process.spawn to avoid
 * requiring the actual meta-ads CLI binary.
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter, Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLIWrapper } from "../cli/wrapper.js";
import { AuthError, CliError, NotFoundError } from "../errors.js";
import { CliExitCode } from "../types.js";

// Mock child_process.spawn
vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}));

import { spawn } from "node:child_process";

const mockSpawn = vi.mocked(spawn);

/**
 * Creates a mock child process that emits the specified stdout, stderr,
 * and exit code.
 */
function createMockProcess(stdout: string, stderr: string, exitCode: number): ChildProcess {
	const proc = new EventEmitter() as ChildProcess;
	const stdoutStream = new Readable({ read() {} });
	const stderrStream = new Readable({ read() {} });

	proc.stdout = stdoutStream as ChildProcess["stdout"];
	proc.stderr = stderrStream as ChildProcess["stderr"];
	proc.kill = vi.fn().mockReturnValue(true);

	// Emit data and close asynchronously
	setTimeout(() => {
		if (stdout) stdoutStream.push(stdout);
		stdoutStream.push(null);
		if (stderr) stderrStream.push(stderr);
		stderrStream.push(null);
		proc.emit("close", exitCode);
	}, 0);

	return proc;
}

describe("CLIWrapper", () => {
	let wrapper: CLIWrapper;

	beforeEach(() => {
		vi.clearAllMocks();
		wrapper = new CLIWrapper({
			cliPath: "meta",
			timeout: 5000,
			accessToken: "test-token",
			adAccountId: "act_123456",
		});
	});

	describe("run()", () => {
		it("parses valid JSON output from the CLI", async () => {
			const mockData = [{ id: "123", name: "Test Campaign" }];
			mockSpawn.mockReturnValue(createMockProcess(JSON.stringify(mockData), "", 0));

			const result = await wrapper.run<typeof mockData>("campaigns", "list", {
				"account-id": "act_123",
			});

			expect(result).toEqual(mockData);
		});

		it("passes --output json and --no-input flags automatically", async () => {
			mockSpawn.mockReturnValue(createMockProcess("{}", "", 0));

			await wrapper.run("campaigns", "list", { "account-id": "act_123" });

			expect(mockSpawn).toHaveBeenCalledWith(
				"meta",
				expect.arrayContaining([
					"ads",
					"campaigns",
					"list",
					"--output",
					"json",
					"--no-input",
					"--account-id",
					"act_123",
				]),
				expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
			);
		});

		it("converts boolean args to flags without values", async () => {
			mockSpawn.mockReturnValue(createMockProcess("{}", "", 0));

			await wrapper.run("campaigns", "delete", { id: "123", force: true });

			const args = mockSpawn.mock.calls[0][1] as string[];
			expect(args).toContain("--force");
			// Boolean true should not have a value after it
			const forceIndex = args.indexOf("--force");
			expect(args[forceIndex + 1]).not.toBe("true");
		});

		it("omits false boolean args from the command", async () => {
			mockSpawn.mockReturnValue(createMockProcess("{}", "", 0));

			await wrapper.run("campaigns", "list", { force: false });

			const args = mockSpawn.mock.calls[0][1] as string[];
			expect(args).not.toContain("--force");
		});

		it("injects access token and account ID into process env", async () => {
			mockSpawn.mockReturnValue(createMockProcess("{}", "", 0));

			await wrapper.run("campaigns", "list", {});

			const envArg = mockSpawn.mock.calls[0][2] as { env: NodeJS.ProcessEnv };
			expect(envArg.env.META_ACCESS_TOKEN).toBe("test-token");
			expect(envArg.env.META_AD_ACCOUNT_ID).toBe("act_123456");
		});

		it("handles JSON output with non-JSON prefix text", async () => {
			const output = 'Warning: something\n{"id": "123"}';
			mockSpawn.mockReturnValue(createMockProcess(output, "", 0));

			const result = await wrapper.run<{ id: string }>("campaigns", "show", {
				id: "123",
			});

			expect(result).toEqual({ id: "123" });
		});

		it("handles JSON array output with prefix text", async () => {
			const output = 'Loading...\n[{"id": "1"}, {"id": "2"}]';
			mockSpawn.mockReturnValue(createMockProcess(output, "", 0));

			const result = await wrapper.run<Array<{ id: string }>>("campaigns", "list", {});

			expect(result).toEqual([{ id: "1" }, { id: "2" }]);
		});

		it("returns raw wrapper for completely non-JSON output", async () => {
			mockSpawn.mockReturnValue(createMockProcess("Just text output", "", 0));

			const result = await wrapper.run<{ raw: string }>("auth", "status", {});

			expect(result).toEqual({ raw: "Just text output" });
		});

		it("returns empty object for empty stdout", async () => {
			mockSpawn.mockReturnValue(createMockProcess("", "", 0));

			const result = await wrapper.run("campaigns", "delete", { id: "123" });

			expect(result).toEqual({});
		});
	});

	describe("exit code mapping", () => {
		it("throws AuthError for exit code 3", async () => {
			mockSpawn.mockReturnValue(createMockProcess("", "Invalid access token", CliExitCode.Auth));

			await expect(wrapper.run("campaigns", "list", {})).rejects.toThrow(AuthError);
		});

		it("throws NotFoundError for exit code 5", async () => {
			mockSpawn.mockReturnValue(createMockProcess("", "Campaign not found", CliExitCode.NotFound));

			await expect(wrapper.run("campaigns", "show", { id: "nonexistent" })).rejects.toThrow(
				NotFoundError,
			);
		});

		it("throws CliError with Usage exit code for exit code 2", async () => {
			mockSpawn.mockReturnValue(createMockProcess("", "Missing required arg", CliExitCode.Usage));

			await expect(wrapper.run("campaigns", "create", {})).rejects.toThrow(CliError);
		});

		it("throws CliError with ApiError exit code for exit code 4", async () => {
			mockSpawn.mockReturnValue(createMockProcess("", "Rate limit exceeded", CliExitCode.ApiError));

			const error = await wrapper.run("campaigns", "list", {}).catch((e: CliError) => e);

			expect(error).toBeInstanceOf(CliError);
			expect(error.exitCode).toBe(CliExitCode.ApiError);
		});

		it("throws CliError for general exit code 1", async () => {
			mockSpawn.mockReturnValue(createMockProcess("", "Something went wrong", CliExitCode.General));

			const error = await wrapper.run("campaigns", "list", {}).catch((e: CliError) => e);

			expect(error).toBeInstanceOf(CliError);
		});

		it("includes stderr content in error messages", async () => {
			mockSpawn.mockReturnValue(
				createMockProcess("", "Detailed error info here", CliExitCode.General),
			);

			const error = await wrapper.run("campaigns", "list", {}).catch((e: CliError) => e);

			expect(error.message).toContain("Detailed error info here");
		});
	});

	describe("checkInstalled()", () => {
		it("resolves successfully when CLI is available", async () => {
			mockSpawn.mockReturnValue(createMockProcess("{}", "", 0));

			await expect(wrapper.checkInstalled()).resolves.toBeUndefined();
		});

		it("resolves when CLI returns usage error (exit code 2)", async () => {
			mockSpawn.mockReturnValue(createMockProcess("", "Invalid command", CliExitCode.Usage));

			await expect(wrapper.checkInstalled()).resolves.toBeUndefined();
		});

		it("throws CliError when spawn fails with ENOENT", async () => {
			const proc = new EventEmitter() as ChildProcess;
			proc.stdout = new Readable({ read() {} }) as ChildProcess["stdout"];
			proc.stderr = new Readable({ read() {} }) as ChildProcess["stderr"];
			proc.kill = vi.fn().mockReturnValue(true);

			setTimeout(() => {
				proc.emit("error", new Error("spawn meta ENOENT"));
			}, 0);

			mockSpawn.mockReturnValue(proc);

			await expect(wrapper.checkInstalled()).rejects.toThrow(CliError);
		});
	});

	describe("whoami()", () => {
		it("returns parsed auth info on success", async () => {
			const authInfo = { name: "Test User", id: "12345" };
			mockSpawn.mockReturnValue(createMockProcess(JSON.stringify(authInfo), "", 0));

			const result = await wrapper.whoami();

			expect(result).toEqual(authInfo);
		});

		it("throws AuthError when token is invalid", async () => {
			mockSpawn.mockReturnValue(createMockProcess("", "Invalid token", CliExitCode.Auth));

			await expect(wrapper.whoami()).rejects.toThrow(AuthError);
		});
	});

	describe("timeout handling", () => {
		it("kills the process and throws on timeout", async () => {
			const proc = new EventEmitter() as ChildProcess;
			proc.stdout = new Readable({ read() {} }) as ChildProcess["stdout"];
			proc.stderr = new Readable({ read() {} }) as ChildProcess["stderr"];
			proc.kill = vi.fn().mockReturnValue(true);

			mockSpawn.mockReturnValue(proc);

			const shortTimeoutWrapper = new CLIWrapper({
				cliPath: "meta",
				timeout: 10,
			});

			// The process will never emit "close", triggering the timeout
			const promise = shortTimeoutWrapper.run("campaigns", "list", {});

			await expect(promise).rejects.toThrow("timed out");
		});
	});
});
