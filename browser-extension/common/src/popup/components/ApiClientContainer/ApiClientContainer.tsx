import React from "react";
import { Row } from "antd";
import { PrimaryActionButton } from "../common/PrimaryActionButton";
import { EVENT, sendEvent } from "../../events";
import "./apiClientContainer.scss";

const API_CLIENT_DOWNLOAD_URL = "https://requestly.com/downloads/";

export const ApiClientContainer: React.FC = () => {
  const handleInstallClick = () => {
    sendEvent(EVENT.API_CLIENT_DOWNLOAD_CLICKED);
    window.open(API_CLIENT_DOWNLOAD_URL, "_blank");
  };

  return (
    <div className="apiclient-view-container popup-body-card">
      <Row align="middle" justify="space-between" wrap={false}>
        <div className="api-client-text">
          <div className="heading">Requestly API Client</div>
          <div className="subtitle">Manage, Create, Test &amp; Design APIs in a dedicated desktop app.</div>
        </div>
        <PrimaryActionButton size="small" onClick={handleInstallClick}>
          Download
        </PrimaryActionButton>
      </Row>
    </div>
  );
};
