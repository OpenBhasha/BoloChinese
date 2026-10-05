import { HttpResponse } from "msw";
import { API_BASE_URL } from "../config.js";

export const apiUrl = (path) => `${API_BASE_URL}${path}`;

// Matches backend/responses/apiResponse.js.
export const apiSuccess = (data, message = "OK", status = 200) =>
  HttpResponse.json({ success: true, message, data }, { status });

export const apiError = (message, status = 400, errors) =>
  HttpResponse.json({ success: false, message, ...(errors && { errors }) }, { status });

// Endpoints a test cares about belong in that test via server.use(), so the
// expected response sits next to the assertion depending on it.
export const handlers = [];
