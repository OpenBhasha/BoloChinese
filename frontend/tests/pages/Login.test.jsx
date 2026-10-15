import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { renderWithProviders, screen, waitFor } from "@tests/helpers/render.jsx";
import { inputNamed } from "@tests/helpers/form.js";
import { server } from "@tests/mocks/server.js";
import { apiError, apiSuccess, apiUrl } from "@tests/mocks/handlers.js";
import { adminUser, annotatorUser } from "@tests/factories/index.js";
import Login from "@/pages/Login.jsx";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: toast, toast }));

const LOGIN_URL = apiUrl("/auth/login");
const CREDENTIALS = { email: "li@example.com", password: "Str0ngPassword1" };

const renderLogin = () =>
  renderWithProviders(
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/admin" element={<p>Admin home</p>} />
      <Route path="/user" element={<p>Annotator home</p>} />
      <Route path="/register" element={<p>Register page</p>} />
    </Routes>,
    { route: "/login" }
  );

const signInWith = async (user, { email, password } = CREDENTIALS) => {
  await user.type(inputNamed("email"), email);
  await user.type(inputNamed("password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
};

const respondWithUser = (account, token = "issued.jwt.token") =>
  server.use(http.post(LOGIN_URL, () => apiSuccess({ token, user: account })));

describe("signing in", () => {
  it("sends the typed credentials", async () => {
    let sent;
    server.use(
      http.post(LOGIN_URL, async ({ request }) => {
        sent = await request.json();
        return apiSuccess({ token: "t", user: annotatorUser() });
      })
    );
    const { user } = renderLogin();

    await signInWith(user);

    await waitFor(() => expect(sent).toEqual(CREDENTIALS));
  });

  it("stores the session and takes an annotator to their projects", async () => {
    const account = annotatorUser({ name: "Li Wei" });
    respondWithUser(account);
    const { user } = renderLogin();

    await signInWith(user);

    expect(await screen.findByText("Annotator home")).toBeInTheDocument();
    expect(localStorage.getItem("token")).toBe("issued.jwt.token");
    expect(JSON.parse(localStorage.getItem("user"))).toEqual(account);
    expect(toast.success).toHaveBeenCalledWith("Welcome back, Li Wei!");
  });

  it("takes an admin to the dashboard", async () => {
    respondWithUser(adminUser());
    const { user } = renderLogin();

    await signInWith(user);

    expect(await screen.findByText("Admin home")).toBeInTheDocument();
  });

  it("disables the button while the request is in flight", async () => {
    let release;
    server.use(
      http.post(LOGIN_URL, async () => {
        await new Promise((resolve) => { release = resolve; });
        return apiSuccess({ token: "t", user: annotatorUser() });
      })
    );
    const { user } = renderLogin();

    await signInWith(user);

    expect(await screen.findByRole("button", { name: "Signing in..." })).toBeDisabled();
    release();
    expect(await screen.findByText("Annotator home")).toBeInTheDocument();
  });
});

describe("failing to sign in", () => {
  it("shows the server's reason for a pending account", async () => {
    server.use(
      http.post(LOGIN_URL, () => apiError("Your account is pending admin verification.", 403))
    );
    const { user } = renderLogin();

    await signInWith(user);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Your account is pending admin verification.")
    );
    expect(localStorage.getItem("token")).toBeNull();
    expect(inputNamed("email")).toHaveValue(CREDENTIALS.email);
  });

  it("falls back to a generic message when the server is unreachable", async () => {
    server.use(http.post(LOGIN_URL, () => HttpResponse.error()));
    const { user } = renderLogin();

    await signInWith(user);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Login failed"));
  });

  it("shows the error for a wrong password", async () => {
    server.use(http.post(LOGIN_URL, () => apiError("Invalid email or password.", 401)));
    const { user } = renderLogin();

    await signInWith(user);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Invalid email or password."));
  });

  // The backend answers a wrong password with 401, and the shared axios client
  // treats every 401 as an expired session by assigning window.location.href,
  // which in a browser reloads the page and discards the error and the form.
  it("keeps the user on the form after a wrong password instead of reloading the page", async () => {
    server.use(http.post(LOGIN_URL, () => apiError("Invalid email or password.", 401)));
    const { user } = renderLogin();

    await signInWith(user);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(window.location.href).not.toBe("/login");
  });
});

it("links to registration", async () => {
  const { user } = renderLogin();

  await user.click(screen.getByRole("link", { name: "Register" }));

  expect(screen.getByText("Register page")).toBeInTheDocument();
});
