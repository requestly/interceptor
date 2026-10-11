import { ScopedVariables } from "features/apiClient/helpers/variableResolver/variable-resolver";

export interface SingleLineEditorProps {
  defaultValue?: string;
  className?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onPressEnter?: (event: KeyboardEvent, text: string) => void;
  onBlur?: (text: string) => void;
  onPaste?: (event: ClipboardEvent, text: string) => void;
  variables?: ScopedVariables;
  suggestions?: Array<{ value: string }>;
  /**
   * Opt-in Postman-style multi-line mode: newlines are preserved losslessly, `↵` glyphs mark line
   * ends, Shift+Enter inserts a newline and Enter commits. The editor renders collapsed to a single
   * line while blurred and expands in place while focused (see singleLineEditor.scss).
   */
  multiline?: boolean;
  readOnly?: boolean;
}
