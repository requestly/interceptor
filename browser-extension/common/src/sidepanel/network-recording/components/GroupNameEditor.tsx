import React, { useEffect, useRef, useState } from "react";
import { GROUP_NAME_MAX_LENGTH, GroupNameRejection, validateGroupName } from "../../../networkRecordingProtocol";
import { Icon } from "./icons";

export const GROUP_NAME_MESSAGES: Record<GroupNameRejection, string> = {
  empty: "Enter a name.",
  duplicate: "A group with this name already exists.",
  "reserved-chars": 'A name can\'t contain "::".',
  "edge-colon": "A name can't start or end with a colon.",
  "too-long": `Use ${GROUP_NAME_MAX_LENGTH} characters or fewer.`,
  "line-break": "A name can't contain a line break.",
};

interface GroupNameEditorProps {
  initialName: string;
  otherNames: string[];
  // The header row the editor fills; the error line renders under it, outside the row.
  rowClassName: string;
  leading: React.ReactNode;
  // Resolves with a rejection reason when the service worker refuses the name.
  onSave: (name: string) => Promise<GroupNameRejection | null>;
  onCancel: () => void;
}

const GroupNameEditor: React.FC<GroupNameEditorProps> = ({
  initialName,
  otherNames,
  rowClassName,
  leading,
  onSave,
  onCancel,
}) => {
  const [value, setValue] = useState(initialName);
  const [serverReason, setServerReason] = useState<GroupNameRejection | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const checked = validateGroupName(value, otherNames);
  const reason = serverReason ?? (checked.ok === false ? checked.reason : null);

  const save = async () => {
    if (settledRef.current) return;
    if (!checked.ok) return;
    settledRef.current = true;
    const rejected = await onSave(checked.name);
    if (rejected) {
      settledRef.current = false;
      setServerReason(rejected);
    }
  };

  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  };

  return (
    <>
      <div className={rowClassName}>
        {leading}
        <div className="gp-editor">
          <input
            ref={inputRef}
            className="gp-editor-input"
            value={value}
            aria-label="Group name"
            aria-invalid={!!reason}
            aria-describedby={reason ? "gp-editor-error" : undefined}
            onChange={(e) => {
              setValue(e.target.value);
              setServerReason(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              else if (e.key === "Escape") cancel();
            }}
            // Blur saves a valid name and drops an invalid one, so a half-typed name never sticks.
            onBlur={() => (checked.ok ? save() : cancel())}
          />
          {/* mousedown (not click) so the input's blur does not fire first and swallow the press. */}
          <button
            type="button"
            className="gp-icon-btn gp-editor-save"
            aria-label="Save name"
            disabled={!checked.ok}
            onMouseDown={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <Icon name="check" size={16} />
          </button>
          <button
            type="button"
            className="gp-icon-btn gp-editor-cancel"
            aria-label="Cancel rename"
            onMouseDown={(e) => {
              e.preventDefault();
              cancel();
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>
      {reason && (
        <div className="gp-editor-error" id="gp-editor-error" role="alert">
          <Icon name="errorFilled" size={13} />
          <span>{GROUP_NAME_MESSAGES[reason]}</span>
        </div>
      )}
    </>
  );
};

export default GroupNameEditor;
