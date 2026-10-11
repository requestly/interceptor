# Interceptor → BrowserStack Usage Reports instrumentation (RQ-3644, Task 3)

**Status:** design approved · **Parent:** [RQ-3644](https://browserstack.atlassian.net/browse/RQ-3644) (Usage & Reporting Analytics, customer AON) · **Track:** Task 3 (Interceptor); the sibling API Client track is Task 2 (separate repo, `requestly-api-client`).

This branch (`feat/rq-3644-usage-reports`) is the **stacked-PR base** for the Interceptor track. Each `3.x` subtask lands as its own PR targeting this branch and merges *down* into it; this branch merges to `master` last.

---

## Goal

Let BrowserStack org admins see Requestly **Interceptor** adoption/activity in enterprise **Usage Reports → Team & User Reports**. Interceptor usage already flows to `live_plus.requestly_events_partitioned` via EDS, and every event is auto-enriched at a single choke-point — but it can't be attributed to a BrowserStack **group** because the group id never reaches the event.

## Attribution model — group is a property of the USER, not the workspace

The audit (RQ-4674) originally assumed the group could come from the active workspace's `browserstackDetails.groupId`. **That is wrong for attribution:** in Interceptor a workspace/team is independent of the user's BrowserStack group. The canonical definition (api-server `/api/v1/me`, ADR-196) is: a user's `group_id` = the `bsGroupId` on their BrowserStack IAAM user-mapping — present when the user is BS-linked, `null` otherwise ("auth not merged"). `sub_group_id` (the team/subgroup) is **not consumed by Interceptor** right now.

### How the user→group link exists in Interceptor today

Interceptor has no `/me` and no `user_mappings` table (it runs on requestly-cloud/Firebase). The user's BS group reaches the frontend through exactly one correct channel: the **billing team**.

- requestly-cloud maps a BS group to a billing team **1:1 and deterministically**: `getBillingTeamIdFromGroupId(groupId)` → `` `browserstack-${groupId}` `` (`browserstack/utils/index.ts:12`). That billing-team doc carries `browserstackGroupId = <groupId>` (`billing/types.ts:28`, a **string**).
- On BS user sync (`browserstack/services/userSync.ts` `processGroup`), the user is added to `browserstack-<groupId>`; when their BS org changes they're **removed** from the old one → a synced user is a member of **exactly one** `browserstack-*` billing team.
- Interceptor loads the user's billing teams globally via `useBillingTeamsListener` (`app/src/hooks`/mounted in `AppLayout:47`) — a Firestore listener on `billing` where `members.{uid} != null` (plus company-domain-owned teams). So `browserstackGroupId` is available in the store for every event.

**The other two things that look like a group source but aren't the right one:**
- Workspace `browserstackDetails.groupId` (`features/workspaces/types/index.ts:25`) — workspace/team-level, the semantic we explicitly rejected.
- `user.details.organization` (`AuthHandler.ts:90`) — from `getEnterpriseAdminDetails`, only `{ workspaces: [{ adminName, adminEmail, workspaceName }] }` matched by email domain (admin-only). **No group id.**

## 3.1 (RQ-4675) — plumb `group_id` onto every event

**The patch model is the key constraint.** The production web app = this interceptor base + the `requestly-cloud` `webapp` overlay patched on top, and `patch.sh` **overwrites** `modules/analytics/` wholesale (`cp -r webapp/src/modules/analytics/. → build/app/...`). The real EDS emission lives in the overlay (`webapp/src/modules/analytics/integrations/eds.ts`), which builds a `POST /send_event` envelope with `browserstack_user_id` as a **top-level `data.*` field** (not inside `event_details`). So `group_id` must flow the **same way as `browserstack_user_id`** — a top-level `data.group_id` field emitted in `eds.ts`, in `requestly-cloud`, not this repo. This repo only exposes the value.

Split across the two repos:

1. **Interceptor (this repo — survives the patch):**
   - **Selector** `getUserBrowserstackGroupId` (new, `store/features/billing/selectors.ts`): from `getAvailableBillingTeams` + the signed-in `uid`, pick the team where `uid ∈ members` **and** `browserstackGroupId` is set (prefer member-of over domain-matched teams); return that `browserstackGroupId` or `null`. Consolidates the `uid in team.members` filter copy-pasted in ~6 components.
   - **Hook** `useBrowserstackGroupId` (mounted in `AppLayout`): sets `window.currentlyActiveBrowserstackGroupId` from that selector — the interceptor-side source, analogous to how the auth handler exposes `browserstackId`. Does **not** touch `modules/analytics/`.
2. **requestly-cloud (`webapp` overlay):** in `integrations/eds.ts`, add `group_id: window.currentlyActiveBrowserstackGroupId ?? null` to the `data` object, a sibling of `browserstack_user_id`.
3. **`sub_group_id`**: intentionally **not** emitted — no sub-group source in Interceptor billing. Commented in `eds.ts` as future-consumable if Team-level (sub_group) reports are ever needed.

**Field name / shape:** `group_id` (snake_case), a **top-level `data.*` field** (queried like `browserstack_user_id`, i.e. `e.group_id`, not `JSON_VALUE(event_details,'$.group_id')`). RQ stores the id as a string; the API Client emits a number — for BigQuery this is uniform.

**Null behavior:** users with no BS-linked billing team (email/Firebase-only, or unlinked) → `group_id = null`, matching the canonical `/me` behavior. Personal-workspace events still carry the user's `group_id` (the group is user-linked, not workspace-linked) — the personal-workspace *reporting* decision is 3.8.

## Verification

Replicate the API Client's `_qa` marker rig (RQ-4684 / PR #3482 in `requestly-api-client`): an **env-gated** marker stamped into the event payload so locally-driven test events are filterable in BigQuery and excludable from customer reports (`AND JSON_VALUE(event_details,'$._qa') IS NULL`). The terminal EDS→BigQuery sink is not observable from this repo (PostHog integration commented out, `local` is a no-op, only GA gtag live) — confirming/documenting it is **3.6 (RQ-4680)**, on which reliable end-to-end verification of 3.1/3.3/3.5 depends.

## Stacked-PR plan (base → `master`)

| Subtask | Ticket | What |
| --- | --- | --- |
| 3.1 | RQ-4675 | `group_id` onto every event (this design) — **first stacked PR** |
| 3.2 | RQ-4676 | `sharedList_updated` event |
| 3.3 | RQ-4677 | explicit `product_name = requestly_interceptor` |
| 3.4 | RQ-4678 | reconcile extension-popup `rule_toggled` payload |
| 3.5 | RQ-4679 | `super_user_id` staff-impersonation flag |
| 3.6 | RQ-4680 | confirm & document the EDS→BigQuery sink |
| 3.7 | RQ-4681 | `browserstack_user_id` coverage (Firebase-uid → BS-user fallback) |
| 3.8 | RQ-4682 | personal-workspace (`workspaceId=null`) attribution decision |

Interceptor-side subtasks stack **linearly** on this base (each branches off the previous, merges down in turn). Note the emission half of 3.1/3.3 (`group_id`, `product_name`) and 3.5 (`super_user_id`) lands in the `requestly-cloud` `webapp` overlay (`eds.ts`), **not** this repo's `analytics/index.js` — those touch the same overlay file, so their `requestly-cloud` PRs must be coordinated there too. 3.1's emission half = `requestly-cloud` PR #861.
