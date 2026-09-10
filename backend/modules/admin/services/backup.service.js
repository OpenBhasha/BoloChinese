/**
 * Streams a .zip backup of the *finished set* (tasks whose every submission is
 * completed/discarded, untouched since the backup cutoff) straight to the HTTP
 * response - no temp files, no server-side copy.
 *
 *   <YYYY-MM-DD>/                         Asia/Kolkata calendar day
 *     README.txt
 *     manifest.json
 *     progress.csv                        every annotator - today + lifetime
 *     users.csv  projects.csv  tasks.csv
 *     submissions.csv                     flat dump of every finished submission
 *     audio_errors.csv                    only if some wav failed to download
 *     <username>/
 *       submissions.csv
 *       progress.csv                      that user's daily ledger + a live row
 *       audio/TASK-0042.wav
 *     _orphaned/submissions.csv           submissions whose user/task vanished
 *
 * On a clean delivery it stamps BackupState.lastBackupAt = cutoff, which is
 * what the cleanup endpoint later uses as its delete high-water mark.
 */
const archiver = require("archiver");
const dao = require("../dao/admin.dao");
const logger = require("../../../logging/logger");
const { toCsv } = require("../../../services/csv");
const { getAudioStream } = require("../../../services/cloudinary.service");
const { kolkataDate, KOLKATA_TZ } = require("../../../services/datetime");
const lock = require("./backupLock");

const iso = (d) => (d ? new Date(d).toISOString() : "");

const SUBMISSION_COLS = [
  { key: "taskId", header: "taskId" },
  { key: "dialogueId", header: "dialogueId" },
  { key: "projectName", header: "projectName" },
  { key: "username", header: "username" },
  { key: "status", header: "status" },
  { key: "pinyinVerified", header: "pinyinVerified" },
  { key: "isCorrected", header: "isCorrected" },
  { key: "sourceChineseTranscript", header: "sourceChineseTranscript" },
  { key: "sourcePinyin", header: "sourcePinyin" },
  { key: "correctedChineseTranscript", header: "correctedChineseTranscript" },
  { key: "correctedPinyin", header: "correctedPinyin" },
  { key: "editCharCount", header: "editCharCount" },
  { key: "discardedAt", header: "discardedAt" },
  { key: "audioFile", header: "audioFile" },
  { key: "audioDurationSeconds", header: "audioDurationSeconds" },
  { key: "audioSampleRate", header: "audioSampleRate" },
  { key: "audioBitDepth", header: "audioBitDepth" },
  { key: "audioChannels", header: "audioChannels" },
  { key: "audioFileSizeBytes", header: "audioFileSizeBytes" },
  { key: "audioUploadedAt", header: "audioUploadedAt" },
  { key: "timeSpentMs", header: "timeSpentMs" },
  { key: "createdAt", header: "createdAt" },
  { key: "updatedAt", header: "updatedAt" },
];

const USER_PROGRESS_COLS = [
  { key: "date", header: "date" },
  { key: "assigned", header: "assigned" },
  { key: "submitted", header: "submitted" },
  { key: "completed", header: "completed" },
  { key: "discarded", header: "discarded" },
  { key: "edited", header: "edited" },
  { key: "validated", header: "validated" },
  { key: "recorded", header: "recorded" },
  { key: "audioDurationSeconds", header: "audioDurationSeconds" },
  { key: "timeSpentMs", header: "timeSpentMs" },
  { key: "tasksDeleted", header: "tasksDeleted" },
  { key: "audioFilesDeleted", header: "audioFilesDeleted" },
];

const ROOT_PROGRESS_COLS = [
  { key: "username", header: "username" },
  { key: "name", header: "name" },
  { key: "email", header: "email" },
  { key: "phone", header: "phone" },
  { key: "isVerified", header: "isVerified" },
  { key: "identityFlagged", header: "identityFlagged" },
  { key: "today_assigned", header: "today_assigned" },
  { key: "today_completed", header: "today_completed" },
  { key: "today_discarded", header: "today_discarded" },
  { key: "today_edited", header: "today_edited" },
  { key: "today_validated", header: "today_validated" },
  { key: "today_recorded", header: "today_recorded" },
  { key: "today_audioSeconds", header: "today_audioSeconds" },
  { key: "today_progressPercent", header: "today_progressPercent" },
  { key: "lifetime_assigned", header: "lifetime_assigned" },
  { key: "lifetime_completed", header: "lifetime_completed" },
  { key: "lifetime_discarded", header: "lifetime_discarded" },
  { key: "lifetime_edited", header: "lifetime_edited" },
  { key: "lifetime_validated", header: "lifetime_validated" },
  { key: "lifetime_recorded", header: "lifetime_recorded" },
  { key: "lifetime_audioSeconds", header: "lifetime_audioSeconds" },
  { key: "lifetime_progressPercent", header: "lifetime_progressPercent" },
];

const USERS_COLS = [
  { key: "username", header: "username" },
  { key: "name", header: "name" },
  { key: "email", header: "email" },
  { key: "phone", header: "phone" },
  { key: "role", header: "role" },
  { key: "isVerified", header: "isVerified" },
  { key: "identityFlagged", header: "identityFlagged" },
  { key: "identityFlagReason", header: "identityFlagReason" },
  { key: "dedicatedProject", header: "dedicatedProject" },
  { key: "createdAt", header: "createdAt" },
  { key: "deletedAt", header: "deletedAt" },
];

const PROJECTS_COLS = [
  { key: "name", header: "name" },
  { key: "description", header: "description" },
  { key: "createdBy", header: "createdBy" },
  { key: "assignees", header: "assignees" },
  { key: "taskCountInBackup", header: "taskCountInBackup" },
  { key: "createdAt", header: "createdAt" },
];

const TASKS_COLS = [
  { key: "taskId", header: "taskId" },
  { key: "dialogueId", header: "dialogueId" },
  { key: "projectName", header: "projectName" },
  { key: "assignedTo", header: "assignedTo" },
  { key: "chineseTranscript", header: "chineseTranscript" },
  { key: "pinyin", header: "pinyin" },
  { key: "createdAt", header: "createdAt" },
];

const AUDIO_ERROR_COLS = [
  { key: "taskId", header: "taskId" },
  { key: "username", header: "username" },
  { key: "audioUrl", header: "audioUrl" },
  { key: "error", header: "error" },
];

// UTF-8 BOM so Excel opens the Chinese columns correctly (matches the existing
// result-export behaviour).
const csv = (cols, rows) => "\uFEFF" + toCsv(cols, rows);

const README = (dateDir) => `BoloChinese backup - ${dateDir} (Asia/Kolkata)

This archive holds the day's FINISHED work only: tasks where every annotator
submission is completed or discarded. Unfinished work stays in the app for the
annotator to continue.

Layout
  progress.csv          Every annotator. today_* and lifetime_* columns.
                        Lifetime = this backup + every earlier wiped batch.
  users.csv             Identity for each username directory below.
  projects.csv          Projects and their assignees.
  tasks.csv             Every finished task with its source Chinese + pinyin.
  submissions.csv       Every finished submission, denormalised, in one file.
  <username>/
    submissions.csv     That annotator's finished submissions.
    progress.csv        One row per past cleanup day, then a "current" row for
                        work not yet wiped.
    audio/TASK-XXXX.wav Mono 16 kHz 16-bit PCM WAV, named by task id.
  audio_errors.csv      Present only if a wav could not be downloaded. If you
                        see this file, do NOT run the cleanup yet.
  _orphaned/            Submissions whose user or task record was already gone.

manifest.json has the exact counts and the cutoff timestamp this backup was
taken at. The cleanup deletes exactly this set.
`;

// username -> safe directory segment
const sanitizeDir = (name) =>
  String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

const runBackup = async (res) => {
  lock.acquire("backup");
  const startedAt = new Date();
  const cutoff = startedAt; // finished set is frozen at this instant
  const dateDir = kolkataDate(startedAt);
  let archive;

  try {
    const [ds, perUserProgress, liveByUser] = await Promise.all([
      dao.getBackupDataset(cutoff),
      dao.getPerUserProgress(),
      dao.getLiveProgressByUser(),
    ]);

    const userById = new Map(ds.users.map((u) => [String(u._id), u]));
    const projectById = new Map(ds.projects.map((p) => [String(p._id), p]));
    const taskById = new Map(ds.tasks.map((t) => [String(t._id), t]));

    // Directory name per user, with collision fallback to a username-id6 form.
    const baseByUser = new Map();
    const baseCount = new Map();
    ds.users.forEach((u) => {
      let base = sanitizeDir(u.username);
      if (!base) base = `user-${String(u._id).slice(-6)}`;
      baseByUser.set(String(u._id), base);
      baseCount.set(base, (baseCount.get(base) || 0) + 1);
    });
    const dirFor = (userId) => {
      const base = baseByUser.get(String(userId)) || `user-${String(userId).slice(-6)}`;
      return baseCount.get(base) > 1 ? `${base}-${String(userId).slice(-6)}` : base;
    };

    // project -> [usernames], project -> finished-task count
    const assigneesByProject = new Map();
    ds.assignments.forEach((a) => {
      const u = userById.get(String(a.userId));
      if (!u) return;
      const k = String(a.projectId);
      if (!assigneesByProject.has(k)) assigneesByProject.set(k, []);
      assigneesByProject.get(k).push(u.username || u.email || String(u._id));
    });
    const taskCountByProject = new Map();
    ds.tasks.forEach((t) => {
      const k = String(t.projectId);
      taskCountByProject.set(k, (taskCountByProject.get(k) || 0) + 1);
    });

    const shapeSub = (s) => {
      const t = taskById.get(String(s.taskId));
      const u = userById.get(String(s.userId));
      const p = projectById.get(String(s.projectId));
      const hasAudio = !!(s.audio && s.audio.url);
      return {
        taskId: t?.taskId || "",
        dialogueId: t?.dialogueId || "",
        projectName: p?.name || "",
        username: u?.username || u?.email || "",
        status: s.status,
        pinyinVerified: s.pinyinVerified,
        isCorrected: s.isCorrected,
        sourceChineseTranscript: t?.chineseTranscript || "",
        sourcePinyin: t?.pinyin || "",
        correctedChineseTranscript: s.correctedChineseTranscript || "",
        correctedPinyin: s.correctedPinyin || "",
        editCharCount: s.editCharCount || 0,
        discardedAt: iso(s.discarded?.discardedAt),
        audioFile: hasAudio && t?.taskId ? `${t.taskId}.wav` : "",
        audioDurationSeconds: s.audio?.durationSeconds || 0,
        audioSampleRate: s.audio?.sampleRate || "",
        audioBitDepth: s.audio?.bitDepth || "",
        audioChannels: s.audio?.channels || "",
        audioFileSizeBytes: s.audio?.fileSizeBytes || 0,
        audioUploadedAt: iso(s.audio?.uploadedAt),
        timeSpentMs: s.timeSpentMs || 0,
        createdAt: iso(s.createdAt),
        updatedAt: iso(s.updatedAt),
      };
    };

    const shapeRootProgress = (row) => {
      const t = row.today || {};
      const l = row.lifetime || {};
      return {
        username: row.username || "",
        name: row.name || "",
        email: row.email || "",
        phone: row.phone || "",
        isVerified: row.isVerified,
        identityFlagged: row.identityFlagged,
        today_assigned: t.assigned || 0,
        today_completed: t.completed || 0,
        today_discarded: t.discarded || 0,
        today_edited: t.edited || 0,
        today_validated: t.validated || 0,
        today_recorded: t.recorded || 0,
        today_audioSeconds: t.audioDurationSeconds || 0,
        today_progressPercent: t.progressPercent || 0,
        lifetime_assigned: l.assigned || 0,
        lifetime_completed: l.completed || 0,
        lifetime_discarded: l.discarded || 0,
        lifetime_edited: l.edited || 0,
        lifetime_validated: l.validated || 0,
        lifetime_recorded: l.recorded || 0,
        lifetime_audioSeconds: l.audioDurationSeconds || 0,
        lifetime_progressPercent: l.progressPercent || 0,
      };
    };

    const shapeUser = (u) => ({
      username: u.username || "",
      name: u.name || "",
      email: u.email || "",
      phone: u.phone || "",
      role: u.role || "",
      isVerified: u.isVerified,
      identityFlagged: u.identityFlagged,
      identityFlagReason: u.identityFlagReason || "",
      dedicatedProject: u.dedicatedProjectId
        ? projectById.get(String(u.dedicatedProjectId))?.name || String(u.dedicatedProjectId)
        : "",
      createdAt: iso(u.createdAt),
      deletedAt: iso(u.deletedAt),
    });

    const shapeProject = (p) => ({
      name: p.name || "",
      description: p.description || "",
      createdBy: p.createdBy?.email || p.createdBy?.name || "",
      assignees: (assigneesByProject.get(String(p._id)) || []).join("; "),
      taskCountInBackup: taskCountByProject.get(String(p._id)) || 0,
      createdAt: iso(p.createdAt),
    });

    const shapeTask = (t) => ({
      taskId: t.taskId || "",
      dialogueId: t.dialogueId || "",
      projectName: projectById.get(String(t.projectId))?.name || "",
      assignedTo: t.assignedTo ? userById.get(String(t.assignedTo))?.username || "" : "",
      chineseTranscript: t.chineseTranscript || "",
      pinyin: t.pinyin || "",
      createdAt: iso(t.createdAt),
    });

    // Group submissions by user; anything unresolvable goes to _orphaned.
    const byUser = new Map();
    const orphans = [];
    ds.submissions.forEach((s) => {
      const u = userById.get(String(s.userId));
      const t = taskById.get(String(s.taskId));
      const row = shapeSub(s);
      if (!u || !t) {
        orphans.push(row);
        return;
      }
      const k = String(s.userId);
      if (!byUser.has(k)) byUser.set(k, []);
      byUser.get(k).push({ row, submission: s, task: t });
    });

    // ── start streaming ──
    archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("warning", (err) => logger.warn(`backup archive warning: ${err.message}`));
    const archiveError = new Promise((_, reject) => archive.on("error", reject));

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="bolochinese-backup-${dateDir}.zip"`);
    archive.pipe(res);

    const P = (name) => `${dateDir}/${name}`;
    const failed = [];
    let audioFiles = 0;
    let audioBytes = 0;

    archive.append(csv(SUBMISSION_COLS, ds.submissions.map(shapeSub)), { name: P("submissions.csv") });

    for (const [userId, entries] of byUser) {
      const dir = dirFor(userId);
      archive.append(csv(SUBMISSION_COLS, entries.map((e) => e.row)), { name: P(`${dir}/submissions.csv`) });

      // eslint-disable-next-line no-await-in-loop
      const ledgerRows = await dao.getLedgerRowsForUser(userId);
      const live = liveByUser.get(String(userId)) || {};
      const progressRows = ledgerRows.map((r) => ({
        date: r.date,
        assigned: r.assigned,
        submitted: r.submitted,
        completed: r.completed,
        discarded: r.discarded,
        edited: r.edited,
        validated: r.validated,
        recorded: r.recorded,
        audioDurationSeconds: r.audioDurationSeconds,
        timeSpentMs: r.timeSpentMs,
        tasksDeleted: r.tasksDeleted,
        audioFilesDeleted: r.audioFilesDeleted,
      }));
      progressRows.push({
        date: "current (live, not yet wiped)",
        assigned: "",
        submitted: live.submitted || 0,
        completed: live.completed || 0,
        discarded: live.discarded || 0,
        edited: live.edited || 0,
        validated: live.validated || 0,
        recorded: live.recorded || 0,
        audioDurationSeconds: Math.round(live.audioDurationSeconds || 0),
        timeSpentMs: Math.round(live.timeSpentMs || 0),
        tasksDeleted: "",
        audioFilesDeleted: "",
      });
      archive.append(csv(USER_PROGRESS_COLS, progressRows), { name: P(`${dir}/progress.csv`) });

      for (const e of entries) {
        const url = e.submission.audio?.url;
        if (!url || !e.task.taskId) continue;
        try {
          // eslint-disable-next-line no-await-in-loop
          const buf = await fetchAudioBuffer(url);
          archive.append(buf, { name: P(`${dir}/audio/${e.task.taskId}.wav`) });
          audioFiles += 1;
          audioBytes += buf.length;
        } catch (err) {
          failed.push({ taskId: e.task.taskId, username: dir, audioUrl: url, error: err.message });
          logger.warn(`backup: audio download failed for ${e.task.taskId}: ${err.message}`);
        }
      }
    }

    if (orphans.length) {
      archive.append(csv(SUBMISSION_COLS, orphans), { name: P("_orphaned/submissions.csv") });
    }

    archive.append(csv(ROOT_PROGRESS_COLS, perUserProgress.map(shapeRootProgress)), { name: P("progress.csv") });
    archive.append(csv(USERS_COLS, ds.users.map(shapeUser)), { name: P("users.csv") });
    archive.append(csv(PROJECTS_COLS, ds.projects.map(shapeProject)), { name: P("projects.csv") });
    archive.append(csv(TASKS_COLS, ds.tasks.map(shapeTask)), { name: P("tasks.csv") });
    if (failed.length) {
      archive.append(csv(AUDIO_ERROR_COLS, failed), { name: P("audio_errors.csv") });
    }

    const stats = {
      users: ds.users.length,
      projects: ds.projects.length,
      finishedTasks: ds.finishedTaskIds.length,
      finishedSubmissions: ds.submissions.length,
      orphanedSubmissions: orphans.length,
      audioFiles,
      audioBytes,
      audioErrors: failed.length,
    };

    archive.append(README(dateDir), { name: P("README.txt") });
    archive.append(
      JSON.stringify(
        {
          backupDate: dateDir,
          timezone: KOLKATA_TZ,
          generatedAt: iso(startedAt),
          cutoff: iso(cutoff),
          schemaVersion: 1,
          counts: stats,
          hadAudioErrors: failed.length > 0,
        },
        null,
        2
      ),
      { name: P("manifest.json") }
    );

    const delivered = new Promise((resolve, reject) => {
      res.on("finish", resolve);
      res.on("close", () => {
        if (!res.writableFinished) reject(new Error("client disconnected before the download finished"));
      });
    });
    archive.finalize();
    await Promise.race([delivered, archiveError]);

    await dao.setBackupCompleted({ cutoff, stats, hadErrors: failed.length > 0 });
    logger.info(
      `Backup delivered | ${dateDir} | ${stats.finishedTasks} tasks, ${stats.finishedSubmissions} submissions, ` +
        `${audioFiles} audio (${failed.length} failed)`
    );
  } catch (err) {
    if (archive) {
      try {
        archive.abort();
      } catch {
        /* already torn down */
      }
    }
    if (!res.headersSent) {
      err.statusCode = err.statusCode || 500;
      throw err;
    }
    logger.error(`Backup stream failed after headers sent: ${err.message}`);
    if (!res.writableEnded) res.end();
  } finally {
    lock.release();
  }
};

const fetchAudioBuffer = async (url) => {
  const stream = await getAudioStream(url);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
};

module.exports = { runBackup };
