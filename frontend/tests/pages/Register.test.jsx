import { beforeEach, describe, expect, it, vi } from "vitest";
import { http } from "msw";
import { Route, Routes } from "react-router-dom";
import { renderWithProviders, screen, waitFor } from "@tests/helpers/render.jsx";
import { inputNamed } from "@tests/helpers/form.js";
import { server } from "@tests/mocks/server.js";
import { apiError, apiSuccess, apiUrl } from "@tests/mocks/handlers.js";
import Register from "@/pages/Register.jsx";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: toast, toast }));

const REGISTER_URL = apiUrl("/auth/register");

const renderRegister = () =>
  renderWithProviders(
    <Routes>
      <Route path="/register" element={<Register />} />
      <Route path="/login" element={<p>Login page</p>} />
    </Routes>,
    { route: "/register" }
  );

const countryCode = () => screen.getByLabelText("Country calling code");

const fillForm = async (user, { name = "Li Wei", email = "li@example.com", code, phone = "9876512345", password = "Str0ngPassword1" } = {}) => {
  await user.type(screen.getByPlaceholderText("Your full legal name"), name);
  await user.type(screen.getByPlaceholderText("you@example.com"), email);
  if (code !== undefined) {
    await user.clear(countryCode());
    await user.type(countryCode(), code);
  }
  await user.type(inputNamed("phone"), phone);
  await user.type(inputNamed("password"), password);
};

const submit = (user) => user.click(screen.getByRole("button", { name: "Create Account" }));

let sent;

beforeEach(() => {
  sent = [];
  server.use(
    http.post(REGISTER_URL, async ({ request }) => {
      sent.push(await request.json());
      return apiSuccess({}, "Registration successful.", 201);
    })
  );
});

describe("phone number entry", () => {
  it("defaults the country code to India", () => {
    renderRegister();

    expect(countryCode()).toHaveValue("+91");
  });

  it("keeps only digits in the phone number", async () => {
    const { user } = renderRegister();

    await user.type(inputNamed("phone"), "98765-12 345");

    expect(inputNamed("phone")).toHaveValue("9876512345");
  });

  it("keeps the country code to a + and at most three digits", async () => {
    const { user } = renderRegister();
    await user.clear(countryCode());

    await user.type(countryCode(), "44a12");

    expect(countryCode()).toHaveValue("+441");
  });
});

describe("registering", () => {
  it("sends the details with the phone in international format", async () => {
    const { user } = renderRegister();
    await fillForm(user);

    await submit(user);

    await waitFor(() =>
      expect(sent).toEqual([
        { name: "Li Wei", email: "li@example.com", phone: "+919876512345", password: "Str0ngPassword1" },
      ])
    );
  });

  it("drops a trunk-prefix zero typed before the number", async () => {
    const { user } = renderRegister();
    await fillForm(user, { code: "44", phone: "07911123456" });

    await submit(user);

    await waitFor(() => expect(sent[0].phone).toBe("+447911123456"));
  });

  it("never sends a role, so the server decides it", async () => {
    const { user } = renderRegister();
    await fillForm(user);

    await submit(user);

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).not.toHaveProperty("role");
  });

  it("sends the new annotator to login to await verification", async () => {
    const { user } = renderRegister();
    await fillForm(user);

    await submit(user);

    expect(await screen.findByText("Login page")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Registered! Please wait for admin verification.");
  });
});

describe("rejected registrations", () => {
  it("shows every field error the server returns", async () => {
    server.use(
      http.post(REGISTER_URL, () =>
        apiError("Validation failed", 422, [
          { field: "password", message: "Password must contain at least one uppercase letter" },
          { field: "phone", message: "Please provide a valid phone number in international format, e.g. +14155552671" },
        ])
      )
    );
    const { user } = renderRegister();
    await fillForm(user);

    await submit(user);

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
    expect(toast.error).toHaveBeenCalledWith("Password must contain at least one uppercase letter");
    expect(toast.error).not.toHaveBeenCalledWith("Validation failed");
  });

  it("shows the server's message for a duplicate account and stays on the form", async () => {
    server.use(http.post(REGISTER_URL, () => apiError("Email is already registered.", 409)));
    const { user } = renderRegister();
    await fillForm(user);

    await submit(user);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Email is already registered."));
    expect(screen.getByRole("button", { name: "Create Account" })).toBeEnabled();
    expect(screen.queryByText("Login page")).not.toBeInTheDocument();
  });
});
