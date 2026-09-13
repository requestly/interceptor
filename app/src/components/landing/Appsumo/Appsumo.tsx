import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { getAppMode } from "store/selectors";
import { Row } from "antd";
import APP_CONSTANTS from "config/constants";
import { RQButton, RQInput, RQModal } from "lib/design-system/components";
import { ImCross } from "@react-icons/all-files/im/ImCross";
import { MdOutlineVerified } from "@react-icons/all-files/md/MdOutlineVerified";
import { FiXCircle } from "@react-icons/all-files/fi/FiXCircle";
import { useNavigate } from "react-router-dom";
import { redirectToRoot } from "utils/RedirectionUtils";
import AppSumoWorkspaceDropdown from "components/landing/Appsumo/AppSumoWorkspaceDropdown/AppSumoWorkspaceDropdown";
import { toast } from "utils/Toast";
import { isEmailValid } from "utils/FormattingHelper";
import { useDebounce } from "hooks/useDebounce";
import { httpsCallable, getFunctions } from "firebase/functions";
import { trackNewTeamCreateSuccess } from "modules/analytics/events/features/teams";
import { trackAppsumoCodeRedeemed } from "modules/analytics/events/misc/business";
import { switchWorkspace } from "actions/TeamWorkspaceActions";
import { globalActions } from "store/slices/global/slice";
import "./index.scss";
import { getAllWorkspaces } from "store/slices/workspaces/selectors";
import { WorkspaceType } from "features/workspaces/types";

interface AppSumoCode {
  error: string;
  code: string;
  verified: boolean;
}

const DEFAULT_APPSUMO_INPUT: AppSumoCode = {
  error: "",
  code: "",
  verified: false,
};

const AppSumoModal: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const appMode = useSelector(getAppMode);
  const availableWorkspaces = useSelector(getAllWorkspaces);
  const [appsumoCodes, setAppsumoCodes] = useState<AppSumoCode[]>([{ ...DEFAULT_APPSUMO_INPUT }]);
  const [userEmail, setUserEmail] = useState<string>("");
  const [emailValidationError, setEmailValidationError] = useState<string | null>(null);
  const [workspaceToUpgrade, setWorkspaceToUpgrade] = useState(APP_CONSTANTS.TEAM_WORKSPACES.NEW_WORKSPACE);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdatingSubscription, setIsUpdatingSubscription] = useState(false);
  const [showMaxCodesExeceededError, setShowMaxCodesExeceededError] = useState(false);

  const addAppSumoCodeInput = () => {
    if (appsumoCodes.length >= 10) {
      setShowMaxCodesExeceededError(true);
      return;
    }
    setAppsumoCodes((prev) => [...prev, { ...DEFAULT_APPSUMO_INPUT }]);
  };

  const removeAppSumoCodeInput = (index: number) => {
    if (appsumoCodes.length === 1) return;
    setAppsumoCodes((prev) => {
      const codes = [...prev];
      codes.splice(index, 1);
      return codes;
    });
  };

  const isAllCodeCheckPassed = useMemo(() => appsumoCodes.every((code) => code.verified), [appsumoCodes]);

  const updateAppSumoCode = (index: number, key: keyof AppSumoCode, value: AppSumoCode[typeof key]) => {
    setAppsumoCodes((prev) => {
      const codes: AppSumoCode[] = [...prev];
      if (codes[index]) {
        (codes[index] as any)[key] = value;
      }
      return codes;
    });
  };

  const debouncedVerifyCode = useDebounce((enteredCode: string, index: number) => verifyCode(enteredCode, index));

  const verifyCode = useCallback(
    async (enteredCode: string, index: number) => {
      if (enteredCode.length < 8) {
        updateAppSumoCode(index, "verified", false);
        return;
      }

      const codeOccurence = appsumoCodes.filter((appsumoCode: AppSumoCode) => appsumoCode.code === enteredCode).length;
      if (codeOccurence > 1) {
        updateAppSumoCode(index, "error", "Code already used");
        updateAppSumoCode(index, "verified", false);
        return;
      }

      // RQ-3893: the server validates now. This used to read `appSumoCodes/{code}`
      // straight from the browser, which forced the Firestore rules to let every
      // authenticated user read the collection — and a wildcard read also grants
      // `list`, so the entire licence table was enumerable. The callable returns a
      // verdict only for the code the user typed.
      const validateAppSumoCodes = httpsCallable<
        { codes: string[] },
        { success: boolean; message?: string; checks?: { code: string; valid: boolean; reason?: string }[] }
      >(getFunctions(), "subscription-validateAppSumoCodes");

      try {
        const response = await validateAppSumoCodes({ codes: [enteredCode] });
        const verdict = response?.data?.checks?.find((check) => check.code === enteredCode);

        if (!response?.data?.success || !verdict) {
          updateAppSumoCode(index, "error", "Could not verify this code, please try again");
          updateAppSumoCode(index, "verified", false);
          return;
        }

        if (!verdict.valid) {
          updateAppSumoCode(
            index,
            "error",
            verdict.reason === "already_redeemed" ? "Code already redeemed" : "Invalid code"
          );
          updateAppSumoCode(index, "verified", false);
          return;
        }
      } catch {
        updateAppSumoCode(index, "error", "Could not verify this code, please try again");
        updateAppSumoCode(index, "verified", false);
        return;
      }

      updateAppSumoCode(index, "error", "");
      updateAppSumoCode(index, "verified", true);
    },
    [appsumoCodes]
  );

  const createNewWorkspaceForAppSumo = useCallback(async () => {
    setIsLoading(true);

    const newTeamName = "Team Workspace";
    const createTeam = httpsCallable(getFunctions(), "teams-createTeam");
    try {
      const response: any = await createTeam({ teamName: newTeamName });
      trackNewTeamCreateSuccess(response?.data?.teamId, newTeamName, "appsumo", WorkspaceType.SHARED);
      switchWorkspace(
        {
          teamId: response?.data?.teamId,
          teamMembersCount: 1,
        },
        dispatch,
        {
          isWorkspaceMode: false,
          isSyncEnabled: true,
        },
        appMode,
        null,
        "appsumo"
      );

      setIsLoading(false);
      return response?.data?.teamId;
    } catch (error) {
      // do nothing
    }
  }, [appMode, dispatch]);

  const onSubmit = useCallback(async () => {
    if (!isAllCodeCheckPassed || emailValidationError) {
      toast.warn("Please fill all the fields correctly", 10);
      throw new Error("Please fill all the fields correctly");
    }
    setIsUpdatingSubscription(true);

    let teamId = workspaceToUpgrade.id;
    if (workspaceToUpgrade.id === APP_CONSTANTS.TEAM_WORKSPACES.NEW_WORKSPACE.id) {
      teamId = await createNewWorkspaceForAppSumo();
    }

    const updateTeamSubscriptionForAppSumo = httpsCallable<{}, { success: boolean; message: string; error?: string }>(
      getFunctions(),
      "subscription-updateTeamSubscriptionForAppSumo"
    );

    try {
      await updateTeamSubscriptionForAppSumo({
        teamId: teamId,
        startDate: Date.now(),
        appsumoCodes: appsumoCodes.map((code) => code.code),
      })
        .then((response) => {
          if (!response?.data?.success && response?.data?.error === "max_limit_reached") {
            setShowMaxCodesExeceededError(true);
          } else if (!response?.data?.success) {
            // RQ-3893: previously any unsuccessful response that was not
            // `max_limit_reached` fell into the success branch below and showed an
            // "unlocked" toast for a redemption that never happened.
            toast.error(response?.data?.message || "Could not redeem these codes, please try again", 10);
          } else {
            // RQ-3893: the codes are marked redeemed by the callable, inside the same
            // transaction that grants the tier. The browser used to do it afterwards
            // in an un-awaited batch write, so a failure there was silent and left the
            // codes reusable.
            trackAppsumoCodeRedeemed(appsumoCodes.length);
            toast.success(
              `Lifetime access to SessionBook Plus unlocked for ${
                appsumoCodes.length > 1 ? `${appsumoCodes.length} members` : "you"
              }`,
              10
            );
            redirectToRoot(navigate);
          }
        })
        .finally(() => {
          setIsUpdatingSubscription(false);
        });
    } catch (error) {
      console.error("from appsumo", error);
      setIsUpdatingSubscription(false);
      toast.error("Could not redeem these codes, please try again", 10);
    }
  }, [
    createNewWorkspaceForAppSumo,
    appsumoCodes,
    emailValidationError,
    isAllCodeCheckPassed,
    workspaceToUpgrade?.id,
    navigate,
  ]);

  const handleEmailValidation = (email: string) => {
    if (!email) {
      setEmailValidationError("Please add your Appsumo email address");
      return;
    }
    if (!isEmailValid(email)) {
      setEmailValidationError("Please enter a valid email address");
      return;
    }
    setEmailValidationError(null);
  };

  const debouncedEmailValidation = useDebounce((email: string) => handleEmailValidation(email));

  const handleUnlockDealClick = async () => {
    setShowMaxCodesExeceededError(false);
    try {
      await onSubmit();
    } catch (error) {
      // do nothing
    }
  };

  useEffect(() => {
    const appsumoWorkspace = availableWorkspaces?.find((team: any) => team?.appsumo);
    if (appsumoWorkspace) {
      setWorkspaceToUpgrade(appsumoWorkspace as any);
    }
  }, [availableWorkspaces]);

  useEffect(() => {
    dispatch(globalActions.updateIsWorkspaceOnboardingCompleted());
  }, [dispatch]);

  return (
    <RQModal
      width={620}
      bodyStyle={{ height: "auto" }}
      centered
      open={true}
      closable={false}
      maskClosable={false}
      maskStyle={{ background: "#0d0d10ef" }}
      keyboard={false}
    >
      <>
        <div className="rq-modal-content appsumo-modal">
          <div>
            <img alt="smile" width="48px" height="44px" src="/assets/media/common/smiles.svg" />
          </div>
          <div className="header mt-16">Please enter your AppSumo code</div>
          <p className="text-gray">Unlock lifetime deal for SessionBook Plus</p>
          <AppSumoWorkspaceDropdown
            isAppSumo
            disabled={isLoading}
            workspaceToUpgrade={workspaceToUpgrade}
            setWorkspaceToUpgrade={setWorkspaceToUpgrade}
          />
          <div className="title mt-16">AppSumo email address</div>
          <div className="items-center mt-8">
            <div className="w-full">
              <RQInput
                className="w-full"
                value={userEmail}
                onChange={(e) => {
                  setUserEmail(e.target.value);
                  debouncedEmailValidation(e.target.value);
                }}
                placeholder="Enter email address here"
              />
              <div className="danger caption">{emailValidationError}</div>
            </div>
          </div>
          <div className="title mt-16">AppSumo Code(s)</div>
          {appsumoCodes.map((appsumoCode, index) => (
            <div className="display-flex" key={index}>
              <div className="appsumo-code-input-container">
                <RQInput
                  value={appsumoCode.code}
                  key={index}
                  onChange={(e) => {
                    updateAppSumoCode(index, "code", e.target.value);
                    debouncedVerifyCode(e.target.value, index);
                  }}
                  suffix={
                    appsumoCode.verified ? (
                      <MdOutlineVerified />
                    ) : appsumoCode.error ? (
                      <>
                        <span className="danger caption">{appsumoCode.error}</span>
                        <FiXCircle className="danger" />
                      </>
                    ) : null
                  }
                  placeholder="Enter code here"
                />
              </div>

              <div className={`remove-icon ${appsumoCodes.length === 1 ? "cursor-disabled" : "cursor-pointer"}`}>
                <ImCross
                  id="delete-pair"
                  className="text-gray"
                  onClick={() => {
                    removeAppSumoCodeInput(index);
                  }}
                />
              </div>
            </div>
          ))}

          <RQButton className="appsumo-add-btn" type="link" onClick={addAppSumoCodeInput}>
            + Add more codes
          </RQButton>
          {showMaxCodesExeceededError && (
            <div className="danger caption">
              {
                "Maximum 10 AppSumo codes can be applied. Please connect with support for further help at contact@requestly.io"
              }
            </div>
          )}
        </div>
        <Row className="rq-modal-footer" justify={"end"}>
          <RQButton
            type="primary"
            disabled={!isAllCodeCheckPassed || !!emailValidationError}
            loading={isUpdatingSubscription}
            onClick={handleUnlockDealClick}
          >
            Unlock Deal
          </RQButton>
        </Row>
      </>
    </RQModal>
  );
};

export default AppSumoModal;
