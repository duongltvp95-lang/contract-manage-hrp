"use client";

import { format, parse } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Calendar-in-Popover bound to a `YYYY-MM-DD` string (plan sections 19, 45).
 *
 * Shared by the Add Contract form and the contracts list filters. Display uses
 * `dd/MM/yyyy` via date-fns; the stored value stays `YYYY-MM-DD`.
 */
export function DateField({
  id,
  value,
  onChange,
  placeholder = "Chọn ngày",
  disabled,
  className,
}: {
  id?: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const selected = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {selected ? format(selected, "dd/MM/yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => onChange(date ? format(date, "yyyy-MM-dd") : undefined)}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
