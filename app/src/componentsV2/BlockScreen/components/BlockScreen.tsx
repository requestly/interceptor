import React, { ReactElement, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { MdLogout } from "@react-icons/all-files/md/MdLogout";
import "./blockscreen.scss";
import MinimalLayout from "layouts/MinimalLayout";
import { RQButton } from "lib/design-system-v2/components";
import { getAppMode } from "store/selectors";
import { isActiveWorkspaceShared } from "store/slices/workspaces/selectors";
import { handleLogoutButtonOnClick } from "features/onboarding/components/auth/components/Form/actions";
import { BlockConfig, BlockType } from "../hooks/useIsUserBlocked";
import { trackBlockScreenViewed } from "../analytics";

interface Props {
  blockConfig: BlockConfig;
}

const BlockComponent = ({
  logo,
  title,
  subtitle,
}: {
  logo: ReactElement;
  title: ReactElement | string;
  subtitle: ReactElement | string;
}) => {
  return (
    <div className="block-screen-message-container">
      <div className="block-screen-message-icon">{logo}</div>
      <div className="block-screen-content">
        <div className="block-screen-message-title">{title}</div>
        <div className="block-screen-message-description">{subtitle}</div>
      </div>
    </div>
  );
};

export const BlockScreen: React.FC<Props> = ({ blockConfig }) => {
  const dispatch = useDispatch();
  const appMode = useSelector(getAppMode);
  const isSharedWorkspaceMode = useSelector(isActiveWorkspaceShared);

  const blockType = Object.keys(blockConfig)?.[0];
  const config = blockConfig[blockType as BlockType];

  useEffect(() => {
    trackBlockScreenViewed(blockType);
  }, [blockType]);

  const handleSignOut = () => {
    handleLogoutButtonOnClick(appMode, isSharedWorkspaceMode, dispatch);
  };

  let blockElement = (
    <BlockComponent
      logo={<img width={56} height={56} src={"/assets/media/grr/globe-warning.svg"} alt="Blocked" />}
      title={"Blocked"}
      subtitle={"Blocked"}
    />
  );

  if (blockType === BlockType.GRR) {
    const contactEmail = config?.metadata?.contactEmail || "contact@requestly.com";
    const title = config?.metadata?.title || "Important Update on Requestly Usage";
    const contactLink = (
      <a
        target="_blank"
        rel="noreferrer"
        href={`mailto:${contactEmail}`}
        className="block-screen-message-contact-mail"
      >
        {contactEmail}
      </a>
    );

    blockElement = (
      <BlockComponent
        logo={<img width={56} height={56} src={"/assets/media/grr/globe-warning.svg"} alt="GRR warning" />}
        title={title}
        subtitle={
          config?.metadata?.message ? (
            <>
              {config.metadata.message} {contactLink}
            </>
          ) : (
            <>
              Welcome to Requestly, now part of BrowserStack! Your organization requires Data Residency, and Requestly
              is currently being updated for full compliance. For guidance on using Requestly, please reach out to your
              BrowserStack Customer Success Manager or email us at {contactLink}
            </>
          )
        }
      />
    );
  } else if (blockType === BlockType.ACCESS_DENIED) {
    blockElement = (
      <BlockComponent
        logo={
          <img
            className="block-screen-illustration"
            src={"/assets/media/apiClient/file-error.svg"}
            alt="Access denied"
          />
        }
        title={config?.metadata?.title || "You don't have access to Requestly"}
        subtitle={
          config?.metadata?.message ||
          "Your account hasn't been granted access to this product. Contact your administrator to request access, then sign in again."
        }
      />
    );
  } else if (blockType === BlockType.COMPLIANCE_ISSUE) {
    blockElement = (
      <BlockComponent
        logo={<img width={56} height={56} src={"/assets/media/grr/globe-warning.svg"} alt={blockType} />}
        title={"Requestly is currently not enabled for your Organization"}
        subtitle={
          <>
            {"To enable Requestly access, please "}
            {config?.metadata?.contactEmail ? (
              <>
                reach out to{" "}
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={`mailto:${config?.metadata?.contactEmail}`}
                  className="block-screen-message-contact-mail"
                >
                  {config?.metadata?.contactEmail}
                </a>
                {" or "}
              </>
            ) : null}
            drop us an email at
            <a
              target="_blank"
              rel="noreferrer"
              href="mailto:support@requestly.com"
              className="block-screen-message-contact-mail"
            >
              support@requestly.com
            </a>
            .
          </>
        }
      />
    );
  }

  return (
    <MinimalLayout>
      <div className="block-screen-screen">
        <div className="block-screen-content-wrapper">
          {blockElement}
          {blockType === BlockType.ACCESS_DENIED ? (
            <RQButton type="primary" onClick={handleSignOut} className="block-screen-signout-btn" icon={<MdLogout />}>
              Sign out
            </RQButton>
          ) : null}
        </div>
      </div>
    </MinimalLayout>
  );
};
