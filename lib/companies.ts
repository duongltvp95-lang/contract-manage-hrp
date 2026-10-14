/**
 * Constants and helpers for internal companies (HRP & HR VN).
 * Centralizes IDs and naming so components, hooks, and services do not hardcode UUIDs.
 */

export const HRP_COMPANY_ID = "00000000-0000-4000-8000-000000000001";
export const HR_VN_COMPANY_ID = "00000000-0000-4000-8000-000000000002";

export const INTERNAL_COMPANY_IDS = [HRP_COMPANY_ID, HR_VN_COMPANY_ID] as const;

export const INTERNAL_COMPANY_NAMES: Record<string, string> = {
  [HRP_COMPANY_ID]: "HRP",
  [HR_VN_COMPANY_ID]: "HR VN",
};

export function isInternalCompanyId(id?: string | null): boolean {
  if (!id) return false;
  return id === HRP_COMPANY_ID || id === HR_VN_COMPANY_ID;
}

export function getInternalCompanyName(id?: string | null): string | undefined {
  if (!id) return undefined;
  return INTERNAL_COMPANY_NAMES[id];
}
