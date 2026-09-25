import { describe, expect, it } from "vitest";
import { extractWeatherIntent } from "../../src/search/weather.js";
describe("weather", () => { it("extracts English/Sinhala/Tomorrow without default city", () => { expect(extractWeatherIntent("weather in Kandy tomorrow")).toEqual({ place: "Kandy", day: "tomorrow" }); expect(extractWeatherIntent("Kandy හැසිරීම")).toBeNull(); expect(extractWeatherIntent("weather")).toBeNull(); }); });
