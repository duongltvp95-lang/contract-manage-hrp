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
  { card: string; iconWrap: string; icon: string }
> = {
  default: {
    card: "bg-blue-50 dark:bg-blue-950/40",
    iconWrap: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400",
    icon: "text-blue-600 dark:text-blue-400",
  },
  warning: {
    card: "bg-amber-50 dark:bg-amber-950/40",
    iconWrap: "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400",
    icon: "text-amber-600 dark:text-amber-400",
  },
  danger: {
    card: "bg-rose-50 dark:bg-rose-950/40",
    iconWrap: "bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400",
    icon: "text-rose-600 dark:text-rose-400",
  },
};

export function MetricCard({
  title,
  value,
  hint,
  icon,
  tone = "default",
  testId,
}: {
  title: string;
  value: number | string;
  hint?: string;
  icon?: ReactNode;
  tone?: Tone;
  testId?: string;
}) {
  const styles = TONE_STYLES[tone];

  return (
    <Card data-testid={testId} className={cn("border-0", styles.card)}>
      <CardContent className="flex items-center gap-4 p-6">
        <span
          aria-hidden="true"
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
            styles.iconWrap,
          )}
        >
          {icon}
        </span>

        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
            {title}
          </p>
          <div className="text-4xl font-extrabold tabular-nums text-gray-800 dark:text-gray-100">
            {value}
          </div>
          {hint ? (
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
