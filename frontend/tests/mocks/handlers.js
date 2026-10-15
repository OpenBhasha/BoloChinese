import { HttpResponse } from "msw";
import { API_BASE_URL } from "../config.js";

export const apiUrl = (path) => `${API_BASE_URL}${path}`;

// Matches backend/responses/apiResponse.js.
export const apiSuccess = (data, message = "OK", status = 200) =>
  HttpResponse.json({ success: true, message, data }, { status });

export const apiError = (message, status = 400, errors) =>
  HttpResponse.json({ success: false, message, ...(errors && { errors }) }, { status });

// Binary response, for endpoints the app requests with responseType: "blob".
// Returning JSON to those fails inside the XHR interceptor rather than in the
// app, which surfaces as an unhandled rejection rather than a useful failure.
export const apiBinary = (bytes = 2048, type = "audio/wav") =>
  new HttpResponse(new Uint8Array(bytes), { headers: { "Content-Type": type } });

// Endpoints a test cares about belong in that test via server.use(), so the
// expected response sits next to the assertion depending on it.
export const handlers = [];
