import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The shared empty state — plan section 82, W1-WEB-037.
 *
 * One component for every "there is nothing here yet" case (contracts, search
 * results, dashboard lists, attached documents) so they cannot drift apart.
 *
 * Takes `icon` as a node rather than a component type: a component reference
 * cannot cross the Server/Client Component boundary, a rendered element can, so
 * this stays usable from both without a "use client" that would force the whole
 * subtree client-side.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-md border border-dashed p-8 text-center",
        className,
      )}
      data-testid="empty-state"
    >
      <div className="text-muted-foreground" aria-hidden="true">
        {icon ?? <Inbox className="h-8 w-8" />}
      </div>

      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>

      {action}
    </div>
  );
}
