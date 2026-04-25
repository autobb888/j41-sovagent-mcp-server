import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateJobCost, recommendPrice, LLM_COSTS, CATEGORY_MARKUPS, PLATFORM_FEE } from '@junction41/sovagent-sdk';

describe('Pricing tools (pure functions)', () => {
  describe('estimateJobCost', () => {
    it('should return a positive cost for a known model', () => {
      const cost = estimateJobCost('gpt-4.1', 2000, 1000);
      assert.ok(cost > 0, 'cost should be positive');
      assert.equal(typeof cost, 'number');
    });

    it('should return higher cost for more tokens', () => {
      const cost1 = estimateJobCost('gpt-4.1', 1000, 500);
      const cost2 = estimateJobCost('gpt-4.1', 10000, 5000);
      assert.ok(cost2 > cost1, 'more tokens should cost more');
    });

    it('should include additional API costs', () => {
      const baseCost = estimateJobCost('gpt-4.1', 2000, 1000);
      const withApis = estimateJobCost('gpt-4.1', 2000, 1000, [
        { api: 'web-search', count: 5 },
      ]);
      assert.ok(withApis >= baseCost, 'API costs should add to base cost');
    });
  });

  describe('recommendPrice', () => {
    it('should return four price points', () => {
      const rec = recommendPrice({
        model: 'gpt-4.1',
        inputTokens: 2000,
        outputTokens: 1000,
        category: 'medium',
      });
      assert.ok(rec.minimum, 'should have minimum');
      assert.ok(rec.recommended, 'should have recommended');
      assert.ok(rec.premium, 'should have premium');
      assert.ok(rec.ceiling, 'should have ceiling');
    });

    it('price points should be in ascending order', () => {
      const rec = recommendPrice({
        model: 'gpt-4.1',
        inputTokens: 2000,
        outputTokens: 1000,
        category: 'medium',
      });
      assert.ok(rec.minimum.usd <= rec.recommended.usd, 'min <= recommended');
      assert.ok(rec.recommended.usd <= rec.premium.usd, 'recommended <= premium');
      assert.ok(rec.premium.usd <= rec.ceiling.usd, 'premium <= ceiling');
    });

    it('should include rawCost and platformFee', () => {
      const rec = recommendPrice({
        model: 'gpt-4.1',
        inputTokens: 2000,
        outputTokens: 1000,
        category: 'simple',
      });
      assert.ok(rec.rawCost > 0);
      assert.ok(rec.platformFee >= 0);
    });

    it('should produce VRSC values when rate provided', () => {
      const rec = recommendPrice({
        model: 'gpt-4.1',
        inputTokens: 2000,
        outputTokens: 1000,
        category: 'medium',
        vrscUsdRate: 0.50,
      });
      assert.ok(rec.recommended.vrsc > 0, 'VRSC value should be positive');
      // With $0.50/VRSC, VRSC amount should be ~2x the USD amount
      assert.ok(rec.recommended.vrsc > rec.recommended.usd, 'VRSC should be more than USD at $0.50 rate');
    });

    it('should apply privacy premium for higher tiers', () => {
      const standard = recommendPrice({
        model: 'gpt-4.1',
        inputTokens: 2000,
        outputTokens: 1000,
        category: 'medium',
        privacyTier: 'standard',
      });
      const sovereign = recommendPrice({
        model: 'gpt-4.1',
        inputTokens: 2000,
        outputTokens: 1000,
        category: 'medium',
        privacyTier: 'sovereign',
      });
      assert.ok(
        sovereign.recommended.usd >= standard.recommended.usd,
        'sovereign tier should cost at least as much as standard',
      );
    });
  });

  describe('constants', () => {
    it('LLM_COSTS should be a non-empty array', () => {
      assert.ok(Array.isArray(LLM_COSTS));
      assert.ok(LLM_COSTS.length > 0);
    });

    it('CATEGORY_MARKUPS should have expected categories', () => {
      assert.ok('trivial' in CATEGORY_MARKUPS);
      assert.ok('simple' in CATEGORY_MARKUPS);
      assert.ok('medium' in CATEGORY_MARKUPS);
      assert.ok('complex' in CATEGORY_MARKUPS);
      assert.ok('premium' in CATEGORY_MARKUPS);
    });

    it('PLATFORM_FEE should be 0.05 (5%)', () => {
      assert.equal(PLATFORM_FEE, 0.05);
    });
  });
});
