import { Skeleton } from "@/components/ui/skeleton";

/** Khung tải tức thì cho trang Cài đặt khi điều hướng từ menu. */
export default function SettingsLoading() {
  return (
    <div className="space-y-6 p-4 sm:p-6 md:p-8" data-testid="route-loading-skeleton">
      <div className="space-y-2">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Skeleton className="h-[360px] w-full rounded-xl" />
        </div>
        <div className="lg:col-span-5 flex flex-col gap-6">
          <Skeleton className="h-[160px] w-full rounded-xl" />
          <Skeleton className="h-[160px] w-full rounded-xl" />
        </div>
      </div>
      <Skeleton className="h-[280px] w-full rounded-xl" />
    </div>
  );
}
