import supertest from "supertest";
import createApp from "../../startup/app.js";

// createApp() only wires middleware and routers - it never calls listen() and
// never opens a database connection - so one per test file is cheap.
export const buildTestApi = () => supertest(createApp());
