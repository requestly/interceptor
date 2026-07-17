import React, { useEffect, useState } from "react";
import { Col, Popconfirm, Row, Switch } from "antd";
import { toast } from "utils/Toast";

const GET_ACTION = "USER_PREFERENCE:GET_DEV_SCRIPT_MODE";
const SET_ACTION = "USER_PREFERENCE:UPDATE_DEV_SCRIPT_MODE";

function storageAction(type: string, data?: any): Promise<any> {
  return (window as any)?.RQ?.DESKTOP?.SERVICES?.IPC?.invokeEventInMain("rq-storage:storage-action", {
    type,
    payload: data !== undefined ? { data } : {},
  });
}

/**
 * RQ-2426: desktop-only toggle for how "code" rules execute.
 *
 *   OFF (default) → SAFE: rule code runs in the QuickJS-WASM sandbox (no host access).
 *   ON            → DEV : rule code runs with FULL system access
 *                         (require/process/fs/child_process).
 *
 * Persisted in the desktop user-preference store and applied live on the running
 * proxy (no restart). Turning it OFF is always safe and applies immediately; turning
 * it ON requires an explicit confirmation because it re-opens an arbitrary
 * code-execution path — a shared/imported rule would then run with full privileges.
 */
const DevScriptMode: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    storageAction(GET_ACTION)
      ?.then((res: boolean) => setEnabled(!!res))
      .catch(() => {});
  }, []);

  const applyMode = async (checked: boolean) => {
    setLoading(true);
    try {
      await storageAction(SET_ACTION, { devScriptMode: checked });
      setEnabled(checked);
      toast.success(
        checked
          ? "Developer script mode enabled — rule scripts now run with full system access."
          : "Safe script mode restored — rule scripts run inside the sandbox."
      );
    } catch (e) {
      toast.error("Failed to update setting");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Row align="middle" className="w-full mt-16 setting-item-container">
      <Col span={22}>
        <div className="title">Developer script mode</div>
        <p className="setting-item-caption">
          Runs "code" rules with full system access instead of the secure sandbox. Enable only for scripts you fully
          trust — a shared or imported rule could run arbitrary code on your machine.
        </p>
      </Col>
      <Col span={2} className="text-right">
        {enabled ? (
          // Already on → allow turning it off immediately (safe direction).
          <Switch checked loading={loading} onChange={() => applyMode(false)} />
        ) : (
          // Off → require an explicit confirm before granting full access.
          <Popconfirm
            okText="Enable dev mode"
            cancelText="Cancel"
            placement="topLeft"
            title="Dev mode runs rule scripts with FULL system access (no sandbox). Only enable for code you trust. Continue?"
            onConfirm={() => applyMode(true)}
          >
            <Switch checked={false} loading={loading} />
          </Popconfirm>
        )}
      </Col>
    </Row>
  );
};

export default DevScriptMode;
