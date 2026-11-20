import React, { useEffect, useRef, useState } from "react";
import { GROUP_NAME_MAX_LENGTH, GroupNameRejection, validateGroupName } from "../../../networkRecordingProtocol";

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
  // Resolves with a rejection reason when the service worker refuses the name.
  onSave: (name: string) => Promise<GroupNameRejection | null>;
  onCancel: () => void;
}

const GroupNameEditor: React.FC<GroupNameEditorProps> = ({ initialName, otherNames, onSave, onCancel }) => {
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
    <div className="group-editor">
      <div className="group-editor-row">
        <input
          ref={inputRef}
          className={`group-editor-input ${reason ? "group-editor-input--invalid" : ""}`}
          value={value}
          aria-label="Group name"
          aria-invalid={!!reason}
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
          className="group-editor-btn group-editor-btn--save"
          aria-label="Save name"
          disabled={!checked.ok}
          onMouseDown={(e) => {
            e.preventDefault();
            save();
          }}
        >
          ✓
        </button>
        <button
          type="button"
          className="group-editor-btn"
          aria-label="Cancel rename"
          onMouseDown={(e) => {
            e.preventDefault();
            cancel();
          }}
        >
          ✕
        </button>
      </div>
      {reason && (
        <div className="group-editor-error" role="alert">
          {GROUP_NAME_MESSAGES[reason]}
        </div>
      )}
    </div>
  );
};

export default GroupNameEditor;
