import { BillingTeamDetails } from "features/settings/components/BillingTeam/types";
import { ReducerKeys } from "store/constants";
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

/**
 * Returns `undefined` when the members for `billingId` have not been fetched (or the fetch failed) —
 * callers must handle it. Note the `!billingId` branch below predates this and returns `{}` instead;
 * that inconsistency is left alone rather than widened here.
 *
 * Deliberately NOT defaulted to `{}`, because BillingTeamMembers and OtherBillingTeamDetails both
 * drive an antd `<Table loading={!billingTeamMembers} />`, and a truthy empty object silently swaps
 * those spinners for an empty-state. A fresh `{}` per call would additionally re-render both on every
 * dispatched action while members are absent; that part is avoidable with a shared constant, the
 * loading-state regression is not.
 */
export const getBillingTeamMembers = (billingId: string | undefined) => (
  state: RootState
): Record<string, any> | undefined => {
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
