import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { readMfaState } from "@/lib/mfa";
import { MfaForm } from "@/components/mfa-form";

async function MfaContent() {
  await requireUser();
  const state = await readMfaState();
  return state.ok ? <MfaForm initialState={state.data} />
    : <p role="alert" className="p-8 text-destructive">{state.message}</p>;
}

export default function MfaPage() {
  return <Suspense fallback={<p className="p-8">Đang kiểm tra bảo mật...</p>}><MfaContent /></Suspense>;
}
