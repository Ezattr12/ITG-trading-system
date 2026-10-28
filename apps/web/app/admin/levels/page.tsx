import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

import { listAdminLevels } from "@/lib/admin/queries";
import { LevelForm } from "@/components/admin/admin-forms";

export const metadata = { title: "Admin — Levels — ITG TraderOS" };

/**
 * Admin level management (Phase 10). Bronze / Silver / Gold /
 * Platinum score thresholds are editable here; the scoring
 * weights themselves live in each level's `scoring_config`
 * (migration 0008) and are read at calculation time. Every
 * threshold change is audit-logged.
 */
export default async function AdminLevelsPage() {
  const user = await getCurrentUser();
  const configured = isSupabaseConfigured();
  const levels = configured ? await listAdminLevels(await createServerSupabaseClient()) : [];

  return (
    <>
        <h1 className="page-title">Levels</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Score thresholds for Bronze, Silver, Gold and Platinum. Levels are multi-dimensional —
          never profit-only — and the weights are stored per level in the database.
        </p>
        {levels.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            {configured ? "No levels configured yet." : "Supabase is not connected yet, so no levels are listed."}
          </p>
        ) : (
          <ul className="mt-6 space-y-4">
            {levels.map((level) => (
              <li key={level.id} className="list-row-premium card-surface p-4 sm:p-5">
                <p className="font-medium">
                  <span className={level.name === "Platinum" ? "text-gradient-gold" : ""}>{level.name}</span>
                  {" · score "}
                  <span className="tnum">
                    {level.min_score}
                    {level.max_score === null ? "+" : `–${level.max_score}`}
                  </span>
                </p>
                {level.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">{level.description}</p>
                ) : null}
                <div className="mt-4 max-w-md">
                  <LevelForm level={level} />
                </div>
              </li>
            ))}
          </ul>
        )}
    </>
  );
}
