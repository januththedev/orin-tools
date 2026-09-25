import { describe, expect, it } from "vitest";
import { RUN_POLICY, validateRunRequest } from "../../src/run/policy.js";

describe("isolated run policy", () => {
  it("allows only bounded supported requests", () => {
    expect(validateRunRequest({ language: "python", code: "print(1)", stdin: "x" })).toEqual({ language: "python", code: "print(1)", stdin: "x" });
    expect(() => validateRunRequest({ language: "powershell", code: "Get-Date" })).toThrow(/Unsupported/);
    expect(() => validateRunRequest({ language: "javascript", code: "" })).toThrow(/empty/);
    expect(() => validateRunRequest({ language: "javascript", code: "x".repeat(RUN_POLICY.maxCodeChars + 1) })).toThrow(/large/);
    expect(() => validateRunRequest({ language: "javascript", code: "x", stdin: "y".repeat(RUN_POLICY.maxStdinChars + 1) })).toThrow(/large/);
  });
});
