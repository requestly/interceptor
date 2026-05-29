import { Entry, Header, QueryString } from "har-format";

/** HAR Entry plus our `_error` extension (set on failed/aborted requests). */
export type NetworkHarEntry = Entry & { _error?: string };

/**
 * The HAR _resourceType enum (Chrome DevTools convention) differs from
 * chrome.webRequest.ResourceType. This maps webRequest types onto the HAR enum
 * so the entries match what DevTools' own HAR export emits.
 */
export const mapResourceType = (type: chrome.webRequest.ResourceType): NonNullable<Entry["_resourceType"]> => {
  switch (type) {
    case "xmlhttprequest":
      return "xhr";
    case "main_frame":
    case "sub_frame":
      return "document";
    case "stylesheet":
      return "stylesheet";
    case "script":
      return "script";
    case "image":
      return "image";
    case "font":
      return "font";
    case "media":
      return "media";
    case "websocket":
      return "websocket";
    case "ping":
      return "ping";
    case "csp_report":
      return "csp-violation-report";
    default:
      return "other";
  }
};

const toHarHeaders = (headers: chrome.webRequest.HttpHeader[] | undefined): Header[] =>
  (headers || []).map((h) => ({ name: h.name, value: h.value ?? "" }));

const parseHeaderValue = (headers: chrome.webRequest.HttpHeader[] | undefined, name: string): string | undefined => {
  if (!headers) return undefined;
  const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value;
};

const parseContentLength = (headers: chrome.webRequest.HttpHeader[] | undefined): number => {
  const value = parseHeaderValue(headers, "content-length");
  if (!value) return 0;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const parseQueryString = (url: string): QueryString[] => {
  try {
    const params = new URL(url).searchParams;
    const result: QueryString[] = [];
    params.forEach((value, name) => result.push({ name, value }));
    return result;
  } catch {
    return [];
  }
};

/** Parse "HTTP/1.1 200 OK" → { httpVersion: "HTTP/1.1", statusText: "OK" }. Both fall back to "". */
const parseStatusLine = (statusLine: string | undefined): { httpVersion: string; statusText: string } => {
  if (!statusLine) return { httpVersion: "", statusText: "" };
  const match = statusLine.match(/^(\S+)\s+\d+\s*(.*)$/);
  if (!match) return { httpVersion: "", statusText: "" };
  return { httpVersion: match[1] || "", statusText: (match[2] || "").trim() };
};

export interface CorrelationData {
  startTime: number; // epoch ms, from onBeforeSendHeaders
  requestHeaders: chrome.webRequest.HttpHeader[] | undefined;
}

/**
 * Build a spec-complete HAR 1.2 Entry from a completed webRequest.
 * `correlation` is the matched onBeforeSendHeaders data (may be absent for cache hits).
 * `requestId` is the extension-assigned unique id (NOT chrome.webRequest.requestId).
 */
export const buildCompletedEntry = (
  details: chrome.webRequest.WebResponseCacheDetails,
  correlation: CorrelationData | undefined,
  requestId: string
): NetworkHarEntry => {
  const startTime = correlation?.startTime ?? details.timeStamp;
  const wait = Math.max(0, Math.round(details.timeStamp - startTime));
  const { httpVersion, statusText } = parseStatusLine((details as { statusLine?: string }).statusLine);

  const entry: NetworkHarEntry = {
    startedDateTime: new Date(startTime).toISOString(),
    time: wait,
    request: {
      method: details.method,
      url: details.url,
      httpVersion: "",
      cookies: [],
      headers: toHarHeaders(correlation?.requestHeaders),
      queryString: parseQueryString(details.url),
      headersSize: -1,
      bodySize: -1,
    },
    response: {
      status: details.statusCode,
      statusText,
      httpVersion,
      cookies: [],
      headers: toHarHeaders(details.responseHeaders),
      content: {
        size: parseContentLength(details.responseHeaders),
        mimeType: parseHeaderValue(details.responseHeaders, "content-type") || "",
      },
      redirectURL: parseHeaderValue(details.responseHeaders, "location") || "",
      headersSize: -1,
      bodySize: -1,
    },
    cache: {},
    timings: { send: 0, wait, receive: 0 },
    _resourceType: mapResourceType(details.type),
    _request_id: requestId,
    _fromCache: details.fromCache ? "disk" : null,
  };

  if (details.ip) {
    entry.serverIPAddress = details.ip;
  }

  return entry;
};

/** Build a HAR Entry for a failed/aborted request (no response). */
export const buildErrorEntry = (
  details: chrome.webRequest.WebResponseErrorDetails,
  correlation: CorrelationData | undefined,
  requestId: string,
  error: string
): NetworkHarEntry => {
  const startTime = correlation?.startTime ?? details.timeStamp;

  return {
    startedDateTime: new Date(startTime).toISOString(),
    time: 0,
    request: {
      method: details.method,
      url: details.url,
      httpVersion: "",
      cookies: [],
      headers: toHarHeaders(correlation?.requestHeaders),
      queryString: parseQueryString(details.url),
      headersSize: -1,
      bodySize: -1,
    },
    response: {
      status: 0,
      statusText: "",
      httpVersion: "",
      cookies: [],
      headers: [],
      content: { size: 0, mimeType: "" },
      redirectURL: "",
      headersSize: -1,
      bodySize: -1,
    },
    cache: {},
    timings: { send: 0, wait: 0, receive: 0 },
    _resourceType: mapResourceType(details.type),
    _request_id: requestId,
    _error: error,
  };
};
