import { ChangeType, getRecord, onRecordChange, saveRecord } from "common/storage";

export enum Variable {
  IS_EXTENSION_ENABLED = "isExtensionEnabled",
}

const getStorageKey = (variableName: Variable): string => `rq_var_${variableName}`;

export const setVariable = async <T = unknown>(name: Variable, value: T): Promise<void> => {
  await saveRecord<T>(getStorageKey(name), value);
};

export const getVariable = async <T = unknown>(name: Variable, defaultValue?: T): Promise<T> => {
  return ((await getRecord<T>(getStorageKey(name))) as T) ?? defaultValue;
};

export const onVariableChange = <T = unknown>(
  name: Variable,
  callback: (newValue: T, oldValue: T) => void,
  // Defaults to MODIFIED only (existing behavior). Pass CREATED too to also catch the first-ever
  // write of a variable — variables are lazily created, so the first toggle of a never-set value
  // is a CREATED change (oldValue undefined), which a MODIFIED-only filter would silently drop.
  changeTypes: ChangeType[] = [ChangeType.MODIFIED]
) => {
  onRecordChange<T>(
    {
      keyFilter: getStorageKey(name),
      changeTypes,
    },
    (changes) => {
      callback(changes[changes.length - 1].newValue, changes[0].oldValue);
    }
  );
};
