import { describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";
import { renderWithProviders, screen } from "@tests/helpers/render.jsx";
import { signInAsAnnotator } from "@tests/helpers/auth.js";
import UserLayout from "@/components/layout/UserLayout.jsx";

const renderLayout = (route = "/user") =>
  renderWithProviders(
    <Routes>
      <Route path="/user/*" element={<UserLayout><p>Page content</p></UserLayout>} />
      <Route path="/login" element={<p>Login page</p>} />
    </Routes>,
    { route }
  );

describe("UserLayout", () => {
  it("shows the signed-in annotator and the page content", () => {
    const { user } = signInAsAnnotator({ name: "Li Wei", email: "li@example.com" });

    renderLayout();

    expect(screen.getByText(user.name)).toBeInTheDocument();
    expect(screen.getByText(user.email)).toBeInTheDocument();
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });

  it("links to the annotator's pages", () => {
    signInAsAnnotator();

    renderLayout();

    expect(screen.getByRole("link", { name: "My Projects" })).toHaveAttribute("href", "/user");
    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute("href", "/user/profile");
  });

  it("marks only the current page as active", () => {
    signInAsAnnotator();

    renderLayout("/user/profile");

    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "My Projects" })).not.toHaveAttribute("aria-current");
  });

  it("ends the session and returns to login on logout", async () => {
    signInAsAnnotator();
    const { user } = renderLayout();

    await user.click(screen.getByRole("button", { name: "Logout" }));

    expect(screen.getByText("Login page")).toBeInTheDocument();
    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
  });
});
