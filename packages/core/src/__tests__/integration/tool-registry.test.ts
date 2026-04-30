/**
 * @module __tests__/integration/tool-registry.test
 *
 * Integration tests for the tool registry and the allTools barrel export.
 *
 * Verifies that:
 * 1. All tools from the campaign, creative, and reporting domains are
 *    present in the staticTools / allTools array.
 * 2. No duplicate tool names exist across domains.
 * 3. Every tool has the required interface (name, description, parameters, execute).
 * 4. Tools can be registered in a ToolRegistry without errors.
 */

import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../tools/registry.js';
import { staticTools, allTools, campaignTools, creativeTools, reportingTools } from '../../tools/index.js';

/* ------------------------------------------------------------------ */
/*  Expected tool names per domain                                    */
/* ------------------------------------------------------------------ */

const EXPECTED_CAMPAIGN_TOOLS = [
  'list_campaigns',
  'pause_campaign',
  'scale_campaign',
  'create_campaign',
  'duplicate_campaign',
  'ab_test_campaign',
  'analyze_performance',
];

const EXPECTED_CREATIVE_TOOLS = [
  'generate_ad_copy',
  'create_ad_creative',
  'analyze_creative_performance',
  'rotate_creatives',
  'retire_creative',
  'generate_image_prompts',
  'clone_top_creative',
];

const EXPECTED_REPORTING_TOOLS = [
  'get_campaign_metrics',
  'generate_performance_report',
  'detect_anomalies',
  'send_slack_webhook',
  'get_attribution_stats',
  'export_report',
];

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('Tool Registry Integration', () => {
  describe('Domain tool arrays', () => {
    it('campaignTools should export all expected campaign tools', () => {
      const names = campaignTools.map((t) => t.name);
      for (const expected of EXPECTED_CAMPAIGN_TOOLS) {
        expect(names).toContain(expected);
      }
      expect(campaignTools.length).toBe(EXPECTED_CAMPAIGN_TOOLS.length);
    });

    it('creativeTools should export all expected creative tools', () => {
      const names = (creativeTools as Array<{ name: string }>).map((t) => t.name);
      for (const expected of EXPECTED_CREATIVE_TOOLS) {
        expect(names).toContain(expected);
      }
      expect(creativeTools.length).toBe(EXPECTED_CREATIVE_TOOLS.length);
    });

    it('reportingTools should export all expected reporting tools', () => {
      const names = (reportingTools as Array<{ name: string }>).map((t) => t.name);
      for (const expected of EXPECTED_REPORTING_TOOLS) {
        expect(names).toContain(expected);
      }
      expect(reportingTools.length).toBe(EXPECTED_REPORTING_TOOLS.length);
    });
  });

  describe('allTools / staticTools combined array', () => {
    it('should contain all static tools from campaign, creative, and reporting', () => {
      const totalExpected =
        EXPECTED_CAMPAIGN_TOOLS.length +
        EXPECTED_CREATIVE_TOOLS.length +
        EXPECTED_REPORTING_TOOLS.length;

      expect(staticTools.length).toBe(totalExpected);
      expect(allTools.length).toBe(totalExpected);
    });

    it('should have no duplicate tool names', () => {
      const names = allTools.map((t) => t.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);

      // Also check across all domain arrays combined
      const allNames = [
        ...campaignTools.map((t) => t.name),
        ...(creativeTools as Array<{ name: string }>).map((t) => t.name),
        ...(reportingTools as Array<{ name: string }>).map((t) => t.name),
      ];
      const allUnique = new Set(allNames);
      expect(allUnique.size).toBe(allNames.length);
    });

    it('every tool should have the required interface properties', () => {
      for (const tool of allTools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('parameters');
        expect(tool).toHaveProperty('execute');

        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(tool.description.length).toBeGreaterThan(0);
        expect(typeof tool.execute).toBe('function');
      }
    });
  });

  describe('ToolRegistry registration', () => {
    it('should register all static tools without errors', () => {
      const registry = new ToolRegistry();

      for (const tool of allTools) {
        expect(() => registry.register(tool)).not.toThrow();
      }

      expect(registry.getAll().length).toBe(allTools.length);
    });

    it('should allow retrieval of each registered tool by name', () => {
      const registry = new ToolRegistry();

      for (const tool of allTools) {
        registry.register(tool);
      }

      for (const tool of allTools) {
        const retrieved = registry.get(tool.name);
        expect(retrieved).toBeDefined();
        expect(retrieved!.name).toBe(tool.name);
      }
    });

    it('should report has() correctly for all registered tools', () => {
      const registry = new ToolRegistry();

      for (const tool of allTools) {
        registry.register(tool);
      }

      for (const tool of allTools) {
        expect(registry.has(tool.name)).toBe(true);
      }

      expect(registry.has('nonexistent_tool')).toBe(false);
    });
  });
});
