import { beforeEach, describe, expect, it, vi } from "vitest";
import { http } from "msw";
import { renderWithProviders, screen, waitFor } from "@tests/helpers/render.jsx";
import { server } from "@tests/mocks/server.js";
import { apiError, apiSuccess, apiUrl } from "@tests/mocks/handlers.js";
import { task as makeTask } from "@tests/factories/index.js";
import TranscriptVerification from "@/components/task/TranscriptVerification.jsx";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: toast, toast }));

const TASK_ID = "task-1";
const ORIGINAL = { chineseTranscript: "你好世界", pinyin: "nǐ hǎo shì jiè" };

const renderVerification = (props = {}) => {
  const onTaskUpdate = vi.fn();
  const task = props.task ?? makeTask({ _id: TASK_ID, ...ORIGINAL });
  return {
    onTaskUpdate,
    ...renderWithProviders(
      <TranscriptVerification task={task} onTaskUpdate={onTaskUpdate} {...props} />
    ),
  };
};

// Records each request body so tests assert on what was actually sent.
const captureRequests = () => {
  const sent = { verify: [], correct: [], discard: 0 };
  server.use(
    http.patch(apiUrl(`/user/tasks/${TASK_ID}/verify-pinyin`), async ({ request }) => {
      sent.verify.push(await request.json());
      return apiSuccess({});
    }),
    http.patch(apiUrl(`/user/tasks/${TASK_ID}/correct`), async ({ request }) => {
      sent.correct.push(await request.json());
      return apiSuccess({});
    }),
    http.post(apiUrl(`/user/tasks/${TASK_ID}/discard`), () => {
      sent.discard += 1;
      return apiSuccess({});
    })
  );
  return sent;
};

const editorFields = () => {
  const [chinese, pinyin] = screen.getAllByRole("textbox");
  return { chinese, pinyin };
};

const replaceText = async (user, field, value) => {
  await user.clear(field);
  await user.type(field, value);
};

let sent;

beforeEach(() => {
  sent = captureRequests();
});

describe("resuming from saved progress", () => {
  it("starts at the verify step for an untouched task", () => {
    renderVerification();

    expect(screen.getByText("Step 1 - Verify Text")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
  });

  it("goes straight to the editor when the text was already marked inaccurate", () => {
    renderVerification({ task: makeTask({ _id: TASK_ID, ...ORIGINAL, pinyinVerified: false }) });

    expect(screen.getAllByRole("textbox")).toHaveLength(2);
  });

  it("shows the submitted correction, not the original, once corrected", () => {
    renderVerification({
      task: makeTask({
        _id: TASK_ID,
        ...ORIGINAL,
        isCorrected: true,
        correctedChineseTranscript: "你好天下",
        correctedPinyin: "nǐ hǎo tiān xià",
      }),
    });

    expect(screen.getByText("Correction submitted - recording unlocked.")).toBeInTheDocument();
    expect(screen.getByText("你好天下")).toBeInTheDocument();
    expect(screen.queryByText("你好世界")).not.toBeInTheDocument();
  });

  it("locks a discarded task", () => {
    renderVerification({
      task: makeTask({ _id: TASK_ID, ...ORIGINAL, discarded: { flagged: true, discardedAt: null } }),
    });

    expect(screen.getByText("Task Discarded")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("tells a read-only annotator the task is locked", () => {
    renderVerification({
      task: makeTask({ _id: TASK_ID, ...ORIGINAL, pinyinVerified: true }),
      readOnly: true,
    });

    expect(screen.getByText(/this task is locked/)).toBeInTheDocument();
  });
});

describe("verifying the text", () => {
  it("records a Yes and unlocks recording", async () => {
    const { user, onTaskUpdate } = renderVerification();

    await user.click(screen.getByRole("button", { name: "Yes" }));

    expect(await screen.findByText("Text verified - recording unlocked.")).toBeInTheDocument();
    expect(sent.verify).toEqual([{ correct: true }]);
    expect(onTaskUpdate).toHaveBeenCalledWith({ pinyinVerified: true, status: "verified" });
  });

  it("stays on the verify step and shows the server's reason when Yes fails", async () => {
    server.use(
      http.patch(apiUrl(`/user/tasks/${TASK_ID}/verify-pinyin`), () => apiError("Task not found.", 404))
    );
    const { user, onTaskUpdate } = renderVerification();

    await user.click(screen.getByRole("button", { name: "Yes" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Task not found."));
    expect(screen.getByText("Step 1 - Verify Text")).toBeInTheDocument();
    expect(onTaskUpdate).not.toHaveBeenCalled();
  });

  it("asks what to do on No, without recording anything yet", async () => {
    const { user } = renderVerification();

    await user.click(screen.getByRole("button", { name: "No" }));

    expect(screen.getByText("What next?")).toBeInTheDocument();
    expect(sent.verify).toEqual([]);
    expect(sent.discard).toBe(0);
  });

  it("returns to the verify step when the choice is cancelled", async () => {
    const { user } = renderVerification();
    await user.click(screen.getByRole("button", { name: "No" }));

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("What next?")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
  });

  it("records a No and opens the editor prefilled with the original text", async () => {
    const { user } = renderVerification();
    await user.click(screen.getByRole("button", { name: "No" }));

    await user.click(screen.getByRole("button", { name: /^Edit/ }));

    await waitFor(() => expect(screen.getAllByRole("textbox")).toHaveLength(2));
    const { chinese, pinyin } = editorFields();
    expect(chinese).toHaveValue(ORIGINAL.chineseTranscript);
    expect(pinyin).toHaveValue(ORIGINAL.pinyin);
    expect(sent.verify).toEqual([{ correct: false }]);
  });
});

describe("discarding from the No prompt", () => {
  it("discards, updates the project progress, and moves to the next task", async () => {
    const onNavigate = vi.fn();
    const onProjectTaskPatch = vi.fn();
    const { user } = renderVerification({
      nextTask: { _id: "task-2" },
      prevTask: { _id: "task-0" },
      onNavigate,
      onProjectTaskPatch,
    });
    await user.click(screen.getByRole("button", { name: "No" }));

    await user.click(screen.getByRole("button", { name: /^Discard/ }));

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("task-2"));
    expect(sent.discard).toBe(1);
    expect(onProjectTaskPatch).toHaveBeenCalledWith(TASK_ID, { status: "discarded" });
  });

  it("falls back to the previous task when the last task is discarded", async () => {
    const onNavigate = vi.fn();
    const { user } = renderVerification({ prevTask: { _id: "task-0" }, onNavigate });
    await user.click(screen.getByRole("button", { name: "No" }));

    await user.click(screen.getByRole("button", { name: /^Discard/ }));

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("task-0"));
  });

  it("stays put on a single-task project", async () => {
    const onNavigate = vi.fn();
    const { user } = renderVerification({ onNavigate });
    await user.click(screen.getByRole("button", { name: "No" }));

    await user.click(screen.getByRole("button", { name: /^Discard/ }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Task discarded."));
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("submitting a correction", () => {
  const renderEditor = (props) =>
    renderVerification({
      task: makeTask({ _id: TASK_ID, ...ORIGINAL, pinyinVerified: false }),
      ...props,
    });

  it("refuses to submit when nothing was changed", async () => {
    const { user } = renderEditor();

    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(toast.error).toHaveBeenCalledWith(
      "No changes yet. Edit the Chinese and Pinyin, or use Discard to drop this task."
    );
    expect(sent.correct).toEqual([]);
  });

  it("refuses a Chinese-only edit", async () => {
    const { user } = renderEditor();
    await replaceText(user, editorFields().chinese, "你好天下");

    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(toast.error).toHaveBeenCalledWith("Edit the Pinyin text too - both sides must be updated together.");
    expect(sent.correct).toEqual([]);
  });

  it("refuses a Pinyin-only edit", async () => {
    const { user } = renderEditor();
    await replaceText(user, editorFields().pinyin, "nǐ hǎo tiān xià");

    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(toast.error).toHaveBeenCalledWith("Edit the Chinese text too - both sides must be updated together.");
    expect(sent.correct).toEqual([]);
  });

  it("refuses an empty side", async () => {
    const { user } = renderEditor();
    await user.clear(editorFields().chinese);

    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(toast.error).toHaveBeenCalledWith("Chinese and Pinyin text can't be empty.");
    expect(sent.correct).toEqual([]);
  });

  it("submits an edit to both sides and unlocks recording", async () => {
    const { user, onTaskUpdate } = renderEditor();
    const { chinese, pinyin } = editorFields();
    await replaceText(user, chinese, "你好天界");
    await replaceText(user, pinyin, "nǐ hǎo tiān jiè");

    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByText(/recording unlocked/)).toBeInTheDocument();
    expect(sent.correct).toEqual([
      { correctedChineseTranscript: "你好天界", correctedPinyin: "nǐ hǎo tiān jiè" },
    ]);
    expect(onTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ isCorrected: true, editCharCount: 1, status: "corrected" })
    );
  });

  it("keeps the draft in the editor when the server rejects the correction", async () => {
    server.use(
      http.patch(apiUrl(`/user/tasks/${TASK_ID}/correct`), () =>
        apiError("Corrected Pinyin is required", 422)
      )
    );
    const { user } = renderEditor();
    await replaceText(user, editorFields().chinese, "你好天界");
    await replaceText(user, editorFields().pinyin, "nǐ hǎo tiān jiè");

    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Corrected Pinyin is required"));
    expect(editorFields().chinese).toHaveValue("你好天界");
  });

  it("warns when the Chinese edit goes beyond a minor correction", async () => {
    const { user } = renderEditor();

    await replaceText(user, editorFields().chinese, "完全不同");

    expect(screen.getByText(/Large change - keep edits minor/)).toBeInTheDocument();
  });

  it("does not warn for a minor correction", async () => {
    const { user } = renderEditor();

    await replaceText(user, editorFields().chinese, "你好世间");

    expect(screen.queryByText(/Large change/)).not.toBeInTheDocument();
  });
});
