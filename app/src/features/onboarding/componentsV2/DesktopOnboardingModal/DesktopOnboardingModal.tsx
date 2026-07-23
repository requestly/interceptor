import React, { useEffect, useState } from "react";
import { Button, Modal } from "antd";
import { AuthCard } from "./components/AuthCard/AuthCard";
import { useDispatch, useSelector } from "react-redux";
import { globalActions } from "store/slices/global/slice";
import { getUserAuthDetails } from "store/slices/global/user/selectors";
import "./desktopOnboardingModal.scss";
import { trackDesktopOnboardingStepSkipped, trackDesktopOnboardingViewed } from "./analytics";
import { OnboardingStep } from "./types";

export const DesktopOnboardingCard = ({ children, className }: { children: React.ReactNode; className?: string }) => {
  return <div className={`rq-desktop-onboarding-modal-content__card ${className}`}>{children}</div>;
};

export const DesktopOnboardingModal = () => {
  const dispatch = useDispatch();
  const user = useSelector(getUserAuthDetails);
  // First-run onboarding is now a single step: sign-in/sign-up. The feature-selection
  // screen (WelcomeCard) and the local-workspace folder-selection step were removed
  // with the API Client (RQ-4695), so the step machine starts — and stays — at AUTH.
  const [onboardingStep] = useState<OnboardingStep>(OnboardingStep.AUTH);

  useEffect(() => {
    if (user.loggedIn) {
      dispatch(globalActions.updateIsOnboardingCompleted(true));
    }
  }, [dispatch, user.loggedIn]);

  useEffect(() => {
    trackDesktopOnboardingViewed(onboardingStep);
  }, [onboardingStep]);
  return (
    <Modal
      open={true}
      closable={false}
      footer={null}
      wrapClassName="rq-desktop-onboarding-modal-wrapper"
      className="rq-desktop-onboarding-modal"
    >
      <div className="rq-desktop-onboarding-modal-content">
        <DesktopOnboardingCard className="auth-card">
          <AuthCard />
        </DesktopOnboardingCard>
        <Button
          type="link"
          className="skip-desktop-onboarding"
          onClick={() => {
            trackDesktopOnboardingStepSkipped(onboardingStep);
            dispatch(globalActions.updateIsOnboardingCompleted(true));
          }}
        >
          Continue without sign in
        </Button>
      </div>
    </Modal>
  );
};
