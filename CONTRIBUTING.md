# Contributing to meta-ads-agent

Thanks for your interest in contributing! This guide covers setup, conventions, and how to extend the agent.

## Development Setup

1. **Prerequisites**: Node.js 20+, pnpm 9+. (No Python runtime is needed -- all Meta integration goes through the Marketing API directly via axios.)

2. **Clone and install**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/meta-ads-agent.git
   cd meta-ads-agent
   pnpm install
   ```

3. **Build all packages**:
   ```bash
   pnpm build
   ```

4. **Run tests**:
   ```bash
   pnpm test
   ```

5. **Configure environment** (optional, for integration testing):
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

## Branch Naming

- `feat/<description>` — New features
- `fix/<description>` — Bug fixes
- `refactor/<description>` — Code refactoring (no behavior change)
- `docs/<description>` — Documentation updates
- `chore/<description>` — Build, CI, dependency updates

## Pull Request Requirements

1. **All CI checks must pass**: lint, typecheck, test, build
2. **Write tests** for new tools, adapters, and business logic
3. **Update CLAUDE.md** if your change affects architecture
4. **One concern per PR** — keep PRs focused and reviewable
5. **Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat(core): add creative fatigue detection tool
   fix(meta-client): handle rate limit 429 with backoff
   docs: update CLAUDE.md with new decision engine guardrails
   ```

## How to Add a New LLM Provider

1. Create `packages/core/src/llm/<provider-name>.ts`

2. Implement the `LLMProvider` interface:
   ```typescript
   import type { LLMProvider, EventStream, StreamEvent, LLMResponse } from "./provider.js";

   export class MyProvider implements LLMProvider {
     readonly name = "my-provider";
     readonly model: string;

     constructor(config: { apiKey: string; model: string }) {
       this.model = config.model;
     }

     stream(messages, tools): EventStream<StreamEvent, LLMResponse> {
       // Implement streaming with tool use
     }

     streamSimple(prompt, systemPrompt?): EventStream<StreamEvent, string> {
       // Implement simple text completion
     }
   }
   ```

3. Register in `packages/core/src/llm/registry.ts`:
   ```typescript
   registry.register("my-provider", () => new MyProvider(config));
   ```

4. Add the SDK dependency:
   ```bash
   pnpm --filter @meta-ads-agent/core add my-provider-sdk
   ```

5. Add configuration to `.env.example`:
   ```
   MY_PROVIDER_API_KEY=
   ```

6. Write tests in `packages/core/src/llm/__tests__/my-provider.test.ts`:
   - Test streaming event sequence
   - Test tool call extraction
   - Test error handling
   - Mock the SDK (do not make real API calls in tests)

## How to Add a New Meta Tool

1. Create `packages/core/src/tools/meta/<tool-name>.ts`

2. Define TypeBox parameters and factory function:
   ```typescript
   import { Type, type Static } from "@sinclair/typebox";
   import type { MetaClient } from "@meta-ads-agent/meta-client";
   import type { ToolResult } from "../types.js";

   const MyToolParams = Type.Object({
     campaignId: Type.String({ description: "Campaign to modify" }),
     // ... more parameters
   });

   type MyToolParams = Static<typeof MyToolParams>;

   export function createMyTool(metaClient: MetaClient) {
     return {
       name: "my_tool",
       description: "What this tool does",
       parameters: MyToolParams,
       execute: async (params: MyToolParams): Promise<ToolResult> => {
         // Use metaClient.cli.execute() for CLI commands
         // Use metaClient.api.* for direct API calls
         return { success: true, data: result };
       },
     };
   }
   ```

3. Register in the tool registry at `packages/core/src/tools/registry.ts`

4. Write tests — mock the MetaClient and assert correct parameters

5. All Meta operations go through `MetaClient` (or its underlying `ApiClient`) which calls the Marketing API directly. There is no CLI wrapper -- see CLAUDE.md section 4.

## Code Style

- **Formatter**: Biome with tab indentation and double quotes
- **Lint**: Biome recommended rules
- **Run locally**: `pnpm lint` (check) / `pnpm format` (auto-fix)
- **No classes for tools** — use factory functions that return plain objects
- **No `any` types** — use TypeBox `Static<T>` for runtime + compile-time safety
- **Explicit return types** on all exported functions

## Testing Conventions

- **Unit tests**: Vitest, co-located as `__tests__/<module>.test.ts`
- **Integration tests**: msw for HTTP mocking, test the full request/response cycle
- **E2E tests**: Mock both LLM and Meta API, run a complete agent tick
- **No real API calls in tests** — all external services are mocked
- **Test file naming**: `<module>.test.ts` (Vitest auto-discovers)

## Questions?

Open an issue or start a discussion. We are happy to help!
