import { beforeEach, describe, expect, it, vi } from "vitest";
import { http } from "msw";
import { renderWithProviders, screen, waitFor } from "@tests/helpers/render.jsx";
import { server } from "@tests/mocks/server.js";
import { apiError, apiSuccess, apiUrl } from "@tests/mocks/handlers.js";
import UserResetDangerZone from "@/components/admin/UserResetDangerZone.jsx";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: toast, toast }));

const USER_ID = "user-1";
const RESET_URL = apiUrl(`/admin/users/${USER_ID}/reset`);

const renderDangerZone = (props = {}) => {
  const onReset = vi.fn();
  return {
    onReset,
    ...renderWithProviders(
      <UserResetDangerZone userId={USER_ID} userName="Li Wei" onReset={onReset} {...props} />
    ),
  };
};

const openConfirm = (user) => user.click(screen.getByRole("button", { name: "Reset" }));

// The page's Reset trigger and the modal's Reset confirm share a name, and the
// modal renders after the trigger.
const confirmButton = () => screen.getAllByRole("button", { name: "Reset" }).at(-1);

const confirmationInput = () => screen.getByRole("textbox");

let requests;

beforeEach(() => {
  requests = [];
  server.use(
    http.post(RESET_URL, async ({ request }) => {
      requests.push(await request.json());
      return apiSuccess({ tasksDeleted: 3, submissionsDeleted: 5 });
    })
  );
});

describe("opening the confirmation", () => {
  it("names the user whose data will be deleted, without deleting anything", async () => {
    const { user } = renderDangerZone();

    await openConfirm(user);

    expect(screen.getByText(/Permanently deletes Li Wei's tasks/)).toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it("falls back to a generic name when none is known", async () => {
    const { user } = renderDangerZone({ userName: undefined });

    await openConfirm(user);

    expect(screen.getByText(/Permanently deletes this user's tasks/)).toBeInTheDocument();
  });
});

describe("the typed confirmation", () => {
  it("keeps Reset disabled until RESET is typed", async () => {
    const { user } = renderDangerZone();
    await openConfirm(user);

    expect(confirmButton()).toBeDisabled();

    await user.type(confirmationInput(), "RESET");

    expect(confirmButton()).toBeEnabled();
  });

  it.each(["reset", "RESE", "RESET ", " RESET"])("does not accept %j", async (typed) => {
    const { user } = renderDangerZone();
    await openConfirm(user);

    await user.type(confirmationInput(), typed);

    expect(confirmButton()).toBeDisabled();
  });

  it("forgets what was typed when cancelled", async () => {
    const { user } = renderDangerZone();
    await openConfirm(user);
    await user.type(confirmationInput(), "RESET");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await openConfirm(user);

    expect(confirmationInput()).toHaveValue("");
    expect(confirmButton()).toBeDisabled();
  });
});

describe("resetting", () => {
  it("wipes tasks and progress for this user only, then refreshes the page", async () => {
    const { user, onReset } = renderDangerZone();
    await openConfirm(user);
    await user.type(confirmationInput(), "RESET");

    await user.click(confirmButton());

    await waitFor(() => expect(onReset).toHaveBeenCalled());
    expect(requests).toEqual([{ scope: "progress", confirm: "RESET" }]);
    expect(toast.success).toHaveBeenCalledWith(
      "Removed 3 task(s), 5 submission(s), and cleared their progress history."
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("cannot be submitted twice while the reset is in flight", async () => {
    let release;
    server.use(
      http.post(RESET_URL, async () => {
        await new Promise((resolve) => { release = resolve; });
        return apiSuccess({ tasksDeleted: 0, submissionsDeleted: 0 });
      })
    );
    const { user } = renderDangerZone();
    await openConfirm(user);
    await user.type(confirmationInput(), "RESET");

    await user.click(confirmButton());

    const busy = await screen.findByRole("button", { name: "Resetting…" });
    expect(busy).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    release();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Resetting…" })).not.toBeInTheDocument());
  });

  it("keeps the dialog open and reports the server's reason when the reset fails", async () => {
    server.use(http.post(RESET_URL, () => apiError("User not found.", 404)));
    const { user, onReset } = renderDangerZone();
    await openConfirm(user);
    await user.type(confirmationInput(), "RESET");

    await user.click(confirmButton());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("User not found."));
    expect(onReset).not.toHaveBeenCalled();
    expect(confirmationInput()).toHaveValue("RESET");
    expect(confirmButton()).toBeEnabled();
  });
});
