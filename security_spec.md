# Security Specification — Marketing OS Firestore Rules

## 1. Data Invariants
1. A `UserProfile` document at `/users/{userId}` can only be read, created, or updated by the authenticated, email-verified user whose `request.auth.uid == userId`.
2. A `Workspace` document at `/workspaces/{workspaceId}` can only be created when `ownerId == request.auth.uid`, `isValidId(workspaceId)`, and `createdAt == request.time && updatedAt == request.time`.
3. A `WorkspaceItem` document at `/workspaces/{workspaceId}/items/{itemId}` MUST belong to an existing parent workspace owned by `request.auth.uid` (enforced via `get()` Master Gate on single-document operations and `resource.data.ownerId == request.auth.uid` on `list`).
4. `ownerId`, `workspaceId`, and `createdAt` are immutable after creation.
5. No user can list `/users` globally or list `/workspaces` or `/items` belonging to another `ownerId`.
6. Once a `WorkspaceItem` reaches terminal status `'published'` or `'archived'`, client updates cannot revert its `status` or mutate immutable provenance fields.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated read/write**: `auth = null` reading `/workspaces/ws1` -> `PERMISSION_DENIED`.
2. **Unverified email write**: `auth.token.email_verified = false` creating `/workspaces/ws1` -> `PERMISSION_DENIED`.
3. **Cross-tenant workspace read**: User B reads User A's `/workspaces/ws_A` -> `PERMISSION_DENIED`.
4. **Cross-tenant item creation**: User B writes `/workspaces/ws_A/items/item1` with `ownerId: UserB` -> `PERMISSION_DENIED` (Master Gate checks parent `ws_A.ownerId == UserB`).
5. **Identity spoofing on create**: User A creates `/workspaces/ws_A` with `ownerId: UserB` -> `PERMISSION_DENIED`.
6. **Shadow field injection**: User A creates `/users/userA` with extra `isAdmin: true` -> `PERMISSION_DENIED` (`hasOnly` blocks undeclared keys).
7. **ID poisoning**: Document ID exceeding 128 chars or containing `../` or `$` -> `PERMISSION_DENIED` (`isValidId`).
8. **Timestamp forgery**: Creating document with backdated `createdAt` (`createdAt != request.time`) -> `PERMISSION_DENIED`.
9. **OwnerId mutation on update**: Updating `ownerId` on an existing workspace -> `PERMISSION_DENIED`.
10. **Blanket list scraping**: Querying `/workspaces` without `where('ownerId', '==', uid)` -> `PERMISSION_DENIED` (`allow list: if isSignedIn() && resource.data.ownerId == request.auth.uid`).
11. **Oversized string DoW attack**: Passing a 1MB `description` string on workspace -> `PERMISSION_DENIED` (`.size() <= 4000`).
12. **PII leak on user profile**: User B calls `get(/users/userA)` -> `PERMISSION_DENIED`.
