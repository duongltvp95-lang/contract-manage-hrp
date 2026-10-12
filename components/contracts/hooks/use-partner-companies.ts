"use client";

import { useEffect, useRef, useState } from "react";
import { partnerCompanyRowsAction } from "@/app/(app)/partners/actions";
import type { Company } from "@/lib/services/partners";

/**
 * Custom hook to fetch and synchronize linked companies for the selected partner.
 */
export function usePartnerCompanies({
  partnerId,
  isEdit,
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
  const [companyRows, setCompanyRows] = useState<Company[]>(() => {
    if (extraCompany) return [extraCompany];
    if (defaultCompanyId) return [{ id: defaultCompanyId, name: defaultCompanyName ?? "" }];
    return [];
  });
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const [companiesRetry, setCompaniesRetry] = useState(0);
  const [rowsPartnerId, setRowsPartnerId] = useState<string | null>(null);

  const onResetCompanyRef = useRef(onResetCompany);
  const currentCompanyIdRef = useRef(currentCompanyId);

  useEffect(() => {
    onResetCompanyRef.current = onResetCompany;
    currentCompanyIdRef.current = currentCompanyId;
  });

  // Đang tải khi đối tác đổi nhưng dữ liệu của đối tác mới chưa nạp xong
  const companiesLoading = Boolean(partnerId) && rowsPartnerId !== partnerId;

  useEffect(() => {
    // Chưa chọn đối tác → nếu có extraCompany hoặc defaultCompany, vẫn giữ trong options
    if (!partnerId) {
      if (extraCompany) {
        setCompanyRows([extraCompany]);
      } else if (defaultCompanyId) {
        setCompanyRows([{ id: defaultCompanyId, name: defaultCompanyName ?? "" }]);
      } else {
        setCompanyRows([]);
      }
      return;
    }

    let active = true;
    partnerCompanyRowsAction(partnerId)
      .then((result) => {
        if (!active) return;
        setRowsPartnerId(partnerId);

        if (!result.ok) {
          setCompanyRows(extraCompany ? [extraCompany] : []);
          setCompaniesError(result.message || "Không tải được danh sách công ty");
          return;
        }
        setCompaniesError(null);
        let next = result.data;

        // Đảm bảo nếu có defaultCompanyId hoặc extraCompany, luôn có mặt trong options
        const targetCompany =
          extraCompany ||
          (defaultCompanyId
            ? { id: defaultCompanyId, name: defaultCompanyName ?? "" }
            : null);

        if (targetCompany && targetCompany.id) {
          const stillPresent = next.some((row) => row.id === targetCompany.id);
          if (!stillPresent) {
            next = [...next, targetCompany];
          }
        }

        setCompanyRows(next);

        // Chỉ reset về "" nếu công ty đang chọn KHÔNG thuộc next VÀ KHÔNG phải extraCompany / defaultCompany
        if (
          currentCompanyIdRef.current &&
          !next.some((row) => row.id === currentCompanyIdRef.current) &&
          (!targetCompany || targetCompany.id !== currentCompanyIdRef.current)
        ) {
          onResetCompanyRef.current?.();
        }
      })
      .catch(() => {
        if (!active) return;
        setRowsPartnerId(partnerId);
        setCompanyRows(extraCompany ? [extraCompany] : []);
        setCompaniesError("Không tải được danh sách công ty. Vui lòng thử lại.");
      });

    return () => {
      active = false;
    };
  }, [
    partnerId,
    companiesRetry,
    isEdit,
    defaultCompanyId,
    defaultCompanyName,
    extraCompany?.id,
    extraCompany?.name,
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
