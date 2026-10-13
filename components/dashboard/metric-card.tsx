import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Dashboard metric card — plan sections 67, 68, 79; round 17 refresh.
 *
 * A pastel card with a large coloured icon beside the number. The tone selects
 * the pastel background and the icon colour; the number itself stays a neutral
 * `text-gray-800`.
 */

type Tone = "default" | "warning" | "danger";

const TONE_STYLES: Record<
  Tone,
  { card: string; iconWrap: string; badge: string }
> = {
  default: {
    card: "border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.08] via-card to-teal-500/[0.03] dark:from-emerald-950/40 dark:via-card dark:to-teal-950/20 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-2xl",
    iconWrap: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 ring-1 ring-emerald-500/25",
    badge: "text-emerald-700 bg-emerald-100/80 dark:text-emerald-300 dark:bg-emerald-950/60 border border-emerald-500/20",
  },
  warning: {
    card: "border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.08] via-card to-orange-500/[0.03] dark:from-amber-950/40 dark:via-card dark:to-orange-950/20 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-2xl",
    iconWrap: "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 ring-1 ring-amber-500/25",
    badge: "text-amber-700 bg-amber-100/80 dark:text-amber-300 dark:bg-amber-950/60 border border-amber-500/20",
  },
  danger: {
    card: "border border-rose-500/20 bg-gradient-to-br from-rose-500/[0.08] via-card to-red-500/[0.03] dark:from-rose-950/40 dark:via-card dark:to-red-950/20 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 rounded-2xl",
    iconWrap: "bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 ring-1 ring-rose-500/25",
    badge: "text-rose-700 bg-rose-100/80 dark:text-rose-300 dark:bg-rose-950/60 border border-rose-500/20",
  },
};

export function MetricCard({
  title,
  value,
  hint,
  icon,
  tone = "default",
  testId,
  badgeText,
}: {
  title: string;
  value: number | string;
  hint?: string;
  icon?: ReactNode;
  tone?: Tone;
  testId?: string;
  badgeText?: string;
}) {
  const styles = TONE_STYLES[tone];

  return (
    <Card data-testid={testId} className={cn("relative overflow-hidden group", styles.card)}>
      <CardContent className="flex items-center gap-4 p-5 sm:p-6">
        <span
          aria-hidden="true"
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl shadow-2xs transition-transform duration-300 group-hover:scale-105",
            styles.iconWrap,
          )}
        >
          {icon}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {title}
            </p>
            {badgeText && (
              <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0", styles.badge)}>
                {badgeText}
              </span>
            )}
          </div>
          <div className="text-3xl sm:text-4xl font-extrabold tabular-nums tracking-tight text-foreground mt-0.5">
            {value}
          </div>
          {hint ? (
            <p className="mt-1 text-xs text-muted-foreground truncate">{hint}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
