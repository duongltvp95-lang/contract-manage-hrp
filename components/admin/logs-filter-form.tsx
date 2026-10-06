"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  type AuditAction,
  type LogsFilter,
} from "@schemas/audit-log";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Filter form for /admin/logs.
 *
 * The form turns the inputs into a URL query string and pushes the new URL —
 * a Server Component re-renders with the new filter, no client-side data
 * fetching. The page is the source of truth, the form is just the input.
 *
 * The form is `key`-ed on the current filter so a back/forward navigation
 * resets the fields to the new URL values, with no `useEffect`/`setState`
 * pair (which the linter correctly flags as a cascading-render hazard).
 */
export function LogsFilterForm({ initial }: { initial: LogsFilter }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [action, setAction] = useState<string>(initial.action ?? "");
  const [from, setFrom] = useState<string>(initial.from ?? "");
  const [to, setTo] = useState<string>(initial.to ?? "");

  // `key` makes the form remount when the URL changes (browser back/forward,
  // or a fresh navigation). The local state is initialised from `initial`
  // each time. `searchParams` is read here so this component re-renders on
  // URL changes; without it the key would be a stale value.
  const formKey = searchParams.toString();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams();
    if (action) next.set("action", action);
    if (from) next.set("from", from);
    if (to) next.set("to", to);
    next.set("page", "1");
    next.set("pageSize", String(initial.pageSize));
    const query = next.toString();
    router.push(`/admin/logs${query ? `?${query}` : ""}`);
  }

  function onReset() {
    setAction("");
    setFrom("");
    setTo("");
    router.push("/admin/logs");
  }

  return (
    <form
      key={formKey}
      onSubmit={onSubmit}
      className="flex flex-wrap items-end gap-3"
      data-testid="logs-filter-form"
    >
      <div className="space-y-1">
        <Label htmlFor="logs-action">Hành động</Label>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger id="logs-action" className="w-[200px]" data-testid="logs-filter-action">
            <SelectValue placeholder="Tất cả" />
          </SelectTrigger>
          <SelectContent>
            {AUDIT_ACTIONS.map((value: AuditAction) => (
              <SelectItem key={value} value={value}>
                {AUDIT_ACTION_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="logs-from">Từ</Label>
        <Input
          id="logs-from"
          type="datetime-local"
          value={from ? toLocalInput(from) : ""}
          onChange={(event) => setFrom(fromToIso(event.target.value))}
          className="w-[200px]"
          data-testid="logs-filter-from"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="logs-to">Đến</Label>
        <Input
          id="logs-to"
          type="datetime-local"
          value={to ? toLocalInput(to) : ""}
          onChange={(event) => setTo(fromToIso(event.target.value))}
          className="w-[200px]"
          data-testid="logs-filter-to"
        />
      </div>

      <Button type="submit" data-testid="logs-filter-apply">
        Áp dụng
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={onReset}
        data-testid="logs-filter-reset"
      >
        Đặt lại
      </Button>
    </form>
  );
}

/** `<input type="datetime-local">` wants `YYYY-MM-DDTHH:mm` (local, no Z). */
function toLocalInput(value: string): string {
  if (!value) return "";
  // Accept either `YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DDTHH:mm`.
  const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  return match ? match[1] : value;
}

function fromToIso(value: string): string {
  if (!value) return "";
  // The browser sends a local timestamp with no offset. Treat it as UTC for
  // filter purposes; the search is "created_at >= value" so a few hours of
  // skew at the boundary is acceptable and the page can document the rule.
  return value.length === 16 ? `${value}:00Z` : value;
}
