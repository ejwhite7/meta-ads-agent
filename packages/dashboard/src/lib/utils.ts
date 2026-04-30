/**
 * Shared utility functions for the dashboard.
 *
 * Provides the cn() helper for conditional Tailwind CSS class merging,
 * combining clsx for conditional classes with tailwind-merge for
 * deduplication of conflicting utility classes.
 */

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS class names with conflict resolution.
 *
 * Combines clsx (conditional class joining) with tailwind-merge
 * (intelligent deduplication of conflicting Tailwind utilities).
 *
 * @param inputs - Class values to merge (strings, arrays, objects).
 * @returns The merged class string.
 *
 * @example
 * cn("px-4 py-2", isActive && "bg-blue-500", "px-6")
 * // Returns "py-2 px-6 bg-blue-500" when isActive is true
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
