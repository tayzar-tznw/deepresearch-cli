import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  AGENT_MAX,
  AGENT_STANDARD,
  assertCostBudget,
  estimateCost,
  formatUsd,
} from "../../src/util/cost.js";
import { ValidationError } from "../../src/util/errors.js";

describe("cost", () => {
  const originalEnv = process.env["GDR_CONFIRM_COST"];
  beforeEach(() => {
    delete process.env["GDR_CONFIRM_COST"];
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env["GDR_CONFIRM_COST"];
    else process.env["GDR_CONFIRM_COST"] = originalEnv;
  });

  it("estimates Max at $4.80 and Standard at $1.22", () => {
    expect(estimateCost(AGENT_MAX)).toBe(4.8);
    expect(estimateCost(AGENT_STANDARD)).toBe(1.22);
    expect(estimateCost("unknown-agent")).toBe(0);
  });

  it("formats USD with two decimals", () => {
    expect(formatUsd(4.8)).toBe("$4.80");
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("Standard tier is allowed without any opt-in", () => {
    expect(() => assertCostBudget({ agent: AGENT_STANDARD })).not.toThrow();
  });

  it("Max tier refuses without opt-in", () => {
    expect(() => assertCostBudget({ agent: AGENT_MAX })).toThrow(ValidationError);
  });

  it("Max tier allowed with --confirm-cost flag", () => {
    expect(() => assertCostBudget({ agent: AGENT_MAX, confirmCost: true })).not.toThrow();
  });

  it("Max tier allowed with GDR_CONFIRM_COST=1 env var", () => {
    process.env["GDR_CONFIRM_COST"] = "1";
    expect(() => assertCostBudget({ agent: AGENT_MAX })).not.toThrow();
  });

  it("Max tier allowed when costCeilingUsd >= estimated", () => {
    expect(() => assertCostBudget({ agent: AGENT_MAX, costCeilingUsd: 5 })).not.toThrow();
    expect(() => assertCostBudget({ agent: AGENT_MAX, costCeilingUsd: 100 })).not.toThrow();
  });

  it("Max tier still refuses if ceiling is too low and no opt-in", () => {
    expect(() => assertCostBudget({ agent: AGENT_MAX, costCeilingUsd: 1 })).toThrow(ValidationError);
  });
});
