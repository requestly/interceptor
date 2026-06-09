import React from "react";
import { createRoot } from "react-dom/client";
import NetworkRecordingPanel from "./NetworkRecordingPanel";
import "./index.css";

const root = createRoot(document.getElementById("root"));
root.render(<NetworkRecordingPanel />);
