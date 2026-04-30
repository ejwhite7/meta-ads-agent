/**
 * 404 Not Found page.
 *
 * Displayed when the user navigates to a route that does not match
 * any of the defined application routes.
 */

import React from "react";
import { Link } from "react-router-dom";

/**
 * Not Found page with a link back to the dashboard overview.
 */
export function NotFound(): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center">
      <h1 className="text-4xl font-bold text-gray-900">404</h1>
      <p className="text-gray-600 mt-2">Page not found.</p>
      <Link
        to="/"
        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
