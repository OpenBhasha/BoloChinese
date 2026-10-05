import { describe, expect, it } from "vitest";
import { http } from "msw";
import { renderWithProviders, screen } from "@tests/helpers/render.jsx";
import { signInAsAdmin } from "@tests/helpers/auth.js";
import { server } from "@tests/mocks/server.js";
import { apiError, apiSuccess, apiUrl } from "@tests/mocks/handlers.js";
import { TEST_TOKEN } from "@tests/config.js";
import { useAuth } from "@/context/AuthContext.jsx";
import api from "@/api/axios.js";

function AuthBanner() {
  const { user, isAdmin } = useAuth();
  return <p>{user ? `${user.name} (admin: ${isAdmin})` : "Signed out"}</p>;
}

describe("render helper", () => {
  it("mounts inside the router and auth provider", () => {
    renderWithProviders(<AuthBanner />);

    expect(screen.getByText("Signed out")).toBeInTheDocument();
  });

  it("picks up a signed-in user from localStorage", () => {
    const { user } = signInAsAdmin();

    renderWithProviders(<AuthBanner />);

    expect(screen.getByText(`${user.name} (admin: true)`)).toBeInTheDocument();
  });

  it("starts the next test signed out again", () => {
    renderWithProviders(<AuthBanner />);

    expect(screen.getByText("Signed out")).toBeInTheDocument();
  });
});

describe("API stubbing", () => {
  it("intercepts the app's axios client", async () => {
    server.use(http.get(apiUrl("/admin/projects"), () => apiSuccess([{ _id: "p1" }])));

    const { data } = await api.get("/admin/projects");

    expect(data.data).toEqual([{ _id: "p1" }]);
  });

  it("sends the stored token through the real request interceptor", async () => {
    signInAsAdmin();
    let authHeader;
    server.use(
      http.get(apiUrl("/admin/projects"), ({ request }) => {
        authHeader = request.headers.get("authorization");
        return apiSuccess([]);
      })
    );

    await api.get("/admin/projects");

    expect(authHeader).toBe(`Bearer ${TEST_TOKEN}`);
  });

  it("clears the session and redirects to /login on a 401", async () => {
    signInAsAdmin();
    server.use(http.get(apiUrl("/admin/projects"), () => apiError("Invalid token.", 401)));

    await expect(api.get("/admin/projects")).rejects.toThrow();

    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
    expect(window.location.href).toBe("/login");
  });
});
