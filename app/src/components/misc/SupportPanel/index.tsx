import { CloseOutlined, GithubOutlined, SlackOutlined } from "@ant-design/icons";
import { Badge, Button, Dropdown } from "antd";
import { useEffect, useMemo, useState } from "react";
import { PiChatTeardropTextFill } from "@react-icons/all-files/pi/PiChatTeardropTextFill";
import { BsFillChatLeftTextFill } from "@react-icons/all-files/bs/BsFillChatLeftTextFill";
import { TbMailForward } from "@react-icons/all-files/tb/TbMailForward";
import "./supportPanel.scss";
//@ts-ignore
import { CONSTANTS as GLOBAL_CONSTANTS } from "@requestly/requestly-core";
import { getIsSupportChatOpened } from "store/selectors";
import { getUserAuthDetails } from "store/slices/global/user/selectors";
import { useDispatch, useSelector } from "react-redux";
import { globalActions } from "store/slices/global/slice";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import useFetchSlackInviteVisibility from "./useSlackInviteVisibility";
import sendSlackInvite from "./sendSlackInvite";
import { trackEvent } from "modules/analytics";
import {
  trackSlackButtonVisible,
  trackSupportOptionClicked,
  trackSupportOptionOpened,
} from "modules/analytics/events/misc/UnifiedSupport";
import LINKS from "config/constants/sub/links";

const SupportPanel = () => {
  const user = useSelector(getUserAuthDetails);
  const dispatch = useDispatch();
  const [isPanelVisible, setIsPanelVisible] = useState(false);
  const paidUser = user.loggedIn && user.details?.isPremium;
  const isSlackConnectOn = useFeatureIsOn("slack_connect");
  const isSlackInviteVisible = useFetchSlackInviteVisibility();
  const isSupportChatOpened = useSelector(getIsSupportChatOpened);
  useEffect(() => {
    isSlackConnectOn && isSlackInviteVisible && trackSlackButtonVisible();
  }, [isSlackInviteVisible, isSlackConnectOn]);
  const supportItems = useMemo(
    () =>
      [
        isSlackConnectOn &&
          isSlackInviteVisible && {
            key: "1",
            label: (
              <div
                className="support-panel-item-style"
                onClick={() => {
                  setIsPanelVisible(false);
                  sendSlackInvite();
                  trackSupportOptionClicked("slack");
                  trackEvent("join_slack_connect_clicked", {
                    source: "support_option",
                  });
                }}
              >
                <span className="support-panel-label-style">Ask us on Slack</span>
              </div>
            ),
            icon: <SlackOutlined className="support-panel-icon-style" />,
          },
        {
          key: "2",
          label: (
            <a
              href={LINKS.REQUESTLY_GITHUB_ISSUES}
              target="_blank"
              rel="noreferrer"
              className="support-panel-item-style"
              onClick={() => {
                setIsPanelVisible(false);
                trackSupportOptionClicked("github");
              }}
            >
              <span className="support-panel-label-style">Report an issue on GitHub</span>
            </a>
          ),
          icon: <GithubOutlined className="support-panel-icon-style" />,
        },
        {
          key: "4",
          label: (
            <div
              className="support-panel-item-style"
              onClick={() => {
                window?.$crisp?.push(["do", "chat:open"]);
                trackSupportOptionClicked("chat_with_us");
              }}
            >
              <span className="support-panel-label-style">Chat With Us</span>
            </div>
          ),
          icon: <BsFillChatLeftTextFill className="support-panel-icon-style" />,
        },

        !isSlackInviteVisible &&
          user.loggedIn &&
          !paidUser && {
            key: "5",
            label: (
              <a
                href={"mailto:" + GLOBAL_CONSTANTS.COMPANY_INFO.SUPPORT_EMAIL}
                target="_blank"
                rel="noreferrer"
                className="support-panel-item-style"
                onClick={() => {
                  setIsPanelVisible(false);
                  trackSupportOptionClicked("send_message");
                }}
              >
                <span className="support-panel-label-style ">Send Message</span>
              </a>
            ),
            icon: <TbMailForward className="support-panel-icon-style" />,
          },
      ].filter(Boolean),
    [dispatch, paidUser, isSlackConnectOn, isSlackInviteVisible, user.loggedIn]
  );
  return (
    <div className="support-panel-container">
      <Dropdown
        menu={{ items: supportItems }}
        trigger={["click"]}
        onOpenChange={(state) => setIsPanelVisible(state)}
        dropdownRender={(menu) => {
          return <div className="support-panel-dropown-container">{menu}</div>;
        }}
      >
        <Badge dot={!isSupportChatOpened} size="small">
          <Button
            type="primary"
            size="large"
            shape="circle"
            icon={isPanelVisible ? <CloseOutlined /> : <PiChatTeardropTextFill className="support-panel-icon-style " />}
            onClick={() => {
              if (isPanelVisible) window?.$crisp?.push(["do", "chat:close"]);
              trackSupportOptionOpened();
              dispatch(globalActions.updateIsSupportChatOpened(true));
            }}
          />
        </Badge>
      </Dropdown>
    </div>
  );
};

export default SupportPanel;
