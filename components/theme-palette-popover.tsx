"use client";

import { Check, Palette } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { updateProfileAction } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ACCENT_PRESETS } from "@/lib/theme-accents";
import { BACKGROUND_PRESETS } from "@/lib/theme-backgrounds";
import { cn } from "@/lib/utils";

/**
 * Theme palette — round 13, part 2.
 *
 * A compact popover pinned to the sidebar footer (next to the light/dark
 * switcher), so the color is reachable from any page. It replaces the round-12
 * Settings card.
 *
 * Two groups: "Màu chủ đạo" (accent) and "Màu nền" (background). Clicking a
 * swatch updates the profile; clicking the ACTIVE swatch again sends `null` to
 * return to the default. After a save the page refreshes so <html data-accent /
 * data-background> re-render server-side, and the sidebar state is updated via
 * `onChanged` (the sidebar does not re-fetch on `router.refresh()`).
 */

type SwatchProps = {
  testid: string;
  activeTestid: string;
  isActive: boolean;
  color: string;
  label: string;
  checkClass: string;
  disabled: boolean;
  onClick: () => void;
};

function Swatch({
  testid,
  activeTestid,
  isActive,
  color,
  label,
  checkClass,
  disabled,
  onClick,
}: SwatchProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-testid={testid}
      aria-pressed={isActive}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-md p-1.5 text-center transition-all disabled:opacity-50",
        isActive && "bg-accent ring-2 ring-ring ring-offset-1",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full border border-border",
          isActive && "border-primary",
        )}
        style={{ backgroundColor: color }}
      >
        {isActive && (
          <Check className={cn("h-4 w-4", checkClass)} data-testid={activeTestid} />
        )}
      </span>
      <span className="text-[10px] leading-tight">{label}</span>
    </button>
  );
}

export function ThemePalettePopover({
  accent,
  background,
  onChanged,
}: {
  accent: string | null;
  background: string | null;
  onChanged: (next: { accent: string | null; background: string | null }) => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const activeAccent = accent ?? "blue";
  const activeBackground = background ?? "default";

  async function save(patch: Record<string, string | null>) {
    setSaving(true);
    const result = await updateProfileAction(patch);
    setSaving(false);

    if (!result.ok) {
      toast.error(result.message);
      return;
    }

    toast.success("Đã đổi màu giao diện");
    onChanged({
      accent: result.data.accentColor,
      background: result.data.backgroundColor,
    });
    router.refresh();
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Đổi màu giao diện"
          data-testid="theme-palette-button"
        >
          <Palette size={16} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-80"
        data-testid="theme-palette-popover"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Màu chủ đạo</p>
            <div className="grid grid-cols-6 gap-1">
              {Object.values(ACCENT_PRESETS).map((preset) => (
                <Swatch
                  key={`accent-${preset.key}`}
                  testid={`accent-swatch-${preset.key}`}
                  activeTestid="accent-swatch-active"
                  isActive={preset.key === activeAccent}
                  color={`hsl(${preset.light.primary})`}
                  label={preset.label}
                  checkClass="text-white"
                  disabled={saving}
                  onClick={() =>
                    save({ accentColor: preset.key === activeAccent ? null : preset.key })
                  }
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Màu nền</p>
            <div className="grid grid-cols-6 gap-1">
              {Object.values(BACKGROUND_PRESETS).map((preset) => (
                <Swatch
                  key={`bg-${preset.key}`}
                  testid={`background-swatch-${preset.key}`}
                  activeTestid="background-swatch-active"
                  isActive={preset.key === activeBackground}
                  color={`hsl(${preset.light.background})`}
                  label={preset.label}
                  checkClass="text-foreground"
                  disabled={saving}
                  onClick={() =>
                    save({
                      backgroundColor: preset.key === activeBackground ? null : preset.key,
                    })
                  }
                />
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Bấm lại ô đang chọn để quay về mặc định.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
