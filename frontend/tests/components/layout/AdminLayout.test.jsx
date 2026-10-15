import { describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";
import { renderWithProviders, screen } from "@tests/helpers/render.jsx";
import { signInAsAdmin } from "@tests/helpers/auth.js";
import AdminLayout from "@/components/layout/AdminLayout.jsx";

const renderLayout = (route = "/admin") =>
  renderWithProviders(
    <Routes>
      <Route path="/admin/*" element={<AdminLayout><p>Page content</p></AdminLayout>} />
      <Route path="/login" element={<p>Login page</p>} />
    </Routes>,
    { route }
  );

describe("AdminLayout", () => {
  it("shows the signed-in admin and the page content", () => {
    const { user } = signInAsAdmin({ email: "admin@example.com" });

    renderLayout();

    expect(screen.getByText(user.name)).toBeInTheDocument();
    expect(screen.getByText(user.email)).toBeInTheDocument();
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });

  it("links to every admin section", () => {
    signInAsAdmin();

    renderLayout();

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/admin");
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("href", "/admin/users");
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/admin/projects");
  });

  it("does not mark Dashboard active on a nested admin page", () => {
    signInAsAdmin();

    renderLayout("/admin/users/user-1");

    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("ends the session and returns to login on logout", async () => {
    signInAsAdmin();
    const { user } = renderLayout();

    await user.click(screen.getByRole("button", { name: "Logout" }));

    expect(screen.getByText("Login page")).toBeInTheDocument();
    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
  });
});
