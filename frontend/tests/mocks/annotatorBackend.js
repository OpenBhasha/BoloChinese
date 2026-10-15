import { http } from "msw";
import { task as makeTask, audio as makeAudio } from "../factories/index.js";
import { apiBinary, apiError, apiSuccess, apiUrl } from "./handlers.js";

const TERMINAL = ["completed", "discarded"];

const emptySubmission = () => ({
  status: "pending",
  pinyinVerified: null,
  correctedChineseTranscript: "",
  correctedPinyin: "",
  isCorrected: false,
  editCharCount: 0,
  discarded: { flagged: false, discardedAt: null },
  audio: null,
  timeSpentMs: 0,
});

/**
 * An in-memory model of the annotator endpoints for one project, so a journey
 * test sees each action reflected in later responses. State transitions and
 * the task-detail `nav` block follow backend/modules/user (service + dao).
 *
 * @param tasks  ordered task overrides; `submission` seeds prior progress
 */
export function createAnnotatorBackend(tasks) {
  const order = tasks.map(({ submission, ...fields }) => makeTask(fields));
  const submissions = new Map(
    tasks.map(({ submission }, i) => [order[i]._id, { ...emptySubmission(), ...submission }])
  );

  const find = (id) => order.find((t) => t._id === id);

  const nav = (id) => {
    const index = order.findIndex((t) => t._id === id);
    const completedCount = [...submissions.values()].filter((s) => TERMINAL.includes(s.status)).length;
    return {
      position: index + 1,
      total: order.length,
      prevTaskId: order[index - 1]?._id ?? null,
      nextTaskId: order[index + 1]?._id ?? null,
      completedCount,
      projectFinished: order.length > 0 && completedCount >= order.length,
    };
  };

  const detail = (id) => {
    const { timeSpentMs, ...submission } = submissions.get(id);
    return { ...find(id), ...submission, nav: nav(id) };
  };

  const update = (id, patch) => submissions.set(id, { ...submissions.get(id), ...patch });

  const withTask = (resolver) => async ({ params, request }) => {
    if (!find(params.id)) return apiError("Task not found.", 404);
    return resolver(params.id, request);
  };

  const handlers = [
    http.get(apiUrl("/user/tasks/:id"), withTask((id) => apiSuccess(detail(id)))),

    http.patch(
      apiUrl("/user/tasks/:id/verify-pinyin"),
      withTask(async (id, request) => {
        const { correct } = await request.json();
        update(id, { pinyinVerified: correct, status: correct ? "verified" : "in-progress" });
        return apiSuccess({});
      })
    ),

    http.patch(
      apiUrl("/user/tasks/:id/correct"),
      withTask(async (id, request) => {
        const { correctedChineseTranscript, correctedPinyin } = await request.json();
        update(id, { correctedChineseTranscript, correctedPinyin, isCorrected: true, status: "corrected" });
        return apiSuccess({});
      })
    ),

    http.post(
      apiUrl("/user/tasks/:id/discard"),
      withTask((id) => {
        update(id, { status: "discarded", discarded: { flagged: true, discardedAt: new Date().toISOString() } });
        return apiSuccess({});
      })
    ),

    http.post(
      apiUrl("/user/tasks/:id/audio"),
      withTask((id) => {
        const { pinyinVerified, isCorrected, discarded } = submissions.get(id);
        if (discarded.flagged) return apiError("This item was discarded. Reconsider it before recording audio.", 400);
        if (!pinyinVerified && !isCorrected) {
          return apiError("Please verify the text (or submit a correction) before recording audio.", 400);
        }
        update(id, {
          status: "completed",
          audio: makeAudio({ publicId: `bolo/audio/${id}`, url: `https://res.cloudinary.test/bolo/audio/${id}.wav` }),
        });
        return apiSuccess({ taskId: find(id).taskId, status: "completed" });
      })
    ),

    http.get(apiUrl("/user/tasks/:id/audio"), withTask(() => apiBinary())),

    http.post(
      apiUrl("/user/tasks/:id/time"),
      withTask(async (id, request) => {
        const { ms } = await request.json();
        update(id, { timeSpentMs: submissions.get(id).timeSpentMs + ms });
        return apiSuccess({ ok: true });
      })
    ),
  ];

  return {
    handlers,
    taskIds: order.map((t) => t._id),
    task: find,
    submission: (id) => submissions.get(id),
  };
}
