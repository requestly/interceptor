import React, { useEffect, useState } from "react";
import { Col, Row, Switch } from "antd";
import { toast } from "utils/Toast";

const GET_ACTION = "USER_PREFERENCE:GET_ALLOW_INSECURE_CERTS";
const SET_ACTION = "USER_PREFERENCE:UPDATE_ALLOW_INSECURE_CERTS";

function storageAction(type: string, data?: any): Promise<any> {
  return window?.RQ?.DESKTOP?.SERVICES?.IPC?.invokeEventInMain("rq-storage:storage-action", {
    type,
    payload: data !== undefined ? { data } : {},
  });
}

/**
 * RQ-2425: desktop-only toggle that controls whether the proxy verifies upstream
 * TLS certificates. Off (verify) by default. Persisted in the desktop
 * user-preference store and applied live on the running proxy (no restart).
 */
const InsecureCerts: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    storageAction(GET_ACTION)
      ?.then((res: boolean) => setEnabled(!!res))
      .catch(() => {});
  }, []);

  const onToggle = async (checked: boolean) => {
    setLoading(true);
    try {
      await storageAction(SET_ACTION, { allowInsecureCerts: checked });
      setEnabled(checked);
      toast.success(checked ? "Insecure SSL certificates allowed." : "Upstream TLS verification re-enabled.");
    } catch (e) {
      toast.error("Failed to update setting");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Row align="middle" className="w-full mt-16 setting-item-container">
      <Col span={22}>
        <div className="title">Allow insecure SSL in proxy interceptor</div>
        <p className="setting-item-caption">
          Skip TLS certificate verification for upstream servers. Enable only for hosts you trust.
        </p>
      </Col>
      <Col span={2} className="text-right">
        <Switch checked={enabled} loading={loading} onChange={onToggle} />
      </Col>
    </Row>
  );
};

export default InsecureCerts;
