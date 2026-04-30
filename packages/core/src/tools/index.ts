/**
 * @module tools
 * @description Central registry of all agent tools. Import this module to
 * access the full tool suite organized by capability domain.
 */

// Campaign management tools
export * from './campaign/index.js';
export { campaignTools } from './campaign/index.js';

// Budget optimization tools
export * from './budget/index.js';
export { budgetTools } from './budget/index.js';

// Creative generation tools
export * from './creative/index.js';
export { creativeTools } from './creative/index.js';

// Reporting & analytics tools
export * from './reporting/index.js';
export { reportingTools } from './reporting/index.js';

/**
 * All tools combined — use this to register the full tool suite with the agent.
 */
export const allTools = [
  ...campaignTools,
  ...budgetTools,
  ...creativeTools,
  ...reportingTools,
];
