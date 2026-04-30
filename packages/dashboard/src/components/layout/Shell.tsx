/**
 * Application shell layout component.
 *
 * Provides the overall page structure with a fixed sidebar for
 * navigation and a main content area with a top header bar.
 */

import type React from "react";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";

/**
 * Props for the Shell component.
 */
interface ShellProps {
	/** Page content rendered in the main area. */
	children: React.ReactNode;
}

/**
 * App shell that wraps every page with sidebar navigation and a header.
 */
export function Shell({ children }: ShellProps): React.ReactElement {
	return (
		<div className="flex h-screen bg-gray-50">
			<Sidebar />
			<div className="flex flex-col flex-1 overflow-hidden">
				<Header />
				<main className="flex-1 overflow-y-auto p-6">{children}</main>
			</div>
		</div>
	);
}
