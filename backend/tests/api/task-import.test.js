import { beforeEach, describe, expect, it } from "vitest";
import { buildTestApi } from "../helpers/api.js";
import { asAdmin } from "../helpers/auth.js";
import { createProject } from "../factories/project.factory.js";
import { Project, Task } from "../helpers/models.js";

const api = buildTestApi();

let admin;
let project;

beforeEach(async () => {
  admin = await asAdmin();
  project = await createProject({ createdBy: admin.user._id });
});

const csvOf = (rows) =>
  ["dialogueId,chineseTranscript,pinyin", ...rows.map((r) => `${r.id},${r.text},${r.pinyin}`)].join("\n");

const upload = (csv) =>
  api
    .post(`/api/admin/projects/${project._id}/tasks/upload`)
    .set(admin.headers)
    .attach("file", Buffer.from(csv, "utf8"), { filename: "tasks.csv", contentType: "text/csv" });

describe("POST /api/admin/projects/:projectId/tasks/upload - no size limits", () => {
  // Past both historical caps at once: more than 25,000 rows AND more than
  // 25 MB (25,001 rows x ~1.1 KB of Chinese text is ~27 MB). It also crosses
  // the DAO's 10,000-id chunk boundary, so chunked lookups/pushes are exercised.
  const BIG_ROWS = 25001;
  const PADDING = "你好今天天气很好。".repeat(40); // 360 chars, ~1.1 KB in UTF-8

  it(
    "imports a file with more than 25,000 rows and more than 25 MB, and keeps duplicate detection across chunks",
    async () => {
      const big = Array.from({ length: BIG_ROWS }, (_, i) => ({
        id: `BIG-${String(i).padStart(6, "0")}`,
        text: PADDING,
        pinyin: "ni hao",
      }));
      const bigCsv = csvOf(big);
      expect(Buffer.byteLength(bigCsv, "utf8")).toBeGreaterThan(25 * 1024 * 1024);

      const first = await upload(bigCsv);

      expect(first.status).toBe(201);
      expect(first.body.data.totalRows).toBe(BIG_ROWS);
      expect(first.body.data.createdCount).toBe(BIG_ROWS);
      expect(first.body.data.failedCount).toBe(0);
      expect(await Task.countDocuments({ projectId: project._id })).toBe(BIG_ROWS);
      expect((await Project.findById(project._id).lean()).tasks).toHaveLength(BIG_ROWS);

      // 10,100 rows alternating existing / new ids, so duplicates land in both
      // 10,000-id chunks of the lookup.
      const mixed = Array.from({ length: 10100 }, (_, i) => ({
        id: i % 2 === 0 ? `BIG-${String(i).padStart(6, "0")}` : `NEW-${String(i).padStart(6, "0")}`,
        text: "你好。",
        pinyin: "ni hao",
      }));
      const second = await upload(csvOf(mixed));

      expect(second.status).toBe(201);
      expect(second.body.data.createdCount).toBe(5050);
      expect(second.body.data.failedCount).toBe(5050);
      expect(second.body.data.errors[0].message).toMatch(/already exists/i);
      expect(await Task.countDocuments({ projectId: project._id })).toBe(BIG_ROWS + 5050);
      expect((await Project.findById(project._id).lean()).tasks).toHaveLength(BIG_ROWS + 5050);
    },
    180_000
  );
});
