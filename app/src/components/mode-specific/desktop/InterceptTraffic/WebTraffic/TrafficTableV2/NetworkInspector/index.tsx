import React from "react";
import { AutoThemeProvider } from "@devtools-ds/themes";

import NetworkTable from "./NetworkTable";

interface Props {
  logs: any;
  onRow: Function;
  isStaticPreview: boolean;
  setSelectedMockRequests: Function;
  showMockRequestSelector: boolean;
  selectedMockRequests: Record<string, any>;
  selectedRowId: string | null;
  onSelectedRowChange: (id: string | null) => void;
}

const NetworkInspector: React.FC<Props> = (props) => {
  return (
    <AutoThemeProvider colorScheme={"dark"} style={{ height: "100%" }}>
      <NetworkTable
        logs={props.logs}
        onRow={props.onRow}
        isStaticPreview={props.isStaticPreview}
        setSelectedMockRequests={props.setSelectedMockRequests}
        showMockRequestSelector={props.showMockRequestSelector}
        selectedMockRequests={props.selectedMockRequests}
        selectedRowId={props.selectedRowId}
        onSelectedRowChange={props.onSelectedRowChange}
      />
    </AutoThemeProvider>
  );
};

export default NetworkInspector;
