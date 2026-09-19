import { describe, expect, it } from "vitest";
import { buildTestApi } from "../helpers/api.js";

const api = buildTestApi();

describe("GET /health", () => {
  it("reports the API as running", async () => {
    const response = await api.get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, message: expect.any(String) });
  });
});

describe("unknown routes", () => {
  it("answers 404 with the method and path that missed", async () => {
    const response = await api.get("/api/definitely-not-a-route");

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("/api/definitely-not-a-route");
  });
});
