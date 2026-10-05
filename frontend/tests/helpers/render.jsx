import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext.jsx";

/**
 * @param path  route pattern, when the component reads useParams()
 *              e.g. renderWithProviders(<TaskDetail />, {
 *                     route: "/user/tasks/t1", path: "/user/tasks/:id" })
 */
export function renderWithProviders(
  ui,
  { route = "/", path, withAuth = true, ...options } = {}
) {
  const routed = path ? <Routes><Route path={path} element={ui} /></Routes> : ui;
  const tree = withAuth ? <AuthProvider>{routed}</AuthProvider> : routed;

  return {
    user: userEvent.setup(),
    ...render(<MemoryRouter initialEntries={[route]}>{tree}</MemoryRouter>, options),
  };
}

export * from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
