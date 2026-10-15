import { beforeEach, describe, expect, it, vi } from "vitest";
import { delay, http } from "msw";
import { render, screen } from "@tests/helpers/render.jsx";
import { signInAsAdmin, signInAsAnnotator } from "@tests/helpers/auth.js";
import { useRealLocation } from "@tests/helpers/location.js";
import { server } from "@tests/mocks/server.js";
import { apiUrl } from "@tests/mocks/handlers.js";
import App from "@/App.jsx";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: toast, toast, Toaster: () => null }));

// These tests are about who lands where, not what the pages show, so the
// pages' data requests are left pending.
const pending = () => delay("infinite");

beforeEach(() => {
  server.use(
    http.get(apiUrl("/admin/dashboard"), pending),
    http.get(apiUrl("/admin/backup/status"), pending),
    http.get(apiUrl("/admin/cloudinary/usage"), pending),
    http.get(apiUrl("/user/projects"), pending)
  );
});

const visit = (path) => {
  useRealLocation(path);
  render(<App />);
};

const expectLoginPage = async () => {
  expect(await screen.findByText("Sign in to your account")).toBeInTheDocument();
  expect(window.location.pathname).toBe("/login");
};

const expectAdminHome = async () => {
  expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  expect(window.location.pathname).toBe("/admin");
};

const expectAnnotatorHome = async () => {
  expect(await screen.findByRole("heading", { name: "My Projects" })).toBeInTheDocument();
  expect(window.location.pathname).toBe("/user");
};

describe("signed out", () => {
  it.each(["/", "/admin", "/admin/users", "/user", "/user/tasks/task-1"])(
    "sends %s to the login page",
    async (path) => {
      visit(path);

      await expectLoginPage();
    }
  );

  it("can reach the registration page", async () => {
    visit("/register");

    expect(await screen.findByRole("heading", { name: "Create Account" })).toBeInTheDocument();
  });

  it("treats a token with no cached user as signed out", async () => {
    localStorage.setItem("token", "orphaned.jwt.token");

    visit("/admin");

    await expectLoginPage();
  });

  it("treats an unreadable cached user as signed out instead of crashing", async () => {
    localStorage.setItem("token", "test.jwt.token");
    localStorage.setItem("user", "{not json");

    visit("/user");

    await expectLoginPage();
  });
});

describe("signed in as an annotator", () => {
  beforeEach(() => {
    signInAsAnnotator();
  });

  it("lands on their projects from the root", async () => {
    visit("/");

    await expectAnnotatorHome();
  });

  it.each(["/admin", "/admin/users", "/admin/projects/project-1"])(
    "is turned away from %s",
    async (path) => {
      visit(path);

      await expectAnnotatorHome();
    }
  );

  it("is sent home from an unknown route", async () => {
    visit("/no-such-page");

    await expectAnnotatorHome();
  });
});

describe("signed in as an admin", () => {
  beforeEach(() => {
    signInAsAdmin();
  });

  it("lands on the dashboard from the root", async () => {
    visit("/");

    await expectAdminHome();
  });

  it.each(["/user", "/user/profile"])("is turned away from %s", async (path) => {
    visit(path);

    await expectAdminHome();
  });

  it("is sent home from an unknown route", async () => {
    visit("/no-such-page");

    await expectAdminHome();
  });
});
