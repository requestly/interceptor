import { BillingTeamDetails } from "features/settings/components/BillingTeam/types";
import { ReducerKeys } from "store/constants";
import { getUserAuthDetails } from "store/slices/global/user/selectors";
import { RootState } from "store/types";

export const getAvailableBillingTeams = (state: RootState): BillingTeamDetails[] => {
  return state[ReducerKeys.BILLING].availableBillingTeams;
};

export const getBillingTeamById = (id: string | undefined) => (state: RootState): BillingTeamDetails | undefined => {
  if (!id) {
    return;
  }

  const allAvailableBillingTeams = getAvailableBillingTeams(state);
  return allAvailableBillingTeams.find((billingTeam) => billingTeam.id === id);
};

export const getBillingTeamMembers = (billingId: string | undefined) => (state: RootState): Record<string, any> => {
  if (!billingId) {
    return {};
  }

  return state[ReducerKeys.BILLING].billingTeamMembers[billingId];
};

export const getBillingTeamMemberById = (billingId: string, memberId: string) => (
  state: RootState
): Record<string, any> => {
  return state[ReducerKeys.BILLING]?.billingTeamMembers[billingId]?.[memberId];
};

export const getIsBillingTeamsLoading = (state: RootState): boolean => {
  return state[ReducerKeys.BILLING].isBillingTeamsLoading;
};

/**
 * Pure resolver for the signed-in user's BrowserStack group id from their
 * billing teams. A BrowserStack-synced user belongs to exactly one
 * `browserstack-<groupId>` billing team (requestly-cloud userSync guarantees
 * this — see the design doc), so we prefer a team the user is an actual
 * MEMBER of (over domain-matched teams the billing listener also pulls in),
 * falling back to any team carrying a `browserstackGroupId`. Returns `null`
 * when the user has no BS-linked billing team (email/Firebase-only or
 * unlinked). Extracted from the selector so it can be unit-tested without a
 * full RootState. See RQ-4675.
 */
export const pickUserBrowserstackGroupId = (
  billingTeams: BillingTeamDetails[] | undefined,
  uid: string | undefined
): string | null => {
  if (!uid || !billingTeams?.length) {
    return null;
  }

  const memberTeam = billingTeams.find(
    (team) => Boolean(team.browserstackGroupId) && Boolean(team.members) && uid in team.members
  );
  if (memberTeam?.browserstackGroupId) {
    return memberTeam.browserstackGroupId;
  }

  const anyTeamWithGroup = billingTeams.find((team) => Boolean(team.browserstackGroupId));
  return anyTeamWithGroup?.browserstackGroupId ?? null;
};

/**
 * The signed-in user's BrowserStack group id (from their BS-linked billing
 * team), or `null`. Feeds BrowserStack Usage Reports group attribution
 * (RQ-4675) via `useBrowserstackGroupId` → the analytics enrichment choke-point.
 */
export const getUserBrowserstackGroupId = (state: RootState): string | null => {
  return pickUserBrowserstackGroupId(
    getAvailableBillingTeams(state),
    getUserAuthDetails(state)?.details?.profile?.uid
  );
};
