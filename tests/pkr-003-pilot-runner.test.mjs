import { describe, expect, test } from "vitest";

import {
  extractClaudeStructuredResult,
  isAllowedPkrPath,
  parseCodexResult,
  reviewSchema,
  validateReviewResult
} from "../scripts/pkr-003-pilot-runner.mjs";

const SHA = "a".repeat(40);

describe("PKR-003 fixed pilot runner", () => {
  test("accepts only the fixed product path envelope", () => {
    expect(isAllowedPkrPath("app/src/main/java/example/Context.kt")).toBe(true);
    expect(isAllowedPkrPath("app/src/androidTest/java/example/ContextTest.kt")).toBe(true);
    expect(isAllowedPkrPath("docs/premium-reference/capability-accessibility-matrix.md")).toBe(true);
    expect(isAllowedPkrPath("FEATURES.md")).toBe(true);
    expect(isAllowedPkrPath("PROJECT_STATE.md")).toBe(false);
    expect(isAllowedPkrPath("app/src/main/java/example/Context.java")).toBe(false);
    expect(isAllowedPkrPath("../outside.kt")).toBe(false);
  });

  test("parses exact executor identity fields", () => {
    const parsed = parseCodexResult([
      "# CODEX_RESULT",
      "status: ready_for_review",
      `pilot_start_sha: ${SHA}`,
      `candidate_sha: ${SHA}`,
      "branch: feat/pkr-003-multiagent-pilot",
      "worktree_clean: true"
    ].join("\n"));
    expect(parsed).toEqual({
      status: "ready_for_review",
      pilot_start_sha: SHA,
      candidate_sha: SHA,
      branch: "feat/pkr-003-multiagent-pilot",
      worktree_clean: "true"
    });
  });

  test("rejects incomplete executor results", () => {
    expect(() => parseCodexResult("# CODEX_RESULT\nstatus: blocked\n"))
      .toThrow(/missing required identity fields/);
  });

  test("review schema forbids extra top-level properties", () => {
    const schema = reviewSchema();
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.status.enum).toEqual(["ACCEPTED", "REWORK_REQUIRED", "BLOCKED"]);
    expect(schema.properties.findings.items.properties.classification.enum)
      .toContain("blocking_defect");
  });

  test("extracts structured_output from Claude JSON envelope", () => {
    const value = { status: "ACCEPTED", review_sha: SHA, findings: [], acceptance_criteria: [] };
    expect(extractClaudeStructuredResult(JSON.stringify({ structured_output: value }))).toEqual(value);
  });

  test("extracts JSON encoded in Claude result field", () => {
    const value = { status: "ACCEPTED", review_sha: SHA, findings: [], acceptance_criteria: [] };
    expect(extractClaudeStructuredResult(JSON.stringify({ result: JSON.stringify(value) }))).toEqual(value);
  });

  test("validates exact reviewer SHA and status", () => {
    const value = {
      status: "REWORK_REQUIRED",
      review_sha: SHA,
      findings: [],
      acceptance_criteria: []
    };
    expect(validateReviewResult(value, SHA)).toBe(value);
    expect(() => validateReviewResult({ ...value, review_sha: "b".repeat(40) }, SHA))
      .toThrow(/exact candidate SHA/);
  });
});
