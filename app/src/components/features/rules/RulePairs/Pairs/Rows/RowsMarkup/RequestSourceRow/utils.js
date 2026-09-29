import { CONSTANTS as GLOBAL_CONSTANTS } from "@requestly/requestly-core";

const hasFilterValue = (value) => {
  if (Array.isArray(value)) {
    return value.some(hasFilterValue);
  }

  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "object") {
    return Object.values(value).some(hasFilterValue);
  }

  return true;
};

const isCompleteRequestPayloadFilter = (filterValue) => {
  if (!filterValue || typeof filterValue !== "object" || Array.isArray(filterValue)) {
    return false;
  }

  return hasFilterValue(filterValue.key) && hasFilterValue(filterValue.value);
};

export const getAdvancedFiltersCount = (filters = {}) => {
  return Object.entries(filters).filter(([filterType, filterValue]) => {
    if (filterType === GLOBAL_CONSTANTS.RULE_SOURCE_FILTER_TYPES.PAGE_URL) {
      return false;
    }

    if (filterType === GLOBAL_CONSTANTS.RULE_SOURCE_FILTER_TYPES.REQUEST_DATA) {
      return isCompleteRequestPayloadFilter(filterValue);
    }

    return hasFilterValue(filterValue);
  }).length;
};
