# M7 — Edit + Archive + Dashboard + Settings + UX polish (Wave 1)

Task range: `W1-WEB-031` → `W1-WEB-038` (plan sections 65-71, 75-82, 94-95).
Master plan: [`docs/plan/wave1-plan-v1.1.md`](../plan/wave1-plan-v1.1.md).

## Reuse / Custom declaration (plan section 87)

```text
W1-WEB-031  Edit Contract

Reuse:
  ContractForm (M4) — same file, edit mode
  shadcn Sheet
  UpdateContractSchema (packages/schemas/contract.ts, M4)
  React Hook Form + Zod

Custom:
  mode prop, initial values, updateContract()

W1-WEB-032  Archive

Reuse:
  shadcn AlertDialog, DropdownMenu, Button

Custom:
  archiveContract(), ContractActionsMenu

W1-WEB-033  Dashboard

Reuse:
  shadcn Card / Table / Skeleton / Badge
  resolveExpiryPreset() (M5 contracts-query.ts) — the SAME expiry rule
  daysUntil() / formatExpiryHint() (lib/format.ts)

Custom:
  dashboard.ts, metric-card, recent-contracts, expiring-contracts

W1-WEB-034  Settings

Reuse:
  shadcn Form / Input / Card / Button
  React Hook Form + Zod
  existing LogoutButton (base repo)

Custom:
  profile-form, ProfileForm schema, updateProfile(), getOrganization()

W1-WEB-035..038  UX polish

Reuse:
  shadcn Skeleton / Progress / Alert / Sonner (newly added)
  EmptyState (new, shared by list + dashboard + document viewer)

Custom:
  dbError() — server-side logging, generic user-facing message
```

## 1. Files created / modified

| File | Change |
| --- | --- |
| `lib/services/contracts.ts` | **+** `updateContract()`, `archiveContract()`, `explainMissingContract()`; DB errors no longer leak |
| `lib/services/dashboard.ts` | **new** — `getContractMetrics()`, `getRecentContracts()`, `getExpiringContracts()`, `expiringWindowBounds()` |
| `lib/services/profiles.ts` | **new** — `updateProfile()` |
| `lib/services/organizations.ts` | **new** — `getOrganization()` |
| `lib/services/types.ts` | **+** `dbError()` |
| `lib/services/files.ts` | DB errors no longer leak |
| `lib/server-action.ts` | **new** — `authorized()`, `fromService()`, `validationFailure()`, `ActionResult` |
| `packages/schemas/profile.ts` | **new** — `UpdateProfileSchema` |
| `app/(app)/contracts/actions.ts` | **rewritten** — `updateContractAction`, `archiveContractAction`; shared guard |
| `app/(app)/settings/actions.ts` | **new** — `updateProfileAction` |
| `components/contracts/contract-form.tsx` | **rewritten** — one implementation for create + edit |
| `components/contracts/edit-contract-sheet.tsx` | **new** — Sheet wrapper |
| `components/contracts/archive-contract-dialog.tsx` | **new** — More menu + AlertDialog |
| `components/contracts/contract-detail.tsx` | **rewired** — real Edit / Archive, archived banner + badge |
| `components/contracts/contracts-table.tsx` | uses the shared `EmptyState` |
| `components/documents/document-viewer.tsx` | uses the shared `EmptyState` |
| `components/shared/empty-state.tsx` | **new** — one empty state for the whole app |
| `components/dashboard/metric-card.tsx` | **new** |
| `components/dashboard/recent-contracts.tsx` | **new** |
| `components/dashboard/expiring-contracts.tsx` | **new** |
| `components/settings/profile-form.tsx` | **new** |
| `components/app-sidebar.tsx` | shows the profile's `full_name` (email as fallback) |
| `lib/format.ts` | **+** `daysUntil()`, `formatExpiryHint()` |
| `app/(app)/dashboard/page.tsx` | **rewritten** — 3 cards, 2 lists, skeleton, no chart |
| `app/(app)/settings/page.tsx` | **rewritten** — Profile / Organization / Password / Logout |
| `app/(app)/contracts/[id]/page.tsx` | **restructured** — authorization before the Suspense boundary (see deviation 1) |
| `app/layout.tsx` | **+** `<Toaster />`; `lang="vi"` |
| `components/ui/alert-dialog.tsx`, `components/ui/sonner.tsx` | added via the shadcn CLI |

## 2. Verification

### 2a. Service layer + cross-organization — 28/28 PASS

Driven through the **real server actions** (temporary guarded route, deleted
afterwards), so the path under test is session → action → service → RLS:

```text
== updateContract (W1-WEB-031) ==
  PASS  update without a session is refused — 401 unauthenticated
  PASS  update with an impossible date is a validation failure (2026-02-30)
  PASS  validation issues name the field — expiryDate
  PASS  own-org update succeeds
  PASS  expiry_date persisted
  PASS  partner/notes persisted
  PASS  an emptied field is accepted
  PASS  an emptied field becomes NULL, not an empty string
  PASS  updating an unknown id reports not_found

== archiveContract (W1-WEB-032) ==
  PASS  own-org archive succeeds
  PASS  the row still exists (soft delete, no hard delete)
  PASS  archived_at is stamped
  PASS  archiving twice is refused with an explanation
  PASS  an archived contract cannot be edited
  PASS  the archived row was not modified

== cross-organization ==
  PASS  org B cannot update org A's contract      -> not_found
  PASS  org B cannot archive org A's contract     -> not_found
  PASS  org A's contract is byte-for-byte unchanged after B's attempts
  PASS  the refusal does not leak whether the contract exists
  PASS  RLS blocks the same UPDATE even at the REST layer (0 rows)
  PASS  the direct REST attempt changed nothing
  PASS  org B cannot even select org A's contract (0 rows)

================ 28 passed, 0 failed ================
```

Cross-organization is enforced twice: `organization_id` comes from the session
and is applied as an explicit filter, **and** RLS enforces the same rule. The
last three checks bypass the application entirely and talk to PostgREST with
org B's own token — the write still matches zero rows.

### 2b. Real browser (headless Chrome) — 42/42 PASS

```text
== W1-WEB-033 dashboard ==
  PASS  three metric cards render
  PASS  Tổng hợp đồng matches the database      ui=3 db=3
  PASS  Sắp hết hạn matches today..today+90     ui=1 db=1
  PASS  Đã hết hạn matches expiry_date < today  ui=0 db=0
  PASS  no chart is rendered
  PASS  both lists render

== create a contract through the UI ==
  PASS  created M7-UI-… -> /contracts/<uuid>
  PASS  dashboard Tổng +1
  PASS  dashboard Sắp hết hạn +1 (expiry 45 days out)

== W1-WEB-031 edit ==
  PASS  the header shows an enabled Edit button
  PASS  Edit opens the Sheet
  PASS  the shared form is pre-filled with the contract
  PASS  the Sheet closes after saving
  PASS  expiry_date was updated in the database — 2026-09-23
  PASS  partner_text was updated too
  PASS  the detail page shows the new expiry date — 23/09/2026
  PASS  the list shows the updated expiry date

== dashboard reflects the edit ==
  PASS  Đã hết hạn +1 (the contract is now in the past)
  PASS  Sắp hết hạn is back to baseline

== W1-WEB-032 archive ==
  PASS  Archive asks for confirmation first
  PASS  archiving redirects to the contracts list
  PASS  the row still exists (soft delete, never hard delete)
  PASS  archived_at is stamped
  PASS  the archived contract is gone from the list
  PASS  dashboard Tổng is back to baseline after archiving
  PASS  the archived contract is gone from the dashboard
  PASS  an archived contract still opens by direct link (hidden, not deleted)

== W1-WEB-034 settings ==
  PASS  the organization name is displayed — HR Partner
  PASS  the change-password link points at /auth/update-password
  PASS  email is shown but not editable
  PASS  full_name was saved
  PASS  Settings shows the new name
  PASS  the sidebar shows the new name
  PASS  the dashboard greeting uses the new name
  PASS  the original name is restored

== cross-organization (read path, in the browser) ==
  PASS  org B cannot open org A's contract — HTTP 404
  PASS  org B's page does not leak the contract number
  PASS  org B's own list is reachable
  PASS  org B's list does not show org A's contract

== browser console errors ==
  PASS  no unexpected console errors

================ 42 passed, 0 failed ================
```

The dashboard numbers are compared against counts computed independently in the
test with the same formulas, so the cards are checked against the database rather
than against themselves.

### 2c. Engineering checks

```text
pnpm typecheck   PASS (exit 0)
pnpm lint        PASS (exit 0, 0 warnings)
pnpm build       PASS (exit 0) — 17 routes, probe route removed
```

## 3. Deviations from the plan / the brief

| # | Deviation | Reason |
| --- | --- | --- |
| 1 | **Authorization moved out of the Suspense boundary** in `app/(app)/contracts/[id]/page.tsx` | Found by the browser run: another organization's contract rendered the correct 404 page but returned **HTTP 200**, because `notFound()` was called inside a boundary that had already started streaming — the status line was flushed before the error. `requireUser()` + `getContract()` + `notFound()` now run before `<Suspense>`, so a cross-tenant request answers a real **404**. Only the slower viewer data (file list + signed URL) still streams. |
| 2 | `updateContract()` writes **only the fields present in the payload** | Found by the service run: every schema field is optional, so `{ notes: "" }` is valid input — and a blind full-row update NULLed every column it did not mention, silently destroying data (the test caught `expiry_date` and `partner_text` being wiped). An explicit `""` still clears its own field. The edit form always submits all fields, so UI behaviour is unchanged; a partial API call is now safe. |
| 3 | Added `lib/server-action.ts` with `authorized()` / `fromService()` | The session guard was duplicated in every action. One implementation means an action cannot forget the check, and `ActionResult` no longer lives in a route-specific module that `settings/` would have to import from `contracts/`. |
| 4 | Added `lib/services/organizations.ts` for `getOrganization()` | The brief specified `profiles.ts` for `updateProfile` but not where the organization name is read. A separate service keeps the tenant read explicit and lets Settings keep all data access out of the page. |
| 5 | `updateContract(id, input, { userId, organizationId })` accepts `userId` but does not read it | The signature matches the brief. `updated_at` is maintained by the database trigger, so the caller's id is not needed for an update; passing the context object keeps the call shape identical to `createContract`. |
| 6 | An **archived contract stays reachable by direct link** | The owner's decision was "ẩn khỏi list" — hidden from the list, not made inaccessible. It renders with an `Đã lưu trữ` badge and a notice, and Edit/Archive are disabled. Blocking the detail page entirely would have gone beyond the instruction and made archived data unreachable with no unarchive UI to recover it. |
| 7 | `dbError()` replaces raw Supabase messages in **all** services, not only the new ones | Plan section 80 says "không raw stack trace". PostgREST errors carry SQL detail — constraint names, column names, sometimes query fragments. The driver message now goes to the server log; the user gets a generic Vietnamese message. |
| 8 | The sidebar shows `profiles.full_name` (email as fallback) | Editing a name in Settings that appears nowhere else is not much of a feature. The sidebar already fetched the session client-side, so this is one extra read on an existing effect. |
| 9 | Added shared `components/shared/empty-state.tsx` and moved the contracts table + document viewer onto it | W1-WEB-037 asks for a shared empty-state component. The contracts table had its own; the dashboard lists and the viewer needed one anyway. |
| 10 | `app/layout.tsx`: `lang="en"` → `lang="vi"`; `<Toaster />` added | The UI language is Vietnamese by owner decision, and Sonner needs one mount point. |
| 11 | Sonner toasts are additive — every failure still renders an inline `Alert` | A toast disappears; a save failure needs to stay on screen next to the form. Toasts confirm success, Alerts explain failure. |
| 12 | The dashboard lists show 5 rows (`DASHBOARD_LIST_LIMIT`) | The plan does not specify a count. Five keeps the page scannable without pagination. |

## 4. Acceptance criteria

| Criterion | Status |
| --- | --- |
| Edit opens a Sheet, reuses ContractForm, saves through `updateContract()` scoped to the org | ✅ one form, `mode` prop; verified in a browser |
| Archive confirms via AlertDialog, sets `archived_at`, hides from the list, never hard-deletes | ✅ row verified still present after archiving |
| Dashboard: 3 cards + 2 lists with the correct expiry formulas | ✅ card values match independently computed SQL counts; no chart |
| Settings: edit `full_name`, change-password link, logout | ✅ all three verified in a browser |
| Loading / error / empty consistent across the app, no raw stack trace | ✅ shared `EmptyState`, Skeleton fallbacks on dashboard + settings + detail, `dbError()` in every service |
| Cross-org: update/archive another org's contract is blocked | ✅ app layer answers `not_found`; RLS blocks the same write at the REST layer |
| typecheck / lint / build pass | ✅ |

## 5. Follow-ups

- **No unarchive UI** — Wave 1 by owner decision. Restoring a contract currently
  needs a direct database update; that is M8+ work.
- **No hard delete** anywhere in the UI, by design.
- The dashboard runs three count queries plus two list queries on every load
  (five round trips, three of them parallel). Fine at Wave 1 scale; worth a
  single aggregate view if the contract count grows.
- `components/ui/**` now includes `alert-dialog` and `sonner`; both came from the
  shadcn CLI unmodified.
- Test data after M7: `M4-E2E-001` (three files — the M6 viewer fixture) and
  `M6-BROWSER-*` (the M6 browser-upload evidence). All M7 test contracts were
  removed, and the admin's `full_name` was restored to `Dương Lê` after an
  earlier failed test run appended to it.
