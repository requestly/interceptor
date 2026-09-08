import React, { useEffect, useState } from "react";
import { Modal, Radio, RadioChangeEvent } from "antd";
import { toast } from "utils/Toast";
import "./devScriptMode.scss";

const GET_ACTION = "USER_PREFERENCE:GET_DEV_SCRIPT_MODE";
const SET_ACTION = "USER_PREFERENCE:UPDATE_DEV_SCRIPT_MODE";

type ScriptMode = "safe" | "dev";

function storageAction(type: string, data?: any): Promise<any> {
  return (window as any)?.RQ?.DESKTOP?.SERVICES?.IPC?.invokeEventInMain("rq-storage:storage-action", {
    type,
    payload: data !== undefined ? { data } : {},
  });
}

/**
 * RQ-2426: desktop-only selector for how Dynamic (JavaScript) request/response rules
 * execute in the proxy.
 *
 *   Safe Mode (default) → QuickJS-WASM sandbox, no host access.
 *   Developer Mode      → legacy full host access (require/process/fs/child_process).
 *
 * Inline radio selector; the chosen mode is applied immediately, persisted in the
 * desktop user-preference store and applied live on the running proxy (no restart).
 */
const DevScriptMode: React.FC = () => {
  const [mode, setMode] = useState<ScriptMode>("safe");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    storageAction(GET_ACTION)
      ?.then((res: boolean) => setMode(res ? "dev" : "safe"))
      .catch(() => {});
  }, []);

  const applyMode = async (next: ScriptMode) => {
    const prev = mode;
    setMode(next); // optimistic
    setLoading(true);
    try {
      await storageAction(SET_ACTION, { devScriptMode: next === "dev" });
      toast.success(
        next === "dev"
          ? "Developer Mode enabled — rule scripts now run with full system access."
          : "Safe Mode restored — rule scripts run inside the secure sandbox."
      );
    } catch (err) {
      setMode(prev); // revert on failure
      toast.error("Failed to update script execution mode");
    } finally {
      setLoading(false);
    }
  };

  const onChange = (e: RadioChangeEvent) => {
    const next = e.target.value as ScriptMode;
    if (next === mode || loading) return;

    if (next === "dev") {
      // Switching to full-access execution — warn before applying. The radio stays on
      // the current value until the user confirms (Cancel is a no-op).
      Modal.confirm({
        title: "Switch to Developer Mode?",
        content:
          "Rule scripts will run with FULL system access — they can read and write your files, execute system commands, and access sensitive information. A shared or imported rule could run arbitrary code on your machine. Only enable this for scripts you fully trust.",
        okText: "Enable Developer Mode",
        okButtonProps: { danger: true },
        cancelText: "Cancel",
        width: 460,
        onOk: () => applyMode("dev"),
      });
      return;
    }

    applyMode("safe");
  };

  return (
    <div className="w-full mt-16 setting-item-container dev-script-mode-setting">
      <div className="title">Script execution mode</div>
      <p className="setting-item-caption">
        Dynamic (JavaScript) request/response rules run code in the desktop proxy. Choose the security level for that
        execution.
      </p>

      <Radio.Group className="dev-script-mode-selector" value={mode} onChange={onChange} disabled={loading}>
        <Radio value="safe" className="dev-script-mode-option">
          <span className="dev-script-mode-option__title">
            Safe Mode <span className="dev-script-mode-option__tag">Default</span>
          </span>
          <span className="dev-script-mode-option__desc">
            Rule scripts run in a secure sandbox and cannot access your filesystem or execute system commands.
          </span>
        </Radio>

        <Radio value="dev" className="dev-script-mode-option">
          <span className="dev-script-mode-option__title">
            Developer Mode{" "}
            <span className="dev-script-mode-option__caveat">(use only if you trust the rule authors)</span>
          </span>
          <span className="dev-script-mode-option__desc">
            Rule scripts have access to the filesystem, can execute system commands, and access sensitive information.
          </span>
        </Radio>
      </Radio.Group>
    </div>
  );
};

export default DevScriptMode;
