"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { updateProfileAction } from "@/app/(app)/settings/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { ACCENT_PRESETS } from "@/lib/theme-accents";

/**
 * Accent color picker — round 12, part 2.
 *
 * Renders one swatch per preset. The currently-active swatch (the profile's
 * `accent_color`, or the blue default when null) shows a check. Clicking a
 * swatch updates the profile; clicking the ACTIVE swatch again sends `null` to
 * return to the default. After a successful save the page refreshes, which
 * re-reads `data-accent` on <html> server-side.
 */
export function AccentPicker({ currentAccent }: { currentAccent: string | null }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeKey = currentAccent ?? "blue";

  async function pick(key: string) {
    setSaving(true);
    setError(null);

    const next = key === activeKey ? null : key;
    const result = await updateProfileAction({ accentColor: next });

    setSaving(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    toast.success("Đã đổi màu giao diện");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
        {Object.values(ACCENT_PRESETS).map((preset) => {
          const isActive = preset.key === activeKey;
          return (
            <button
              key={preset.key}
              type="button"
              disabled={saving}
              onClick={() => pick(preset.key)}
              data-testid={`accent-swatch-${preset.key}`}
              data-accent-active={isActive ? "true" : undefined}
              aria-pressed={isActive}
              className={cn(
                "flex flex-col items-center gap-2 rounded-md p-2 text-center transition-all disabled:opacity-50",
                isActive && "bg-accent ring-2 ring-ring ring-offset-2",
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full border border-border",
                  isActive && "border-primary",
                )}
                style={{ backgroundColor: `hsl(${preset.light.primary})` }}
              >
                {isActive && (
                  <Check
                    className="h-5 w-5 text-white"
                    data-testid="accent-swatch-active"
                  />
                )}
              </span>
              <span className="text-xs">{preset.label}</span>
            </button>
          );
        })}
      </div>

      {activeKey !== "blue" && (
        <p className="text-xs text-muted-foreground">
          Bấm lại ô đang chọn để quay về màu mặc định.
        </p>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Không đổi được màu giao diện</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
