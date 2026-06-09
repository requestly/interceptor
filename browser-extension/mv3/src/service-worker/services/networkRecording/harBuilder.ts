import { Entry, Header, QueryString } from "har-format";

/**
 * HAR Entry plus our extensions:
 * - `_error`: set on failed/aborted requests (webRequest path).
 * - `_truncated`: per-body cap codes when the SDK page script dropped an over-size / media body
 *   (101 = request too large, 102 = response too large). Lets LTS tell "dropped (too large)"
 *   from a genuinely empty body. Mirrors the web-sdk RQNetworkEventErrorCodes.
 */
export type NetworkHarEntry = Entry & { _error?: string; _truncated?: number[] };

/**
 * Shape posted by the networkBodyRecorder page script (derived from the web-sdk
 * Network interceptor callback). Headers are a plain name→value record.
 */
export interface SdkNetworkPayload {
  api?: string; // "xmlhttprequest" | "fetch"
  method: string;
  url: string;
  status: number;
  statusText?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestData?: unknown;
  response?: unknown;
  contentType?: string;
  responseTime?: number;
  responseURL?: string;
  errors?: number[];
}

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

// Returns -1 (HAR's "size unknown" sentinel) when content-length is absent/unparseable,
// so the UI can distinguish "unknown" from a real 0-byte body.
const parseContentLength = (headers: chrome.webRequest.HttpHeader[] | undefined): number => {
  const value = parseHeaderValue(headers, "content-length");
  if (!value) return -1;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? -1 : parsed;
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
      content: { size: -1, mimeType: "" },
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

/** Record<name,value> headers → HAR Header[]. */
const recordToHarHeaders = (headers: Record<string, string> | undefined): Header[] =>
  Object.entries(headers || {}).map(([name, value]) => ({ name, value: value ?? "" }));

/** Coerce an SDK body (string | object | undefined) to a HAR body string. */
const bodyToText = (body: unknown): string | undefined => {
  if (body === undefined || body === null || body === "") return undefined;
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return undefined;
  }
};

const byteLength = (text: string | undefined): number => (text === undefined ? -1 : text.length);

/**
 * Build a HAR 1.2 Entry from an SDK (web-sdk Network interceptor) payload — the v2 source for
 * XHR/Fetch. Unlike the webRequest path this carries request + response BODIES and headers, with
 * no correlation needed (the payload is self-complete). `requestId` is extension-assigned.
 */
export const buildSdkEntry = (payload: SdkNetworkPayload, requestId: string): NetworkHarEntry => {
  const responseTime = Math.max(0, Math.round(payload.responseTime ?? 0));
  // The SDK doesn't give a start timestamp; derive it so startedDateTime + time are consistent.
  const startTime = Date.now() - responseTime;

  const requestText = bodyToText(payload.requestData);
  const responseText = bodyToText(payload.response);
  const requestContentType = payload.requestHeaders
    ? payload.requestHeaders["content-type"] || payload.requestHeaders["Content-Type"]
    : undefined;

  const entry: NetworkHarEntry = {
    startedDateTime: new Date(startTime).toISOString(),
    time: responseTime,
    request: {
      method: payload.method,
      url: payload.url,
      httpVersion: "",
      cookies: [],
      headers: recordToHarHeaders(payload.requestHeaders),
      queryString: parseQueryString(payload.url),
      headersSize: -1,
      bodySize: requestText !== undefined ? requestText.length : -1,
    },
    response: {
      status: payload.status,
      statusText: payload.statusText || "",
      httpVersion: "",
      cookies: [],
      headers: recordToHarHeaders(payload.responseHeaders),
      content: {
        size: byteLength(responseText),
        mimeType: payload.contentType || "",
      },
      redirectURL: payload.responseURL && payload.responseURL !== payload.url ? payload.responseURL : "",
      headersSize: -1,
      bodySize: byteLength(responseText),
    },
    cache: {},
    timings: { send: 0, wait: responseTime, receive: 0 },
    _resourceType: "xhr", // SDK only sees xhr/fetch; single-bucket to match v1 (api field has the split)
    _request_id: requestId,
    _fromCache: null,
  };

  // Only set postData when there's an actual request body (strict HAR: omit otherwise).
  if (requestText !== undefined) {
    entry.request.postData = { mimeType: requestContentType || "", text: requestText };
  }
  // content.text only when a body survived the cap.
  if (responseText !== undefined) {
    entry.response.content.text = responseText;
  }
  if (payload.errors && payload.errors.length) {
    entry._truncated = payload.errors;
  }

  return entry;
};
