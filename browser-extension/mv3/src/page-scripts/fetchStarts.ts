// When each fetch call started, on the page's monotonic clock. The SDK times fetch only up to the
// response headers and reports it after reading the body, without saying which call it was, so a
// report is matched to its call by method and URL. A key that had two calls in flight at once
// cannot tell them apart, so it answers nothing until all of its calls have finished.

interface InFlight {
  count: number;
  startedAt: number;
  ambiguous: boolean;
}

const MAX_KEYS = 1000;

export const fetchStartKey = (method: string, url: string): string =>
  `${String(method).toUpperCase()} ${String(url).split("#")[0]}`;

/** The key the SDK's report for this call will carry: its Request's method and absolute URL. */
export const fetchCallKey = (resource: unknown, init: { method?: string } | undefined, baseUrl: string): string => {
  if (resource instanceof Request) return fetchStartKey(resource.method, resource.url);
  return fetchStartKey(init?.method || "GET", new URL(String(resource), baseUrl).href);
};

export class FetchStarts {
  private readonly inFlight = new Map<string, InFlight>();

  constructor(private readonly now: () => number) {}

  /**
   * Records a fetch call. Returns a function to call if the fetch fails before its response, since
   * the SDK never reports that call.
   */
  begin(key: string): () => void {
    const current = this.inFlight.get(key);
    if (current) {
      current.count += 1;
      current.ambiguous = true;
    } else if (this.inFlight.size < MAX_KEYS) {
      this.inFlight.set(key, { count: 1, startedAt: this.now(), ambiguous: false });
    } else {
      return () => {};
    }
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.end(key);
    };
  }

  /**
   * The start of the call the SDK just reported under `key`, or undefined when it cannot be told
   * apart from another call or is later than `latest`, the latest start the report allows. Ends
   * that call either way.
   */
  take(key: string, latest: number): number | undefined {
    const current = this.inFlight.get(key);
    if (!current) return undefined;
    const startedAt = current.ambiguous ? undefined : current.startedAt;
    this.end(key);
    return startedAt !== undefined && startedAt <= latest ? startedAt : undefined;
  }

  clear(): void {
    this.inFlight.clear();
  }

  private end(key: string): void {
    const current = this.inFlight.get(key);
    if (!current) return;
    current.count -= 1;
    if (current.count <= 0) this.inFlight.delete(key);
  }
}
