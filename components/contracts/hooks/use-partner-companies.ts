"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { partnerCompanyRowsAction } from "@/app/(app)/partners/actions";
import type { Company } from "@/lib/services/partners";

/**
 * Custom hook to fetch and synchronize linked companies for the selected partner.
 */
export function usePartnerCompanies({
  partnerId,
  defaultCompanyId,
  defaultCompanyName,
  currentCompanyId,
  onResetCompany,
  extraCompany,
}: {
  partnerId?: string;
  isEdit: boolean;
  defaultCompanyId?: string | null;
  defaultCompanyName?: string | null;
  currentCompanyId?: string;
  onResetCompany?: () => void;
  extraCompany?: { id: string; name: string } | null;
}) {
  const [partnerCompanies, setPartnerCompanies] = useState<Company[]>([]);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const [companiesRetry, setCompaniesRetry] = useState(0);
  const [rowsPartnerId, setRowsPartnerId] = useState<string | null>(null);

  const onResetCompanyRef = useRef(onResetCompany);
  const currentCompanyIdRef = useRef(currentCompanyId);
  const extraCompanyRef = useRef(extraCompany);
  const defaultCompanyIdRef = useRef(defaultCompanyId);

  useEffect(() => {
    onResetCompanyRef.current = onResetCompany;
    currentCompanyIdRef.current = currentCompanyId;
    extraCompanyRef.current = extraCompany;
    defaultCompanyIdRef.current = defaultCompanyId;
  });

  // Đang tải khi đối tác đổi nhưng dữ liệu của đối tác mới chưa nạp xong
  const companiesLoading = Boolean(partnerId) && rowsPartnerId !== partnerId;

  useEffect(() => {
    if (!partnerId) {
      return;
    }

    let active = true;
    partnerCompanyRowsAction(partnerId)
      .then((result) => {
        if (!active) return;
        setRowsPartnerId(partnerId);

        if (!result.ok) {
          setPartnerCompanies([]);
          setCompaniesError(result.message || "Không tải được danh sách công ty");
          return;
        }

        setCompaniesError(null);
        const next = result.data;
        setPartnerCompanies(next);

        const targetCompanyId =
          extraCompanyRef.current?.id || defaultCompanyIdRef.current;

        const currentId = currentCompanyIdRef.current;
        const isInternalCompany =
          currentId === "00000000-0000-4000-8000-000000000001" ||
          currentId === "00000000-0000-4000-8000-000000000002";

        // Chỉ reset về "" nếu công ty đang chọn KHÔNG thuộc next, KHÔNG phải targetCompany, VÀ KHÔNG phải công ty nội bộ
        if (
          currentId &&
          !isInternalCompany &&
          !next.some((row) => row.id === currentId) &&
          targetCompanyId !== currentId
        ) {
          const resetFn = onResetCompanyRef.current;
          if (resetFn) resetFn();
        }
      })
      .catch(() => {
        if (!active) return;
        setRowsPartnerId(partnerId);
        setPartnerCompanies([]);
        setCompaniesError("Không tải được danh sách công ty. Vui lòng thử lại.");
      });

    return () => {
      active = false;
    };
  }, [partnerId, companiesRetry]);

  const companyRows = useMemo(() => {
    const targetCompany =
      extraCompany ||
      (defaultCompanyId
        ? { id: defaultCompanyId, name: defaultCompanyName ?? "" }
        : null);

    if (!partnerId) {
      if (extraCompany) return [extraCompany];
      if (defaultCompanyId) {
        return [{ id: defaultCompanyId, name: defaultCompanyName ?? "" }];
      }
      return [];
    }

    let next = [...partnerCompanies];

    if (targetCompany && targetCompany.id) {
      const stillPresent = next.some((row) => row.id === targetCompany.id);
      if (!stillPresent) {
        next = [...next, targetCompany];
      }
    }

    const currentId = currentCompanyId;
    const isInternalCompany =
      currentId === "00000000-0000-4000-8000-000000000001" ||
      currentId === "00000000-0000-4000-8000-000000000002";

    if (currentId && isInternalCompany) {
      const internalName =
        currentId === "00000000-0000-4000-8000-000000000002"
          ? "HR VN"
          : "HRP";
      if (!next.some((row) => row.id === currentId)) {
        next = [...next, { id: currentId, name: internalName }];
      }
    }

    return next;
  }, [
    partnerId,
    partnerCompanies,
    extraCompany,
    defaultCompanyId,
    defaultCompanyName,
    currentCompanyId,
  ]);

  const retryCompanies = () => {
    setCompaniesError(null);
    setCompaniesRetry((n) => n + 1);
  };

  return {
    companyRows,
    companiesError,
    companiesLoading,
    retryCompanies,
  };
}
