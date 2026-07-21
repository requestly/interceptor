import { describe, it, expect } from "vitest";

import { BillingTeamDetails, BillingTeamRoles } from "features/settings/components/BillingTeam/types";
import { pickUserBrowserstackGroupId } from "./selectors";

const UID = "user-123";

const team = (overrides: Partial<BillingTeamDetails>): BillingTeamDetails =>
  ({
    id: "team-1",
    name: "Team",
    description: "",
    owner: "owner",
    subscriptionDetails: {},
    members: {},
    seats: 5,
    ...overrides,
  } as BillingTeamDetails);

describe("pickUserBrowserstackGroupId", () => {
  it("returns the browserstackGroupId of the team the user is a member of", () => {
    const teams = [
      team({
        id: "browserstack-777",
        browserstackGroupId: "777",
        members: { [UID]: { role: BillingTeamRoles.Admin, joiningDate: 0 } },
      }),
    ];
    expect(pickUserBrowserstackGroupId(teams, UID)).toBe("777");
  });

  it("prefers the team the user is a MEMBER of over a domain-matched team", () => {
    const teams = [
      // domain-matched team the listener also pulls in — user is NOT a member
      team({ id: "browserstack-111", browserstackGroupId: "111", members: {} }),
      // the user's actual team
      team({
        id: "browserstack-222",
        browserstackGroupId: "222",
        members: { [UID]: { role: BillingTeamRoles.Member, joiningDate: 0 } },
      }),
    ];
    expect(pickUserBrowserstackGroupId(teams, UID)).toBe("222");
  });

  it("falls back to any team carrying a browserstackGroupId when the user is not a member of one", () => {
    const teams = [
      team({ id: "browserstack-333", browserstackGroupId: "333", members: {} }),
    ];
    expect(pickUserBrowserstackGroupId(teams, UID)).toBe("333");
  });

  it("ignores non-BrowserStack billing teams (no browserstackGroupId)", () => {
    const teams = [
      team({ id: "stripe-team", members: { [UID]: { role: BillingTeamRoles.Manager, joiningDate: 0 } } }),
    ];
    expect(pickUserBrowserstackGroupId(teams, UID)).toBeNull();
  });

  it("returns null when there are no billing teams", () => {
    expect(pickUserBrowserstackGroupId([], UID)).toBeNull();
    expect(pickUserBrowserstackGroupId(undefined, UID)).toBeNull();
  });

  it("returns null when there is no signed-in uid", () => {
    const teams = [team({ browserstackGroupId: "999", members: {} })];
    expect(pickUserBrowserstackGroupId(teams, undefined)).toBeNull();
  });
});
