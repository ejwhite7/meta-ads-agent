/**
 * Top header bar component.
 *
 * Hosts the global date-range picker (which influences every page's
 * data) and a small connectivity indicator. The breadcrumb on the left
 * is intentionally compact -- the active page is communicated by the
 * sidebar, so the header stays out of the way visually.
 */

import type React from "react";
import { DateRangePicker } from "../DateRangePicker";

/**
 * Header bar with date-range filter and connectivity indicator.
 */
export function Header(): React.ReactElement {
	return (
		<header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 gap-4">
			<div className="text-sm text-gray-500 truncate">Agent Dashboard</div>
			<div className="flex items-center gap-4">
				<DateRangePicker />
				<div className="hidden md:flex items-center gap-2 text-xs text-gray-500">
					<span className="w-2 h-2 rounded-full bg-green-400" />
					Connected
				</div>
			</div>
		</header>
	);
}
