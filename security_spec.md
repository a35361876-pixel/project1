# Security Specification & Payload-First TDD (`RememberAI`)

## 1. Data Invariants
1. **Identity Isolation**: Every user's profile (`/users/{userId}`), study cards (`/users/{userId}/cards/{cardId}`), MLP model weights (`/users/{userId}/modelState/mlp`), and training logs (`/users/{userId}/logs/{logId}`) are strictly private and accessible only when `request.auth != null`, `request.auth.token.email_verified == true`, and `request.auth.uid == userId`.
2. **Ownership & Path Binding**: `ownerId` (or `uid`) inside every document MUST strictly match both the `{userId}` path segment and `request.auth.uid`, and remain immutable after creation.
3. **Strict Schema & Bounds**:
   - All document IDs (`userId`, `cardId`, `stateId`, `logId`) must match `^[a-zA-Z0-9_\-]+$` and be $\le 128$ chars.
   - All string fields enforce explicit `.size()` bounds (`title` $1\text{--}120$, `note` $\le 600$, `displayName` $\le 100$, `email` $\le 200$).
   - Fixed-size numeric arrays (`w1Flat` size 16, `b1` size 4, `w2` size 4, `inputs` size 4, `hiddenActivations` size 4, `deltaW2` size 4) validate exact `.size()` and element types.
   - Server timestamps (`createdAt`, `updatedAt`) must equal `request.time`.
4. **Master Gate & No Blanket Reads**: Catch-all `match /{document=**}` denies all reads/writes by default. `allow list` on `cards` and `logs` enforces `resource.data.ownerId == request.auth.uid`.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Read**: Read `/users/alice/cards/card-1` with `auth = null`.
2. **Unverified Email Write**: Create `/users/alice/cards/card-1` with `auth = { uid: 'alice', token: { email_verified: false } }`.
3. **Cross-User Card Read**: User `bob` attempts `get` on `/users/alice/cards/card-1`.
4. **Cross-User List Scraping**: User `bob` attempts `list` on `/users/alice/cards`.
5. **Identity Spoofing on Create**: User `bob` attempts to create `/users/bob/cards/card-1` with `ownerId: 'alice'`.
6. **Shadow Ghost Field Injection**: User `alice` creates `/users/alice/cards/card-1` with extra `isAdmin: true` field.
7. **Immortal Field Mutation**: User `alice` updates `/users/alice/cards/card-1` changing `ownerId` or `createdAt`.
8. **Client-Forged Timestamp**: User `alice` creates `/users/alice/cards/card-1` with a past client `createdAt` instead of `request.time`.
9. **Resource Poisoning via Oversized ID**: User `alice` creates `/users/alice/cards/${'a'.repeat(200)}`.
10. **Value Poisoning on Update**: User `alice` updates `title` with a boolean `true` or 500-char string.
11. **Array Size Tampering**: User `alice` writes `/users/alice/modelState/mlp` with `w1Flat` of length 3 instead of 16 or containing strings.
12. **PII Leak on User Collection**: User `bob` attempts `get` or `list` on `/users/alice` or `/users`.
