/**
 * @meta-ads-agent/dashboard entry point.
 *
 * Mounts the React application into the DOM root element.
 * Wraps the entire tree in React.StrictMode for development
 * warnings and double-rendering checks.
 *
 * Tech stack:
 *   - React 18 with TypeScript
 *   - Vite for bundling and dev server
 *   - Tailwind CSS for utility-first styling
 *   - shadcn/ui for accessible, composable UI components
 *   - Recharts for campaign performance charts
 *
 * Architecture reference: see CLAUDE.md in the repository root.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";

const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error('Root element not found. Ensure index.html contains <div id="root"></div>.');
}

ReactDOM.createRoot(rootElement).render(
	<React.StrictMode>
		<BrowserRouter>
			<App />
		</BrowserRouter>
	</React.StrictMode>,
);
