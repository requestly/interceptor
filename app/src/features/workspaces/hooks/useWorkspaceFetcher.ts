import { useEffect } from "react";
import { useFetchTeamWorkspaces } from "./useFetchTeamWorkspaces";
import { useDispatch, useSelector } from "react-redux";
import { workspaceActions } from "store/slices/workspaces/slice";
import { useActiveWorkspacesMembersListener } from "./useActiveWorkspaceMembersListener";
import { getUserAuthDetails } from "store/slices/global/user/selectors";
import { getActiveWorkspace } from "store/slices/workspaces/selectors";
import { WorkspaceType } from "features/workspaces/types";
import { getAppMode } from "store/selectors";
import { clearCurrentlyActiveWorkspace } from "actions/TeamWorkspaceActions";
import { captureException } from "@sentry/react";

export const useWorkspaceFetcher = () => {
  const dispatch = useDispatch();
  const user = useSelector(getUserAuthDetails);
  const activeWorkspace = useSelector(getActiveWorkspace);
  const appMode = useSelector(getAppMode);

  const { sharedWorkspaces } = useFetchTeamWorkspaces();
  useActiveWorkspacesMembersListener();

  useEffect(() => {
    // LOCAL (file-system) workspaces are hidden from the UI (RQ-4696): they only
    // ever backed the API Client, which has been removed. We no longer fetch or
    // inject them, so nothing that reads `allWorkspaces` (dropdown, overlay,
    // settings) surfaces a LOCAL workspace. On-disk data is untouched, and
    // LOCAL_STORAGE (logged-out) is unaffected — it flows through its own path.
    try {
      dispatch(workspaceActions.setAllWorkspaces([...sharedWorkspaces]));
    } catch (e) {
      captureException(e);
    }
  }, [dispatch, sharedWorkspaces]);

  useEffect(() => {
    if (!user.loggedIn) {
      if (!activeWorkspace || activeWorkspace?.workspaceType === WorkspaceType.SHARED) {
        clearCurrentlyActiveWorkspace(dispatch, appMode);
      }
    }
  }, [activeWorkspace, appMode, dispatch, user.loggedIn]);
};
