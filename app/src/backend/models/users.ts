import { BlockConfig } from "componentsV2/BlockScreen/hooks/useIsUserBlocked";

// FIXME: This needs to be fetched from backend

type UserMetadata =
  | {
      ai_consent?: boolean;
    }
  | undefined;

export interface User {
  domain: string;
  email?: string;
  isVerified?: boolean;
  photoURL: string;
  signupTs: number;
  username: string;
  browserstackId?: string;
  browserstackGroupId?: string;
  browserstackSubGroupId?: string;
  "block-config"?: BlockConfig;
  metadata?: UserMetadata;
}
