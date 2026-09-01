// Shared status badge for a TaskSubmission's `status`, used on both the
// project task grid and the task detail page.
export default function StatusBadge({ status }) {
  if (status === "completed") return <span className="badge-done">Completed</span>;
  if (status === "erroneous") return <span className="badge-danger">Erroneous</span>;
  if (status === "requires-review") return <span className="badge-danger">Requires Review</span>;
  if (status === "skipped") return <span className="badge-pending">Skipped</span>;
  if (status === "corrected") return <span className="badge-progress">Corrected</span>;
  if (status === "verified") return <span className="badge-progress">Verified</span>;
  if (status === "recorded") return <span className="badge-progress">Recorded</span>;
  if (status === "in-progress") return <span className="badge-progress">In Progress</span>;
  return <span className="badge-pending">Pending</span>;
}
