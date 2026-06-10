import { Entry } from "har-format";

/**
 * Network entries are HAR 1.2 Entry objects carrying these `_`-prefixed extension fields
 * (the same DevTools convention typed by @types/har-format):
 *   _resourceType  — DevTools resource category (document | script | xhr | image | ...)
 *   _request_id    — extension-assigned unique id (stable key / dedup)
 *   _fromCache     — served from cache
 *   _error         — present on failed/aborted requests
 */
export type NetworkEntry = Entry;
