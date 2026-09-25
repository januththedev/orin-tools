import { describe, expect, it } from "vitest";
import handler from "../../api/run.js";
import { responseRecorder } from "../helpers/fakes.js";
describe("run containment", () => { it("returns 410 and no compiler call", () => { const response = responseRecorder(); handler({ headers: {} }, response.res); expect(response.state.status).toBe(410); expect(response.state.body.error.code).toBe("ORIN_RUN_DISABLED"); }); });
