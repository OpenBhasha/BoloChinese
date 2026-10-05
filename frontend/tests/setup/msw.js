import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "../mocks/server.js";

// An unstubbed endpoint should fail the test immediately, not hang until timeout.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => server.resetHandlers());

afterAll(() => server.close());
