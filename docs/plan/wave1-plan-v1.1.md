# Wave 1 — Manual Contract Management Master Plan v1.1

## 1. Mục tiêu

Wave 1 xây phiên bản đầu tiên của hệ thống quản lý hợp đồng với mục tiêu:

> Có sản phẩm sử dụng được nhanh nhất để người dùng upload hợp đồng, nhập metadata thủ công, tìm kiếm và xem hợp đồng trực tiếp trong giao diện.

Wave 1 chưa có:

```text
OCR
AI
LLM
n8n processing
Modal processing
```

Flow chính:

```text
Login
  ↓
Dashboard
  ↓
Contracts
  ↓
Add Contract
  ↓
Upload PDF / Image
  ↓
Nhập metadata thủ công
  ↓
Save
  ↓
Search / Filter
  ↓
Open Contract
  ↓
Preview PDF / Image trực tiếp trong UI
```

Wave 1 phải là sản phẩm thật, không phải prototype bỏ đi.

---

# 2. Nguyên tắc quan trọng nhất — REUSE FIRST

Wave 1 ưu tiên:

```text
Reuse
  ↓
Configure
  ↓
Customize
  ↓
Only then Custom Code
```

AI Coding Agent không được mặc định tự viết mọi thứ từ đầu.

Trước khi implement một chức năng phổ biến, phải kiểm tra theo thứ tự:

```text
1. Base repository đã có chưa?

2. shadcn/ui đã có component chưa?

3. Approved library đã có solution chưa?

4. Existing reference repository có pattern tốt không?

5. Chỉ khi 4 bước trên không đáp ứng mới custom-code.
```

---

# 3. Reuse-First Coding Rule

Bắt buộc áp dụng cho toàn Wave 1:

```text
DO NOT reinvent common infrastructure.
```

Không tự build lại:

```text
Authentication system

Sidebar framework

Dialog

Sheet

Toast

Date picker

Form state management

Schema validation

Drag & drop upload engine

PDF rendering engine

Table sorting engine

Pagination engine phức tạp

R2 signing bằng crypto tự viết

Custom component library
```

---

# 4. Product Scope

Wave 1 chỉ tập trung vào:

```text
1. Authentication

2. Contract creation

3. Manual metadata entry

4. PDF/Image upload

5. Cloudflare R2 storage

6. Contracts list

7. Search

8. Filters

9. Contract detail

10. PDF preview

11. Image preview

12. Contract editing

13. Archive

14. Basic dashboard

15. Security / RLS
```

---

# 5. Out of Scope

Wave 1 không làm:

```text
OCR

Document Parser

AI Extraction

LLM

n8n document workflow

Modal

Processing jobs

Confidence score

Evidence extraction

AI Review

Semantic search

RAG

Vector database

Clause extraction

Risk analysis

Partner entity

Complex approval workflow

Electronic signature

Document versioning

Advanced duplicate detection

AI batch processing
```

---

# 6. High-Level Architecture

```text
                    USER
                     │
                     ▼
                Next.js App
                   Vercel
                     │
          ┌──────────┴─────────────┐
          │                        │
          ▼                        ▼
      Supabase                 Cloudflare R2
  Auth + PostgreSQL           Private Files
```

Responsibilities:

```text
Next.js
= UI + business logic + authorization

Supabase
= Authentication + Database + RLS

Cloudflare R2
= PDF/Image storage

Vercel
= Application deployment
```

---

# 7. Wave 2 Compatibility

Wave 1 phải chuẩn bị cho:

```text
R2
 ↓
Presigned GET URL
 ↓
n8n
 ↓
Modal.com
 ↓
OCR / Parser
 ↓
Structured Contract Data
 ↓
Supabase
```

Không migrate lại original files khi sang Wave 2.

---

# 8. Approved Base Repository

Base repo:

```text
Barty-Bart/
nextjs-supabase-shadcn-boilerplate
```

Dùng làm starting point.

Reuse tối đa:

```text
Next.js setup

TypeScript config

Supabase integration

Authentication

Protected dashboard

Sidebar

App layout

shadcn/ui setup
```

Không rewrite các phần trên nếu boilerplate đã đáp ứng.

---

# 9. Base Repo Strategy

AI Coding Agent phải:

```text
Fork / clone base
   ↓
Run successfully
   ↓
Remove sample/demo code
   ↓
Preserve useful auth/layout
   ↓
Build contract features
```

Không:

```text
create-next-app
+
rewrite auth
+
rewrite sidebar
+
rewrite dashboard shell
```

nếu base repo đã có.

---

# 10. Upload Reference Repository

Reference:

```text
moazhassan751/
supabase-storage-crud
```

Không dùng nó làm core architecture.

Chỉ tham khảo:

```text
drag & drop UX

file selection

upload progress

file validation

file metadata handling
```

Storage implementation được thay bằng:

```text
Cloudflare R2
```

---

# 11. Approved Libraries

Wave 1 chốt các thư viện sau.

## UI

```text
shadcn/ui
```

Reuse cho:

```text
Button
Input
Textarea
Dialog
Sheet
Table
Badge
Card
Dropdown
Tooltip
Skeleton
Progress
Alert
Calendar
Popover
Sonner
```

---

# 12. Icons

Use:

```text
lucide-react
```

Không tự tạo icon SVG nếu không cần.

---

# 13. Forms

Use:

```text
react-hook-form
```

cho:

```text
Create Contract

Edit Contract

Settings forms
```

Không quản lý form lớn bằng hàng chục `useState`.

---

# 14. Validation

Use:

```text
zod
```

Schemas:

```text
CreateContractSchema

UpdateContractSchema

ContractFileSchema

PresignUploadSchema
```

Client và server dùng chung schema nếu phù hợp.

---

# 15. File Drop

Use:

```text
react-dropzone
```

cho:

```text
drag & drop

file selection

accepted file types

multi-file selection
```

Không tự viết drag/drop engine.

---

# 16. PDF Viewer

Use:

```text
react-pdf
```

dựa trên:

```text
PDF.js
```

Không tự render PDF từ canvas primitives.

Viewer custom code chỉ nên tập trung vào:

```text
toolbar

page state

zoom

fit width

signed URL refresh
```

---

# 17. Image Viewer

Không cần library nặng.

Use browser image rendering + lightweight controls.

Có thể dùng:

```text
CSS transforms
```

cho:

```text
zoom
rotate
fit
```

Nếu implementation bắt đầu phức tạp mới thêm library.

---

# 18. Table

Default:

```text
shadcn Table
```

Nếu sorting/filtering/column management bắt đầu phức tạp:

```text
@tanstack/react-table
```

Không custom table engine.

---

# 19. Dates

Use:

```text
date-fns
```

cho:

```text
formatting

date arithmetic

expiry calculations
```

DB vẫn lưu:

```text
YYYY-MM-DD
```

---

# 20. Toast

Use:

```text
Sonner
```

qua shadcn.

Không build notification/toast system riêng.

---

# 21. R2 SDK

Use:

```text
@aws-sdk/client-s3

@aws-sdk/s3-request-presigner
```

Không tự implement AWS Signature V4.

---

# 22. Supabase SDK

Use official Supabase JS libraries.

Reuse base repository configuration cho:

```text
browser client

server client

SSR session
```

Không tạo auth wrapper phức tạp không cần thiết.

---

# 23. Approved Reuse Matrix

| Feature             | Reuse                         |
| ------------------- | ----------------------------- |
| Next.js application | Base repo                     |
| Supabase Auth       | Base repo + Supabase SDK      |
| Protected layout    | Base repo                     |
| Sidebar             | Base repo + shadcn            |
| UI components       | shadcn/ui                     |
| Icons               | lucide-react                  |
| Forms               | react-hook-form               |
| Validation          | Zod                           |
| Drag/drop           | react-dropzone                |
| Contract table      | shadcn Table / TanStack Table |
| PDF preview         | react-pdf / PDF.js            |
| Image preview       | Browser + CSS                 |
| Date formatting     | date-fns                      |
| Toast               | Sonner                        |
| R2 client           | AWS SDK                       |
| R2 presigning       | AWS SDK presigner             |
| Database/Auth       | Supabase                      |
| Deployment          | Vercel                        |

---

# 24. What Must Be Custom Code

Custom code chỉ tập trung vào business-specific logic:

```text
Contract schema

Contract CRUD

R2 object key convention

Authorization before presign

Contract search query

Expiry filters

Contract Detail layout

Document selection

Dashboard queries

Organization isolation

Wave 2 integration boundary
```

Đây mới là nơi Coding Agent dành phần lớn effort.

---

# 25. Repository

Main repository:

```text
contract-manager
```

Recommended structure:

```text
contract-manager/
│
├── apps/
│   └── web/
│
├── packages/
│   ├── schemas/
│   ├── ui/
│   └── shared/
│
├── supabase/
│   ├── migrations/
│   └── seed/
│
├── docs/
│
├── wave1-plan.md
│
├── .env.example
├── README.md
└── package.json
```

Không cần:

```text
modal/

ocr/

n8n/
```

trong Wave 1 runtime.

---

# 26. Main Navigation

Wave 1:

```text
Dashboard

Contracts

Settings
```

Không show:

```text
Processing

Review

AI

Partners
```

---

# 27. Routes

```text
/login

/dashboard

/contracts

/contracts/new

/contracts/[id]

/settings
```

Optional:

```text
/contracts/[id]/edit
```

---

# 28. Authentication

Use:

```text
Supabase Auth
```

Login:

```text
Email
Password
```

Need:

```text
login

logout

session persistence

protected routes
```

---

# 29. Organizations

Table:

```text
organizations
```

Fields:

```text
id uuid primary key

name text not null

created_at timestamptz

updated_at timestamptz
```

Wave 1 có thể chỉ có một organization.

---

# 30. Profiles

```text
profiles
```

Fields:

```text
id uuid primary key

organization_id uuid not null

full_name text nullable

role text not null default 'user'

is_active boolean default true

created_at timestamptz

updated_at timestamptz
```

Roles:

```text
admin

user
```

---

# 31. Contracts Table

```text
contracts
```

Fields:

```text
id uuid primary key

organization_id uuid not null

contract_number text nullable

signed_date date nullable

duration_text text nullable

expiry_date date nullable

partner_text text nullable

notes text nullable

archived_at timestamptz nullable

created_by uuid nullable

created_at timestamptz

updated_at timestamptz
```

---

# 32. Partner Strategy

Wave 1 không tạo:

```text
partners
```

table.

Dùng:

```text
partner_text
```

Ví dụ:

```text
Công ty TNHH Samsung Electronics Việt Nam
```

Mục tiêu:

```text
ship nhanh

không over-model business data
```

---

# 33. Duration

Support cả:

```text
duration_text
```

và:

```text
expiry_date
```

Ví dụ:

```text
12 tháng
```

hoặc:

```text
Không xác định thời hạn
```

---

# 34. Contract Files Table

```text
contract_files
```

Fields:

```text
id uuid primary key

organization_id uuid not null

contract_id uuid not null

storage_provider text not null default 'r2'

bucket text not null

object_key text not null

original_filename text not null

mime_type text not null

file_size bigint nullable

checksum text nullable

created_by uuid nullable

created_at timestamptz
```

---

# 35. File Relationship

```text
Contract
   ↓
1..N Files
```

Support:

```text
Main contract

Appendix

Additional scan

Image pages
```

Không versioning Wave 1.

---

# 36. Cloudflare R2

Bucket:

```text
contracts
```

Private.

No public file URLs.

---

# 37. Object Key

Convention:

```text
contracts/
  {organization_id}/
    {contract_id}/
      {file_id}/
        {filename}
```

Example:

```text
contracts/org-1/contract-1/file-1/contract.pdf
```

---

# 38. File Types

Allowed:

```text
PDF
JPG
JPEG
PNG
```

MIME:

```text
application/pdf
image/jpeg
image/png
```

---

# 39. Upload Limit

Config:

```text
MAX_UPLOAD_SIZE_MB=50
```

Không hard-code trong component.

---

# 40. Upload Architecture

Không proxy file qua Vercel.

Use:

```text
Browser
   ↓
Next.js requests presigned URL
   ↓
R2 presigned PUT URL
   ↓
Browser uploads directly to R2
```

---

# 41. Upload Reuse Strategy

Use:

```text
react-dropzone
```

cho UX.

Use:

```text
AWS SDK Presigner
```

cho upload URL.

Custom code chỉ cho:

```text
file business validation

object key

authorization

contract_files persistence
```

---

# 42. Upload Flow

```text
User selects files
      ↓
react-dropzone
      ↓
validate type/size
      ↓
create contract
      ↓
request presigned PUT URL
      ↓
browser upload → R2
      ↓
save contract_files
      ↓
redirect detail
```

---

# 43. Upload Progress

Nếu cần actual byte progress:

use browser:

```text
XMLHttpRequest
```

cho PUT request.

Không cần thêm upload framework nặng chỉ để có progress.

---

# 44. Upload Failure

Nếu metadata đã save nhưng upload fail:

```text
contract remains
```

Show:

```text
Upload failed

[Retry]
```

Không làm mất form data.

---

# 45. Add Contract Form

Route:

```text
/contracts/new
```

Fields:

```text
Contract Number

Signed Date

Duration

Expiry Date

Partner

Notes

Documents
```

---

# 46. Form Implementation

Reuse:

```text
React Hook Form
+
Zod
+
shadcn Form/Input/Textarea/Calendar
```

Không viết form engine riêng.

---

# 47. Form Validation

Validate:

```text
dates

file type

file size
```

Warning:

```text
expiry_date < signed_date
```

Có thể không hard-block.

---

# 48. Contracts List

Route:

```text
/contracts
```

Columns:

```text
Contract Number

Partner

Signed Date

Duration / Expiry

Files

Updated At
```

---

# 49. Contract Table Strategy

Phase 1 simple implementation:

```text
shadcn Table
```

Nếu cần:

```text
sorting

column state

advanced pagination
```

upgrade sang:

```text
TanStack Table
```

Không custom from scratch.

---

# 50. Search

Search:

```text
contract_number

partner_text
```

Optional:

```text
notes
```

Không search file content.

---

# 51. Search Implementation

Server-side.

Concept:

```text
contract_number ILIKE

partner_text ILIKE
```

Query state giữ trong URL:

```text
/contracts?q=samsung
```

---

# 52. Filters

```text
Signed Date

Expiry Date
```

Presets:

```text
Expired

Expires in 30 days

Expires in 90 days
```

Use:

```text
date-fns
```

cho date arithmetic ở app.

---

# 53. Pagination

Server-side.

Default:

```text
25
```

Options:

```text
25

50

100
```

---

# 54. Contract Detail

Route:

```text
/contracts/[id]
```

Desktop layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ ← Contracts                         [Edit] [More]            │
├───────────────────────────────┬──────────────────────────────┤
│                               │ Contract Information         │
│                               │                              │
│       Document Viewer         │ Contract No                  │
│                               │ Signed Date                  │
│        PDF / Image            │ Duration                     │
│                               │ Expiry Date                  │
│                               │ Partner                      │
│                               │ Notes                        │
│                               │                              │
└───────────────────────────────┴──────────────────────────────┘
```

Ratio:

```text
65% Viewer

35% Metadata
```

---

# 55. Multi-file UI

Top/side document selector:

```text
Main.pdf

Appendix.pdf

scan.jpg
```

Click file:

```text
viewer switches immediately
```

---

# 56. PDF Viewer

Use:

```text
react-pdf
```

Mandatory:

```text
Previous page

Next page

Current page

Zoom in

Zoom out

Fit width
```

Recommended:

```text
Rotate

Fullscreen
```

---

# 57. PDF Viewer Custom Boundary

Không modify PDF.js internals.

Custom component chỉ wrap:

```text
<Document>

<Page>
```

với:

```text
toolbar state

scale

page number

container size
```

---

# 58. Image Viewer

Use:

```text
<img>
```

or Next.js image handling where appropriate.

Support:

```text
zoom

rotate

fit
```

Không cần external image editor.

---

# 59. Preview Access

Flow:

```text
User opens Contract Detail
        ↓
Next.js authenticates user
        ↓
Checks organization
        ↓
Checks contract/file relation
        ↓
Generate R2 presigned GET URL
        ↓
react-pdf/image viewer loads R2 object
```

---

# 60. Presigned URL TTL

Recommended:

```text
View:
5–15 minutes

Upload:
10 minutes
```

Wave 2 Modal:

```text
15–30 minutes
```

---

# 61. R2 Security

Browser never receives:

```text
R2_ACCESS_KEY_ID

R2_SECRET_ACCESS_KEY
```

Browser only gets:

```text
temporary URL
```

---

# 62. R2 Service Layer

Create:

```text
apps/web/lib/r2/
```

Files:

```text
client.ts

presign.ts

keys.ts
```

Responsibilities:

```text
createR2Client()

createUploadUrl()

createViewUrl()

buildObjectKey()
```

No R2 logic duplicated in components.

---

# 63. File Authorization Service

Create:

```text
getContractFileAccess()
```

Checks:

```text
user exists

organization matches

contract belongs to organization

file belongs to contract
```

Then presign.

---

# 64. API / Server Actions

Suggested endpoints:

```text
POST /api/files/upload-url

POST /api/files/view-url
```

Could use Server Actions if cleaner.

Do not build unnecessary REST layer for CRUD.

---

# 65. Edit Contract

Can use:

```text
shadcn Sheet
```

for fast implementation.

Reuse same:

```text
ContractForm
```

for create/edit where possible.

---

# 66. Archive

Use:

```text
archived_at
```

No hard delete through normal UI.

---

# 67. Dashboard

Route:

```text
/dashboard
```

Cards:

```text
Total Contracts

Expiring Soon

Expired
```

Lists:

```text
Recent Contracts

Expiring Contracts
```

No charts Wave 1.

---

# 68. Dashboard Reuse

Use:

```text
shadcn Card

shadcn Table
```

No charting library needed.

---

# 69. Expiring Soon

Definition:

```text
expiry_date >= today
AND
expiry_date <= today + 90 days
```

---

# 70. Expired

Definition:

```text
expiry_date < today
```

No stored lifecycle status needed yet.

---

# 71. Settings

Route:

```text
/settings
```

Only:

```text
Profile

Organization

Logout
```

Reuse shadcn form components.

---

# 72. RLS

Enable on:

```text
contracts

contract_files
```

User only accesses:

```text
organization_id
=
current user's organization_id
```

---

# 73. R2 vs RLS

Important:

```text
Supabase RLS
```

does not secure R2.

Therefore:

> Every R2 URL must be generated only after server-side authorization.

---

# 74. Shared Schemas

Directory:

```text
packages/schemas/
```

At minimum:

```text
contract.ts

file.ts
```

Reuse Zod schemas in:

```text
forms

server actions

route handlers
```

---

# 75. Service Layer

Do not query Supabase randomly in every component.

Create:

```text
apps/web/lib/services/
```

Files:

```text
contracts.ts

files.ts

dashboard.ts
```

---

# 76. Contract Service

Functions:

```text
listContracts()

getContract()

createContract()

updateContract()

archiveContract()

getContractFiles()
```

---

# 77. File Service

Functions:

```text
createUploadRequest()

completeUpload()

getFileViewUrl()

listContractFiles()
```

---

# 78. Dashboard Service

Functions:

```text
getContractMetrics()

getRecentContracts()

getExpiringContracts()
```

---

# 79. Component Structure

```text
components/

contracts/
    contracts-table.tsx
    contract-form.tsx
    contract-detail.tsx
    contract-filters.tsx

documents/
    document-viewer.tsx
    pdf-viewer.tsx
    image-viewer.tsx
    document-selector.tsx
    upload-dropzone.tsx

dashboard/
    metric-card.tsx
    recent-contracts.tsx
    expiring-contracts.tsx
```

---

# 80. Error States

Need:

```text
login failed

contract load failed

save failed

upload failed

preview failed

presigned URL failed
```

Use:

```text
Alert
Sonner
```

Không raw stack trace.

---

# 81. Loading States

Reuse:

```text
shadcn Skeleton

shadcn Progress
```

For:

```text
contracts table

contract detail

viewer

upload

dashboard
```

---

# 82. Empty States

Contracts:

```text
No contracts yet

[Add Contract]
```

Files:

```text
No document attached

[Upload Document]
```

Search:

```text
No matching contracts
```

---

# 83. Environment Variables

```text
NEXT_PUBLIC_SUPABASE_URL=

NEXT_PUBLIC_SUPABASE_ANON_KEY=

SUPABASE_SERVICE_ROLE_KEY=

R2_ACCOUNT_ID=

R2_ACCESS_KEY_ID=

R2_SECRET_ACCESS_KEY=

R2_BUCKET_NAME=

R2_ENDPOINT=

APP_URL=

MAX_UPLOAD_SIZE_MB=50
```

---

# 84. Deployment

```text
GitHub
   ↓
Vercel
   ↓
Next.js
```

Supporting services:

```text
Supabase Cloud

Cloudflare R2
```

No VPS dependency Wave 1.

---

# 85. CI

Minimum:

```text
pnpm lint

pnpm typecheck

pnpm build
```

Recommended:

```text
pnpm test
```

---

# 86. Development Sequence

Không implement theo page ngẫu nhiên.

Dependency order:

```text
Base repo
   ↓
Supabase config
   ↓
DB migrations
   ↓
Auth verification
   ↓
RLS
   ↓
R2 integration
   ↓
Contract CRUD
   ↓
Upload
   ↓
Contracts list
   ↓
Search/filter
   ↓
Viewer
   ↓
Dashboard
   ↓
Settings
   ↓
Tests
   ↓
Production
```

---

# 87. AI Coding Agent Rule

Trước mỗi task, Coding Agent phải ghi ngắn:

```text
Reuse:
- repo/component/library being reused

Custom:
- project-specific code required
```

Ví dụ:

```text
W1-WEB-015 Upload

Reuse:
react-dropzone
shadcn Progress
AWS presigner

Custom:
R2 object key
authorization
DB persistence
```

---

# 88. Task Mapping — Foundation

## W1-WEB-001

Initialize from:

```text
Barty-Bart/nextjs-supabase-shadcn-boilerplate
```

Reuse:

```text
project setup
auth
layout
sidebar
shadcn
```

Custom:

```text
rename app
remove demo code
```

---

## W1-WEB-002

Clean boilerplate.

Reuse existing:

```text
layout
auth
Supabase clients
```

Do not rewrite.

---

## W1-WEB-003

Configure Supabase.

Reuse:

```text
base repo Supabase integration
```

---

## W1-WEB-004

Application shell.

Reuse:

```text
base repo sidebar
shadcn navigation
lucide icons
```

---

# 89. Task Mapping — Database

## W1-WEB-005

Create:

```text
organizations
```

Custom migration.

---

## W1-WEB-006

Create:

```text
profiles
```

Custom migration.

---

## W1-WEB-007

Create:

```text
contracts
```

Custom migration.

---

## W1-WEB-008

Create:

```text
contract_files
```

Custom migration.

---

## W1-WEB-009

RLS.

Reuse:

```text
Supabase RLS primitives
```

Custom:

```text
organization-based policies
```

---

# 90. Task Mapping — R2

## W1-WEB-010

Configure R2 client.

Reuse:

```text
@aws-sdk/client-s3
```

---

## W1-WEB-011

Object key.

Custom only:

```text
buildObjectKey()
```

---

## W1-WEB-012

Presigned PUT.

Reuse:

```text
@aws-sdk/s3-request-presigner
```

---

## W1-WEB-013

Presigned GET.

Reuse:

```text
@aws-sdk/s3-request-presigner
```

---

# 91. Task Mapping — Create Contract

## W1-WEB-014

Build Add Contract page.

Reuse:

```text
shadcn Form
React Hook Form
Zod
date-fns
```

Custom:

```text
contract fields
business validation
```

---

## W1-WEB-015

Build uploader.

Reuse:

```text
react-dropzone
shadcn Progress
upload UX reference repo
```

Custom:

```text
R2 direct PUT
```

---

## W1-WEB-016

Upload progress.

Reuse:

```text
XMLHttpRequest progress
shadcn Progress
```

---

## W1-WEB-017

Create Contract flow.

Custom business logic.

---

## W1-WEB-018

Persist file metadata.

Custom Supabase service.

---

# 92. Task Mapping — Contracts List

## W1-WEB-019

Contracts List.

Reuse:

```text
shadcn Table
```

If needed:

```text
TanStack Table
```

---

## W1-WEB-020

Search.

Reuse:

```text
URLSearchParams
Supabase/Postgres query
```

Custom query logic.

---

## W1-WEB-021

Date filters.

Reuse:

```text
shadcn Calendar
date-fns
```

---

## W1-WEB-022

Pagination.

Reuse:

```text
server-side query
shadcn buttons
```

TanStack pagination only if table complexity warrants it.

---

# 93. Task Mapping — Viewer

## W1-WEB-023

Contract Detail.

Reuse:

```text
shadcn layout primitives
```

Custom split layout.

---

## W1-WEB-024

Documents selector.

Reuse:

```text
Tabs / Button / ScrollArea
```

from shadcn.

---

## W1-WEB-025

PDF viewer.

Reuse:

```text
react-pdf
PDF.js
```

Do not custom-render PDF.

---

## W1-WEB-026

Page navigation.

Wrap react-pdf page state.

---

## W1-WEB-027

Zoom.

Wrap:

```text
scale
```

state.

---

## W1-WEB-028

Fit Width.

Custom small utility around container width.

Do not fork PDF renderer.

---

## W1-WEB-029

Image viewer.

Reuse browser image rendering.

---

## W1-WEB-030

Signed URL refresh.

Reuse R2 service layer.

Custom retry/refresh state only.

---

# 94. Task Mapping — Remaining UI

## W1-WEB-031

Edit Contract.

Reuse:

```text
same ContractForm
shadcn Sheet
```

Do not create separate form implementation.

---

## W1-WEB-032

Archive.

Reuse:

```text
AlertDialog
```

---

## W1-WEB-033

Dashboard.

Reuse:

```text
Card
Table
Skeleton
```

---

## W1-WEB-034

Settings.

Reuse:

```text
existing form primitives
```

---

# 95. Task Mapping — UX

## W1-WEB-035

Loading states.

Reuse:

```text
Skeleton
Progress
```

---

## W1-WEB-036

Error states.

Reuse:

```text
Alert
Sonner
```

---

## W1-WEB-037

Empty states.

Reuse shared empty-state component.

---

## W1-WEB-038

Form validation.

Reuse:

```text
Zod
React Hook Form
```

---

# 96. Testing Tasks

```text
W1-WEB-039
Authorization tests

W1-WEB-040
RLS tests

W1-WEB-041
CI

W1-WEB-042
Production deploy

W1-WEB-043
Production smoke test
```

Testing tools should use existing project stack where practical.

Không xây custom test runner.

---

# 97. n8n Agent

Wave 1:

```text
NO REQUIRED TASKS
```

---

# 98. Modal

Wave 1:

```text
NO REQUIRED TASKS
```

---

# 99. Wave 2 File Contract

Wave 1 phải đảm bảo mỗi file có:

```text
organization_id

contract_id

file_id

bucket

object_key

mime_type
```

Wave 2:

```text
file_id
 ↓
object_key
 ↓
R2 presigned GET
 ↓
Modal
```

---

# 100. Test Matrix

Must test:

```text
Login

Logout

Create contract

Edit contract

Archive contract

Upload PDF

Upload JPG

Upload PNG

Upload multiple files

Upload progress

Upload retry

Search number

Search partner

Expiry filters

Pagination

PDF preview

PDF next/previous page

PDF zoom

PDF fit width

Image preview

Switch document

Expired presigned URL refresh

Cross-org DB access

Cross-org R2 access
```

---

# 101. Security Test

User Org A requesting:

```text
file_id from Org B
```

must return:

```text
403
```

and never generate R2 URL.

---

# 102. Demo Scenario

```text
Login
 ↓
Dashboard
 ↓
Add Contract
 ↓
Drop PDF using react-dropzone
 ↓
Direct upload to R2
 ↓
Enter manual metadata
 ↓
Save
 ↓
Search Samsung
 ↓
Open contract
 ↓
react-pdf renders PDF inside UI
 ↓
Next page / zoom / fit width
 ↓
Edit expiry date
```

Wave 1 complete.

---

# 103. Acceptance Criteria — Reuse

Wave 1 chỉ pass nếu Coding Agent không tự viết lại các capability đã approved.

Checklist:

```text
Auth reused

Dashboard shell reused

Sidebar reused

shadcn reused

React Hook Form used

Zod used

react-dropzone used

react-pdf used

AWS SDK used for R2

date-fns used

lucide-react used
```

Nếu một approved library không được dùng:

Coding Agent phải ghi lý do kỹ thuật.

---

# 104. Acceptance Criteria — Product

```text
✓ Login

✓ Dashboard

✓ Contracts List

✓ Add Contract

✓ Manual Metadata

✓ Upload PDF/Image

✓ Multi-file

✓ Contract Detail

✓ PDF Preview

✓ Image Preview

✓ Search

✓ Filter

✓ Edit

✓ Archive
```

---

# 105. Acceptance Criteria — R2

```text
✓ R2 private bucket

✓ direct browser upload

✓ presigned PUT

✓ presigned GET

✓ credentials server-only

✓ authorized access only
```

---

# 106. Acceptance Criteria — Database

```text
✓ organizations

✓ profiles

✓ contracts

✓ contract_files

✓ migrations

✓ RLS
```

---

# 107. Acceptance Criteria — Preview

```text
✓ PDF displayed in app

✓ no manual download required

✓ page navigation

✓ zoom

✓ fit width

✓ image preview

✓ multi-file switching
```

---

# 108. Acceptance Criteria — Engineering

```text
✓ reuse-first rule followed

✓ no unnecessary custom infrastructure

✓ TypeScript passes

✓ lint passes

✓ build passes

✓ migrations tracked

✓ secrets protected

✓ production deployed
```

---

# 109. Definition of Done

Wave 1 DONE khi user có thể:

```text
Login
 ↓
Create Contract
 ↓
Upload file to R2
 ↓
Enter metadata manually
 ↓
Search
 ↓
Filter
 ↓
Open Contract
 ↓
Read PDF/Image inside app
 ↓
Edit metadata
```

và architecture vẫn sẵn sàng cho:

```text
Wave 2 OCR
```

---

# 110. Wave 1 Exit Gate

Trước Wave 2 phải trả lời YES:

```text
Can users login?

Can users create contracts?

Can users upload PDFs/images?

Are files stored privately in R2?

Can contracts have multiple files?

Can users search by number?

Can users search by partner?

Can users filter expiry dates?

Can users preview documents without downloading?

Does PDF navigation work?

Does zoom work?

Can users edit metadata?

Does RLS isolate organizations?

Does R2 access require application authorization?

Does every file have contract_id + file_id + object_key?

Can Wave 2 generate a presigned URL for Modal?

Did the Coding Agent reuse approved repos/libraries instead of rebuilding common infrastructure?
```

---

# 111. Final Architecture

```text
                         USER
                          │
                          ▼
                     Next.js App
                        Vercel
                          │
             ┌────────────┴────────────┐
             │                         │
             ▼                         ▼
         Supabase                 Cloudflare R2
      Auth + PostgreSQL           Private Files
             │                         │
             │                         ▼
             │                  PDF / JPG / PNG
             │                         │
             └──────────────┬──────────┘
                            ▼
                   Contract Detail UI
                            │
                       react-pdf
                      Image Viewer
```

Future:

```text
R2
 ↓
Presigned GET
 ↓
n8n
 ↓
Modal
 ↓
OCR
 ↓
Supabase
```

---

# 112. Final Technology Decisions

```text
Base Repository
Barty-Bart/nextjs-supabase-shadcn-boilerplate

Frontend
Next.js + TypeScript

UI
shadcn/ui

Auth
Supabase Auth

Database
Supabase PostgreSQL

Storage
Cloudflare R2

File Drop
react-dropzone

Forms
React Hook Form

Validation
Zod

PDF
react-pdf / PDF.js

Tables
shadcn Table
TanStack Table only when needed

Dates
date-fns

Icons
lucide-react

Toast
Sonner

R2
AWS S3 SDK + request presigner

Deployment
Vercel
```

---

# 113. Wave 1 Development Philosophy

AI Coding Agent không được tối ưu cho:

```text
maximum amount of generated code
```

Mà phải tối ưu cho:

```text
minimum custom code
+
maximum reuse
+
fastest usable product
```

Nguyên tắc cuối cùng:

> Nếu một library hoặc repo ổn định đã giải quyết 80–90% vấn đề, hãy reuse nó và chỉ code 10–20% business-specific còn lại.

---

# 114. Wave 1 Expected Outcome

Sau Wave 1:

```text
Contract PDF/Image
       ↓
Cloudflare R2
       ↓
Manual Metadata
       ↓
Supabase
       ↓
Search / Filter
       ↓
In-App Preview
```

Wave 1 trở thành nền tảng thật để Wave 2 bổ sung:

```text
OCR
+
Automated Metadata Extraction
```

mà không phải thay lại application core.
