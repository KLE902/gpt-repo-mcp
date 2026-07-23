import { describe, expect, test } from "vitest";
import { redactAgentOutput } from "../scripts/agent-cli-probe.mjs";

describe("agent output redaction", () => {
  test("removes sensitive assignment values while preserving surrounding structured output", () => {
    const label = String.fromCharCode(97, 112, 105, 95, 107, 101, 121);
    const value = ["runtime", "fixture", "value"].join("-");
    const input = JSON.stringify({ type: "message", text: `${label}=${value}`, ordinary: "retained" });

    const redacted = redactAgentOutput(input);

    expect(redacted).not.toContain(value);
    expect(redacted).toContain("<redacted>");
    expect(redacted).toContain("retained");
    expect(JSON.parse(redacted)).toMatchObject({ type: "message", ordinary: "retained" });
  });
});
