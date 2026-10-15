import { beforeEach, describe, expect, it, vi } from "vitest";
import { http } from "msw";
import { renderWithProviders, screen, waitFor } from "@tests/helpers/render.jsx";
import { stubMicrophone, denyMicrophone, wavBlob } from "@tests/helpers/media.js";
import { server } from "@tests/mocks/server.js";
import { apiBinary, apiError, apiSuccess, apiUrl } from "@tests/mocks/handlers.js";
import { audio, task as makeTask } from "@tests/factories/index.js";
import AudioRecorder from "@/components/task/AudioRecorder.jsx";

const mocks = vi.hoisted(() => ({
  stop: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/utils/wavRecorder", () => ({
  createPcmRecorder: () => ({ stop: mocks.stop, context: {} }),
}));

vi.mock("react-hot-toast", () => ({ default: mocks.toast, toast: mocks.toast }));

const TASK_ID = "task-1";

const renderRecorder = (props = {}) => {
  const task = props.task ?? makeTask({ _id: TASK_ID });
  return {
    task,
    ...renderWithProviders(
      <AudioRecorder task={task} taskId={props.taskId ?? TASK_ID} {...props} />
    ),
  };
};

/** Start then stop a take, leaving a recording pending submission. */
const recordTake = async (user) => {
  await user.click(screen.getByRole("button", { name: "Start recording" }));
  await user.click(await screen.findByRole("button", { name: "Stop recording" }));
  await screen.findByRole("button", { name: "Submit recording" });
};

beforeEach(() => {
  stubMicrophone();
  mocks.stop.mockResolvedValue(wavBlob());
  server.use(http.post(apiUrl(`/user/tasks/${TASK_ID}/audio`), () => apiSuccess({ status: "completed" })));
});

describe("recording a take", () => {
  it("offers the mic when the task has no audio yet", () => {
    renderRecorder();

    expect(screen.getByRole("button", { name: "Start recording" })).toBeInTheDocument();
  });

  it("offers Retry instead of the mic when audio was already submitted", async () => {
    server.use(http.get(apiUrl(`/user/tasks/${TASK_ID}/audio`), () => apiBinary()));

    renderRecorder({ task: makeTask({ _id: TASK_ID, audio: audio() }) });

    expect(await screen.findByRole("button", { name: "Retry recording" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start recording" })).not.toBeInTheDocument();
  });

  it("shows Retry and Submit once a take is finished", async () => {
    const { user } = renderRecorder();

    await recordTake(user);

    expect(screen.getByRole("button", { name: "Retry recording" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit recording" })).toBeInTheDocument();
  });

  it("rejects an empty take and keeps the mic available", async () => {
    mocks.stop.mockResolvedValue(wavBlob(20));
    const { user } = renderRecorder();

    await user.click(screen.getByRole("button", { name: "Start recording" }));
    await user.click(await screen.findByRole("button", { name: "Stop recording" }));

    expect(mocks.toast.error).toHaveBeenCalledWith("Recording was empty. Please try again.");
    expect(await screen.findByRole("button", { name: "Start recording" })).toBeInTheDocument();
  });

  it("reports a denied microphone instead of silently doing nothing", async () => {
    denyMicrophone();
    const { user } = renderRecorder();

    await user.click(screen.getByRole("button", { name: "Start recording" }));

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Microphone access denied. Please allow mic access.")
    );
  });
});

describe("submit confirmation", () => {
  it("asks for confirmation instead of uploading straight away", async () => {
    let uploaded = false;
    server.use(
      http.post(apiUrl(`/user/tasks/${TASK_ID}/audio`), () => {
        uploaded = true;
        return apiSuccess({});
      })
    );
    const { user } = renderRecorder();
    await recordTake(user);

    await user.click(screen.getByRole("button", { name: "Submit recording" }));

    expect(screen.getByText("Are you sure you want to submit this?")).toBeInTheDocument();
    expect(uploaded).toBe(false);
  });

  it("uploads once confirmed", async () => {
    const onAfterUpload = vi.fn();
    const { user } = renderRecorder({ onAfterUpload });
    await recordTake(user);

    await user.click(screen.getByRole("button", { name: "Submit recording" }));
    await user.click(screen.getByRole("button", { name: /Yes, submit/ }));

    await waitFor(() => expect(onAfterUpload).toHaveBeenCalled());
    expect(mocks.toast.success).toHaveBeenCalledWith("Audio submitted successfully!");
  });

  it("offers to re-record when the annotator declines, without uploading", async () => {
    const onAfterUpload = vi.fn();
    const { user } = renderRecorder({ onAfterUpload });
    await recordTake(user);

    await user.click(screen.getByRole("button", { name: "Submit recording" }));
    await user.click(screen.getByRole("button", { name: "No" }));

    expect(
      screen.getByText("Do you want to delete this recording and record it again?")
    ).toBeInTheDocument();
    expect(onAfterUpload).not.toHaveBeenCalled();
  });

  it("keeps the take when the re-record offer is declined", async () => {
    const { user } = renderRecorder();
    await recordTake(user);
    await user.click(screen.getByRole("button", { name: "Submit recording" }));
    await user.click(screen.getByRole("button", { name: "No" }));

    await user.click(screen.getByRole("button", { name: "No, keep it" }));

    expect(screen.getByRole("button", { name: "Submit recording" })).toBeInTheDocument();
    expect(
      screen.queryByText("Do you want to delete this recording and record it again?")
    ).not.toBeInTheDocument();
  });

  it("drops the take and returns to the mic when re-recording is accepted", async () => {
    const { user } = renderRecorder();
    await recordTake(user);
    await user.click(screen.getByRole("button", { name: "Submit recording" }));
    await user.click(screen.getByRole("button", { name: "No" }));

    await user.click(screen.getByRole("button", { name: /Yes, record again/ }));

    expect(screen.getByRole("button", { name: "Start recording" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit recording" })).not.toBeInTheDocument();
  });
});

describe("where submit leaves the annotator", () => {
  it("moves straight to the next task, uploading in the background", async () => {
    const onNavigate = vi.fn();
    const { user } = renderRecorder({ nextTask: { _id: "task-2" }, onNavigate });
    await recordTake(user);

    await user.click(screen.getByRole("button", { name: "Submit recording" }));
    await user.click(screen.getByRole("button", { name: /Yes, submit/ }));

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("task-2"));
  });

  it("stays put on the last task so the result is visible", async () => {
    const onNavigate = vi.fn();
    const onAfterUpload = vi.fn();
    const { user } = renderRecorder({ onNavigate, onAfterUpload });
    await recordTake(user);

    await user.click(screen.getByRole("button", { name: "Submit recording" }));
    await user.click(screen.getByRole("button", { name: /Yes, submit/ }));

    await waitFor(() => expect(onAfterUpload).toHaveBeenCalled());
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("surfaces the server's reason when the upload is refused", async () => {
    server.use(
      http.post(apiUrl(`/user/tasks/${TASK_ID}/audio`), () =>
        apiError("Recording format rejected: sample rate must be 16000 Hz.", 400)
      )
    );
    const { user } = renderRecorder();
    await recordTake(user);

    await user.click(screen.getByRole("button", { name: "Submit recording" }));
    await user.click(screen.getByRole("button", { name: /Yes, submit/ }));

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Recording format rejected: sample rate must be 16000 Hz."
      )
    );
  });
});

describe("read-only tasks", () => {
  it("offers no recording controls at all", () => {
    renderRecorder({ readOnly: true });

    expect(screen.queryByRole("button", { name: "Start recording" })).not.toBeInTheDocument();
  });
});

describe("parent notifications", () => {
  it("flags a take waiting to be sent, so the nav bar can hide plain Next", async () => {
    const onPendingRecordingChange = vi.fn();
    const { user } = renderRecorder({ onPendingRecordingChange });

    await recordTake(user);

    expect(onPendingRecordingChange).toHaveBeenLastCalledWith(true);
  });
});
