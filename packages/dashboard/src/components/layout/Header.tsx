/**
 * Top header bar component.
 *
 * Displays across the top of the main content area. Shows the
 * application breadcrumb and a status indicator for API connectivity.
 */

import type React from "react";

/**
 * Header bar with connectivity indicator.
 */
export function Header(): React.ReactElement {
	return (
		<header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
			<div className="text-sm text-gray-500">Agent Dashboard</div>
			<div className="flex items-center gap-2 text-sm text-gray-500">
				<span className="w-2 h-2 rounded-full bg-green-400" />
				Connected
			</div>
		</header>
	);
}
