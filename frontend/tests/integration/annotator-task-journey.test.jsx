import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@tests/helpers/render.jsx";
import { signInAsAnnotator } from "@tests/helpers/auth.js";
import { useRealLocation } from "@tests/helpers/location.js";
import { stubMicrophone, wavBlob } from "@tests/helpers/media.js";
import { server } from "@tests/mocks/server.js";
import { createAnnotatorBackend } from "@tests/mocks/annotatorBackend.js";
import { audio } from "@tests/factories/index.js";
import App from "@/App.jsx";

const mocks = vi.hoisted(() => ({
  stop: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/utils/wavRecorder", () => ({
  createPcmRecorder: () => ({ stop: mocks.stop, context: {} }),
}));

vi.mock("react-hot-toast", () => ({ default: mocks.toast, toast: mocks.toast, Toaster: () => null }));

const DONE = { status: "completed", pinyinVerified: true, audio: audio() };

const threeTaskProject = (submissions = {}) =>
  createAnnotatorBackend(
    ["A", "B", "C"].map((letter, i) => ({
      _id: `task-${i + 1}`,
      dialogueId: `Dialogue ${letter}`,
      chineseTranscript: "你好世界",
      pinyin: "nǐ hǎo shì jiè",
      submission: submissions[`task-${i + 1}`],
    }))
  );

let backend;

const startOn = async (taskId) => {
  server.use(...backend.handlers);
  useRealLocation(`/user/tasks/${taskId}`);
  render(<App />);
  const user = userEvent.setup();
  await screen.findByRole("heading", { level: 1 });
  return user;
};

const expectOnTask = async (taskId, dialogueId) => {
  expect(await screen.findByRole("heading", { name: dialogueId })).toBeInTheDocument();
  expect(window.location.pathname).toBe(`/user/tasks/${taskId}`);
};

const nextButton = () => screen.getByRole("button", { name: "Next" });
const previousButton = () => screen.getByRole("button", { name: "Previous" });

const verifyText = async (user) => {
  await user.click(screen.getByRole("button", { name: "Yes" }));
  await screen.findByText("Text verified - recording unlocked.");
};

const recordAndSubmit = async (user) => {
  await user.click(await screen.findByRole("button", { name: "Start recording" }));
  await user.click(await screen.findByRole("button", { name: "Stop recording" }));
  await user.click(await screen.findByRole("button", { name: "Submit recording" }));
  await user.click(screen.getByRole("button", { name: /Yes, submit/ }));
};

const discard = async (user) => {
  await user.click(screen.getByRole("button", { name: "No" }));
  await user.click(screen.getByRole("button", { name: /^Discard/ }));
};

beforeEach(() => {
  signInAsAnnotator();
  stubMicrophone();
  mocks.stop.mockResolvedValue(wavBlob());
});

describe("working through a project", () => {
  it("verifies, records and submits a task, then moves straight on to the next", async () => {
    backend = threeTaskProject();
    const user = await startOn("task-1");

    await verifyText(user);
    await recordAndSubmit(user);

    await expectOnTask("task-2", "Dialogue B");
    await waitFor(() => expect(backend.submission("task-1").status).toBe("completed"));
    expect(backend.submission("task-1").pinyinVerified).toBe(true);
  });

  it("records after correcting the transcript instead of verifying it", async () => {
    backend = threeTaskProject();
    const user = await startOn("task-1");

    await user.click(screen.getByRole("button", { name: "No" }));
    await user.click(screen.getByRole("button", { name: /^Edit/ }));
    const [chinese, pinyin] = await screen.findAllByRole("textbox");
    await user.clear(chinese);
    await user.type(chinese, "你好天界");
    await user.clear(pinyin);
    await user.type(pinyin, "nǐ hǎo tiān jiè");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByText("Correction submitted - recording unlocked.");
    await recordAndSubmit(user);

    await expectOnTask("task-2", "Dialogue B");
    await waitFor(() => expect(backend.submission("task-1").status).toBe("completed"));
    expect(backend.submission("task-1")).toMatchObject({
      isCorrected: true,
      correctedChineseTranscript: "你好天界",
      correctedPinyin: "nǐ hǎo tiān jiè",
    });
  });

  it("discards a task and moves on to the next", async () => {
    backend = threeTaskProject();
    const user = await startOn("task-1");

    await discard(user);

    await expectOnTask("task-2", "Dialogue B");
    expect(backend.submission("task-1").status).toBe("discarded");
  });
});

describe("the sequential lock", () => {
  it("keeps Next locked until the task is finished, verification alone is not enough", async () => {
    backend = threeTaskProject({ "task-1": DONE });
    const user = await startOn("task-2");

    expect(previousButton()).toBeEnabled();
    expect(nextButton()).toBeDisabled();

    await verifyText(user);

    expect(nextButton()).toBeDisabled();
  });

  it("lets a finished task be revisited read-only, with Next open and re-recording still offered", async () => {
    backend = threeTaskProject({ "task-1": DONE });
    const user = await startOn("task-1");

    expect(screen.getByText(/this task is locked/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yes" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Retry recording" })).toBeInTheDocument();

    await user.click(nextButton());

    await expectOnTask("task-2", "Dialogue B");
  });

  it("shows a discarded task as locked when going back to it", async () => {
    backend = threeTaskProject({ "task-1": { status: "discarded", discarded: { flagged: true, discardedAt: null } } });
    const user = await startOn("task-2");

    await user.click(previousButton());

    await expectOnTask("task-1", "Dialogue A");
    expect(screen.getByText("Task Discarded")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start recording" })).not.toBeInTheDocument();
    expect(nextButton()).toBeEnabled();
  });
});

describe("finishing a project", () => {
  it("shows the finished screen after submitting the last task", async () => {
    backend = threeTaskProject({ "task-1": DONE, "task-2": DONE });
    const user = await startOn("task-3");

    await verifyText(user);
    await recordAndSubmit(user);

    expect(await screen.findByRole("heading", { name: "Project finished" })).toBeInTheDocument();
    expect(backend.submission("task-3").status).toBe("completed");
  });

  it("shows the finished screen after discarding the last unfinished task", async () => {
    backend = threeTaskProject({ "task-1": DONE, "task-2": DONE });
    const user = await startOn("task-3");

    await discard(user);

    expect(await screen.findByRole("heading", { name: "Project finished" })).toBeInTheDocument();
  });

  it("keeps the annotator in the project when the last task is discarded but earlier ones are not done", async () => {
    backend = threeTaskProject({ "task-1": DONE });
    const user = await startOn("task-3");

    await discard(user);

    await expectOnTask("task-2", "Dialogue B");
    expect(nextButton()).toBeDisabled();
  });
});
