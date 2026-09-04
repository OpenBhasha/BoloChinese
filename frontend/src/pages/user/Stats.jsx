import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  ClipboardList,
  CheckCircle2,
  Pencil,
  AlertTriangle,
  Clock3,
  Percent,
  BadgeCheck,
  Trash2,
  Mic,
  Timer,
} from "lucide-react";
import UserLayout from "../../components/layout/UserLayout";
import StatCard from "../../components/ui/StatCard";
import { PageSpinner } from "../../components/ui/Spinner";
import { formatDuration } from "../../utils/format";
import { getMyStats } from "../../api/user.api";

export default function UserStats() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMyStats()
      .then((r) => setStats(r.data.data))
      .catch(() => toast.error("Failed to load your stats"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <UserLayout>
      <h1 className="text-xl sm:text-2xl font-bold text-primary-900 mb-1">My Stats</h1>
      <p className="text-primary-400 text-sm mb-6 sm:mb-8">
        Your progress across every assigned project
      </p>

      {loading ? <PageSpinner /> : (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
          <StatCard label="Assigned" value={stats?.assigned ?? 0} icon={ClipboardList} color="primary" />
          <StatCard label="Validated" value={stats?.validated ?? 0} icon={BadgeCheck} color="emerald" />
          <StatCard label="Edited" value={stats?.edited ?? 0} icon={Pencil} color="blue" />
          <StatCard label="Discarded" value={stats?.discarded ?? 0} icon={Trash2} color="red" />
          <StatCard label="Recorded" value={stats?.recorded ?? 0} icon={Mic} color="emerald" />
          <StatCard label="Completed" value={stats?.completed ?? 0} icon={CheckCircle2} color="emerald" />
          <StatCard label="Erroneous" value={stats?.erroneous ?? 0} icon={AlertTriangle} color="red" />
          <StatCard label="Pending" value={stats?.pending ?? 0} icon={Clock3} color="amber" />
          <StatCard label="Audio Duration" value={formatDuration(stats?.audioDurationSeconds)} icon={Timer} color="primary" />
          <StatCard label="Progress" value={`${stats?.progressPercent ?? 0}%`} icon={Percent} color="primary" />
        </div>
      )}
    </UserLayout>
  );
}
