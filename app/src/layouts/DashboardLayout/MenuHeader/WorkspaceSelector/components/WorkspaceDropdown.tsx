import { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { DownOutlined } from "@ant-design/icons";
import { getAppMode } from "store/selectors";
import { Dropdown, Tooltip } from "antd";
import WorkspaceAvatar from "features/workspaces/components/WorkspaceAvatar";
import { trackTopbarClicked } from "modules/analytics/events/common/onboarding/header";
import { getActiveWorkspace } from "store/slices/workspaces/selectors";
import { Invite } from "types";
import { WorkspacesOverlay } from "./WorkspacesOverlay/WorkspacesOverlay";
import { MultiWorkspaceAvatarGroup } from "../MultiWorkspaceAvatarGroup";
import { CONSTANTS as GLOBAL_CONSTANTS } from "@requestly/requestly-core";
import { getUserAuthDetails } from "store/slices/global/user/selectors";
import { ApiClientViewMode, useViewMode } from "features/apiClient/slices";

const prettifyWorkspaceName = (workspaceName: string) => {
  // if (workspaceName === APP_CONSTANTS.TEAM_WORKSPACES.NAMES.PRIVATE_WORKSPACE)
  //   return "Private";
  return workspaceName || "Unknown";
};

const WorkSpaceDropDown = ({ teamInvites }: { teamInvites: Invite[] }) => {
  // Global State
  const appMode = useSelector(getAppMode);
  const user = useSelector(getUserAuthDetails);
  const activeWorkspace = useSelector(getActiveWorkspace);
  const viewMode = useViewMode();

  // Local State
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const activeWorkspaceName = useMemo(() => {
    if (!activeWorkspace?.id) {
      return user.loggedIn ? "Private Workspace" : "Workspaces";
    } else {
      return activeWorkspace?.name;
    }
  }, [activeWorkspace?.id, activeWorkspace?.name, user.loggedIn]);

  const handleWorkspaceDropdownClick = (open: boolean) => {
    setIsDropdownOpen(open);
    if (open) {
      trackTopbarClicked("workspace");
    }
  };

  const toggleDropdown = () => {
    setIsDropdownOpen((prev) => !prev);
  };

  const tooltipTitle =
    viewMode === ApiClientViewMode.MULTI ? null : prettifyWorkspaceName(activeWorkspaceName);

  return (
    <>
      <Dropdown
        overlay={<WorkspacesOverlay toggleDropdown={toggleDropdown} teamInvites={teamInvites} />}
        trigger={["click"]}
        className="workspace-selector-dropdown no-drag"
        open={isDropdownOpen}
        onOpenChange={handleWorkspaceDropdownClick}
      >
        <div
          className="workspace-selector-dropdown__content"
          style={{ marginLeft: appMode === GLOBAL_CONSTANTS.APP_MODES.DESKTOP ? "8px" : "0px" }}
        >
          <Tooltip
            overlayClassName="workspace-selector-tooltip"
            style={{ top: "35px" }}
            title={tooltipTitle}
            placement="right"
            showArrow={false}
            mouseEnterDelay={0.5}
            color="#000"
          >
            <div className="cursor-pointer items-center">
              {viewMode === ApiClientViewMode.MULTI ? (
                <MultiWorkspaceAvatarGroup />
              ) : (
                <WorkspaceAvatar
                  size={20}
                  workspace={{
                    ...activeWorkspace,
                    name: activeWorkspaceName ?? null,
                    workspaceType: activeWorkspace?.workspaceType ?? null,
                  }}
                />
              )}
              {viewMode === ApiClientViewMode.SINGLE && (
                <span className="items-center active-workspace-name">
                  <span className="active-workspace-text">{prettifyWorkspaceName(activeWorkspaceName)}</span>
                  <DownOutlined className="active-workspace-name-down-icon" />
                </span>
              )}
            </div>
          </Tooltip>
        </div>
      </Dropdown>
    </>
  );
};

export default WorkSpaceDropDown;
