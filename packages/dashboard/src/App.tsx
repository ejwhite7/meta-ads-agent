/**
 * Root application component.
 *
 * Defines client-side routes and wraps all pages inside the
 * shared application shell (sidebar navigation + header).
 */

import type React from "react";
import { Route, Routes } from "react-router-dom";
import { Shell } from "./components/layout/Shell";
import { Campaigns } from "./pages/Campaigns";
import { Configuration } from "./pages/Configuration";
import { Decisions } from "./pages/Decisions";
import { NotFound } from "./pages/NotFound";
import { Overview } from "./pages/Overview";

/**
 * Top-level application component that sets up routing.
 */
export function App(): React.ReactElement {
	return (
		<Shell>
			<Routes>
				<Route path="/" element={<Overview />} />
				<Route path="/decisions" element={<Decisions />} />
				<Route path="/campaigns" element={<Campaigns />} />
				<Route path="/configuration" element={<Configuration />} />
				<Route path="*" element={<NotFound />} />
			</Routes>
		</Shell>
	);
}
