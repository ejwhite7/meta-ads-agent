/**
 * @meta-ads-agent/dashboard
 *
 * React web dashboard for monitoring and controlling the meta-ads-agent.
 *
 * Tech stack:
 * - React 18 with TypeScript
 * - Vite for bundling and dev server
 * - Tailwind CSS for utility-first styling
 * - shadcn/ui for accessible, composable UI components
 * - Recharts for campaign performance visualization
 *
 * Pages:
 * - /              Dashboard overview (agent status, recent decisions, key metrics)
 * - /decisions     Full decision log with filters and reasoning details
 * - /campaigns     Campaign performance table with ROAS/CPA/spend trends
 * - /settings      Agent configuration (goals, risk level, schedule)
 *
 * API integration:
 * - Connects to the Hono API server in @meta-ads-agent/core
 * - Authenticated via X-API-Key header
 * - Endpoints: /status, /decisions, /campaigns, /control/*
 *
 * Architecture reference: see CLAUDE.md in the repository root.
 */

import React from "react";
import ReactDOM from "react-dom/client";

function App() {
	return (
		<div>
			<h1>meta-ads-agent Dashboard</h1>
			<p>Dashboard UI is under construction. See CLAUDE.md for architecture reference.</p>
		</div>
	);
}

const root = document.getElementById("root");
if (root) {
	ReactDOM.createRoot(root).render(
		<React.StrictMode>
			<App />
		</React.StrictMode>,
	);
}
