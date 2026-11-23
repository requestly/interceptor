import React from "react";
import { useNavigate } from "react-router-dom";
import { RQButton, RQModal } from "lib/design-system/components";
import { redirectToRoot } from "utils/RedirectionUtils";

/*
  The AppSumo lifetime deal has ended. Code redemption was removed from the
  backend (requestly-cloud #898, RQ-9422), so this page only tells visitors
  that the offer is over.
*/
const AppSumoModal: React.FC = () => {
  const navigate = useNavigate();

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
      <div className="rq-modal-content">
        <div className="header">The AppSumo offer has ended</div>
        <p className="text-gray">AppSumo codes can no longer be redeemed.</p>
        <RQButton type="primary" className="mt-16" onClick={() => redirectToRoot(navigate)}>
          Go to Requestly
        </RQButton>
      </div>
    </RQModal>
  );
};

export default AppSumoModal;
