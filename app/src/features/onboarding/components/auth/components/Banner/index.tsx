import { Col, Row, Typography } from "antd";
import { MdCheck } from "@react-icons/all-files/md/MdCheck";
import { CompaniesLogoBanner } from "../CompaniesLogoBanner";
import "./index.scss";

const requestlyFeatures = [
  "Work from anywhere - Sync Requestly rules & other configurations across devices",
  "Access your organization's resources, including team workspaces, shared rules and mocks.",
  "Use All features like HTTP Sessions, API Mocks, Overriding API Responses, etc.",
  "Join a Community trusted by over 200,000 customers worldwide from over 10,000",
  "It's Free!",
];

export const OnboardingAuthBanner = () => {
  return (
    <Col className="auth-banner">
      <Typography.Title level={3}>
        <span className="banner-title-highlight">
          Why Sign Up ? <img src={"/assets/media/common/yellow-highlight.svg"} alt="highlight" />
        </span>
      </Typography.Title>
      <div className="mt-20">
        {requestlyFeatures.map((feature) => (
          <Row className="banner-premium-feature-list-item">
            <MdCheck />
            <span className="feature-text">{feature}</span>
          </Row>
        ))}
      </div>
      <CompaniesLogoBanner />
    </Col>
  );
};
