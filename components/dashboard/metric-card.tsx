import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Dashboard metric card — plan sections 67, 68, 79.
 *
 * Deliberately plain: Wave 1 uses no charting library (plan section 67), so a
 * number, a label and a short hint are the whole component.
 */
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
  tone?: "default" | "warning" | "danger";
  testId?: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <span
          aria-hidden="true"
          className={cn(
            "text-muted-foreground",
            tone === "warning" && "text-amber-600 dark:text-amber-500",
            tone === "danger" && "text-destructive",
          )}
        >
          {icon}
        </span>
      </CardHeader>

      <CardContent>
        <div
          className={cn(
            "text-3xl font-bold tabular-nums",
            tone === "danger" && "text-destructive",
          )}
        >
          {value}
        </div>
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
