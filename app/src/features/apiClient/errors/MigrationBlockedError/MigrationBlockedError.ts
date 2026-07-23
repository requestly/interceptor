import { NativeError } from "errors/NativeError";

// Thrown by makeRequest when the migration block is active (RQ-4699). The
// legacy API Client stays mounted but request execution is stopped at the
// single choke point so every outbound path (HTTP/GraphQL send, response-panel
// Retry, Collection Runner, GraphQL introspection, WSDL/SOAP import fetch) is
// blocked. Pairs with the mandatory migration modal.
export class MigrationBlockedError extends NativeError {
  constructor() {
    super("API Client has moved to a dedicated app. Requests are disabled here.");
    this.name = "MigrationBlockedError";
  }
}
