export interface NetworkRecordingEvent {
  requestId: string;
  url: string;
  method: string;
  type: string;
  statusCode: number;
  timeStamp: number;
  fromCache: boolean;
  ip?: string;
  contentLength?: number;
  contentType?: string;
  state: "complete" | "error";
  error?: string;
}
