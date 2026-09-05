import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { CheckCircle2, ChevronLeft, ExternalLink, Lock, Pencil, ShieldCheck, User2 } from "lucide-react";
import UserLayout from "../../components/layout/UserLayout";
import AdminLayout from "../../components/layout/AdminLayout";
import { PageSpinner } from "../../components/ui/Spinner";
import { useAuth } from "../../context/AuthContext";
import { getMyProfile, updateMyProfile } from "../../api/user.api";
import { getUserProfileAsAdmin, updateUser as adminUpdateUser } from "../../api/admin.api";

const formatDuration = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  if (mins < 60) return `${mins}m ${rem}s`;
  const hrs = Math.floor(mins / 60);
  const rMin = mins % 60;
  return `${hrs}h ${rMin}m`;
};

/**
 * Shared profile page. Rendered at two routes:
 *   /user/profile           → annotator viewing themselves (self-edit allowed)
 *   /admin/users/:id/profile→ admin viewing an annotator (full edit + badge)
 * The component figures out which mode from the auth context and route.
 */
export default function UserProfile() {
  const { user: currentUser } = useAuth();
  const { id: routeUserId } = useParams(); // present only on admin route
  const isAdminView = Boolean(routeUserId) && currentUser?.role === "admin";
  const Layout = isAdminView ? AdminLayout : UserLayout;

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: "", email: "", phone: "" });
  const [saving, setSaving] = useState(false);

  const loadProfile = () => {
    setLoading(true);
    const req = isAdminView ? getUserProfileAsAdmin(routeUserId) : getMyProfile();
    req
      .then((r) => {
        setProfile(r.data.data);
        setDraft({
          name: r.data.data.user.name || "",
          email: r.data.data.user.email || "",
          phone: r.data.data.user.phone || "",
        });
      })
      .catch((err) => toast.error(err.response?.data?.message || "Failed to load profile"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeUserId]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const patch = {
        name: draft.name.trim(),
        email: draft.email.trim(),
        phone: draft.phone.trim(),
      };
      const req = isAdminView ? adminUpdateUser(routeUserId, patch) : updateMyProfile(patch);
      await req;
      toast.success("Profile updated.");
      setEditing(false);
      loadProfile();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const totalPending = useMemo(() => {
    if (!profile?.projects) return 0;
    return profile.projects.reduce((sum, p) => sum + (p.stats?.pending || 0), 0);
  }, [profile]);

  if (loading) return <Layout><PageSpinner /></Layout>;
  if (!profile) return <Layout><p className="text-primary-500">Profile not found.</p></Layout>;

  const { user, projects = [], analytics = {} } = profile;

  return (
    <Layout>
      {isAdminView && (
        <div className="flex items-center gap-2 mb-4">
          <Link
            to="/admin/users"
            className="inline-flex items-center gap-1 text-sm text-black/70 hover:text-black"
          >
            <ChevronLeft size={16} /> Back to Users
          </Link>
          <span className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            <ShieldCheck size={12} /> Viewing as admin
          </span>
        </div>
      )}
      {!isAdminView && (
        <div className="flex items-center gap-2 mb-4">
          <span className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <User2 size={12} /> Viewing as annotator
          </span>
        </div>
      )}

      <div className="card mb-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-bold text-primary-900 mb-1">Profile</h1>
            <p className="text-primary-500 text-sm">
              {isAdminView ? "Full access - edit name, email, phone." : "Update your name, email, or phone."}
            </p>
          </div>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="btn-secondary text-xs inline-flex items-center gap-1.5"
            >
              <Pencil size={13} /> Edit
            </button>
          )}
        </div>

        {editing ? (
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <label className="label">Name</label>
              <input
                className="input"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                minLength={2}
                required
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={draft.email}
                onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="label">Phone</label>
              <input
                className="input"
                value={draft.phone}
                onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                placeholder="+1 555 123 4567"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setEditing(false); loadProfile(); }}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-black/50 mb-0.5">Name</dt>
              <dd className="text-black">{user.name || "-"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-black/50 mb-0.5 inline-flex items-center gap-1">
                Username <Lock size={11} className="text-black/40" title="Locked - assigned at registration" />
              </dt>
              <dd className="font-mono text-black/80">{user.username || "-"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-black/50 mb-0.5">Email</dt>
              <dd className="text-black">{user.email || "-"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-black/50 mb-0.5">Phone</dt>
              <dd className="text-black">{user.phone || "-"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-black/50 mb-0.5">Role</dt>
              <dd className="text-black capitalize">{user.role}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-black/50 mb-0.5">Status</dt>
              <dd className={user.isVerified ? "text-emerald-700 inline-flex items-center gap-1" : "text-amber-700"}>
                {user.isVerified && <CheckCircle2 size={14} />}
                {user.isVerified ? "Verified" : "Pending verification"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-black/50 mb-0.5">Joined</dt>
              <dd className="text-black/80">{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "-"}</dd>
            </div>
          </dl>
        )}
      </div>

      {/* Analytics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Completed", value: analytics.completed || 0 },
          { label: "In progress", value: analytics.inProgress || 0 },
          { label: "Discarded", value: analytics.discarded || 0 },
          { label: "Pending", value: totalPending },
          { label: "Audio clips", value: analytics.audio?.count || 0 },
          { label: "Audio duration", value: formatDuration(analytics.audio?.totalSeconds) },
          { label: "Chars edited", value: analytics.totalEditChars || 0 },
          { label: "Total submissions", value: analytics.totalSubmissions || 0 },
        ].map((s) => (
          <div key={s.label} className="card">
            <p className="text-xs uppercase tracking-wide text-black/50 mb-1">{s.label}</p>
            <p className="text-lg font-bold text-primary-900">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Projects */}
      <div className="card">
        <h2 className="text-sm font-semibold text-primary-900 mb-3">Projects assigned</h2>
        {projects.length === 0 ? (
          <p className="text-primary-500 text-sm">
            No projects assigned yet.
            {isAdminView && " Use the Users tab on a project to assign this user."}
          </p>
        ) : (
          <ul className="divide-y divide-primary-50">
            {projects.map((p) => {
              const stats = p.stats || {};
              const total = stats.total || 0;
              const done = (stats.completed || 0) + (stats.erroneous || 0);
              const pct = total ? Math.round((done / total) * 100) : 0;
              return (
                <li key={p._id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    {isAdminView ? (
                      <Link
                        to={`/admin/projects/${p._id}`}
                        className="text-sm font-medium text-primary-800 hover:text-primary-900 inline-flex items-center gap-1.5"
                      >
                        {p.name} <ExternalLink size={12} />
                      </Link>
                    ) : (
                      <p className="text-sm font-medium text-primary-900">{p.name}</p>
                    )}
                    <div className="mt-1 w-64 max-w-full h-1.5 rounded-full bg-black/10 overflow-hidden">
                      <div className="h-full bg-primary-700" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="text-right text-xs text-black/70 shrink-0">
                    <div>{done}/{total} done</div>
                    <div className="text-black/50">{stats.pending || 0} pending</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Layout>
  );
}
