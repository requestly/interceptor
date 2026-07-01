import firebaseApp from "firebase";
import { getDatabase, onValue, ref } from "firebase/database";
import { doc, getFirestore, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { getUserAuthDetails } from "store/slices/global/user/selectors";
import { isPremiumUser } from "utils/PremiumUtils";

export enum BlockType {
  GRR = "grr",
  COMPLIANCE_ISSUE = "compliance-issue",
  // Free / unlicensed users at a gated domain (e.g. aon.com). Used with metadata.exemptBrowserstackUsers
  // so users holding an active BrowserStack seat pass through while everyone else sees the access screen.
  ACCESS_DENIED = "access-denied",
}

type BlockConfigValue = {
  isBlocked: boolean;
  reason?: string;
  // metadata.exemptBrowserstackUsers (boolean): when true, users who hold an active BrowserStack-provisioned
  // seat are NOT blocked (e.g. block free users at a domain but let BrowserStack-licensed users through).
  // Omit for a full domain block (everyone at the domain is blocked).
  metadata?: Record<string, any>;
};

export type BlockConfig = {
  [key in BlockType]?: BlockConfigValue;
};

/**
 * A user has an active BrowserStack seat when their subscription is BrowserStack-provisioned and currently active.
 */
const hasActiveBrowserstackSeat = (planDetails: any): boolean => {
  return Boolean(planDetails?.subscription?.isBrowserstackSubscription) && isPremiumUser(planDetails);
};

/**
 * A domain block is skipped for BrowserStack-licensed users when metadata.exemptBrowserstackUsers is set.
 * Used only for domain-level blocks; explicit per-user blocks always apply.
 */
const isUserExemptFromBlock = (value: BlockConfigValue | undefined, hasBrowserstackSeat: boolean): boolean => {
  return Boolean(value?.metadata?.exemptBrowserstackUsers) && hasBrowserstackSeat;
};

export const useIsUserBlocked = () => {
  const user = useSelector(getUserAuthDetails);
  const isLoggedIn = user?.loggedIn;
  const uid = user?.details?.profile?.uid;
  const email = user?.details?.profile?.email;
  const planDetails = user?.details?.planDetails;

  const hasBrowserstackSeat = useMemo(
    () => hasActiveBrowserstackSeat(planDetails),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planDetails?.planId, planDetails?.status, planDetails?.subscription?.endDate, planDetails?.subscription?.isBrowserstackSubscription]
  );

  const [domainBlockConfig, setDomainBlockConfig] = useState<BlockConfig | undefined>(undefined);
  const [userBlockConfig, setUserBlockConfig] = useState<BlockConfig | undefined>(undefined);
  const [finalBlockConfig, setFinalBlockConfig] = useState<BlockConfig | undefined>(undefined);

  useEffect(() => {
    if (!isLoggedIn || !uid) {
      return;
    }

    const db = getFirestore(firebaseApp);
    const unsubscribeListener = onSnapshot(doc(db, "users", uid), (doc) => {
      if (doc.exists()) {
        const userDetails = doc.data();
        setUserBlockConfig(userDetails?.["block-config"] || {});
      }
    });

    return () => {
      unsubscribeListener?.();
    };
  }, [isLoggedIn, uid]);

  useEffect(() => {
    if (!isLoggedIn || !email) {
      return;
    }

    const emailDomain = email?.split("@")[1];
    const emailDomainKey = emailDomain?.replaceAll(".", "_dot_");
    const rdb = getDatabase();
    const domainBlockConfigRef = ref(rdb, `globalBlockConfig/domain/${emailDomainKey}`);
    const unsubscribe = onValue(domainBlockConfigRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        setDomainBlockConfig(data || {});
      } else {
        setDomainBlockConfig({});
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [email, isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn || !uid) {
      setFinalBlockConfig(undefined);
      setDomainBlockConfig(undefined);
      setUserBlockConfig(undefined);
      return;
    }

    // Explicit per-user blocks always apply, regardless of plan.
    for (const [key, value] of Object.entries(userBlockConfig || {})) {
      if (value?.isBlocked) {
        setFinalBlockConfig({
          [key]: {
            ...value,
          },
        });
        return;
      }
    }

    // Domain-level blocks can exempt BrowserStack-licensed users via metadata.exemptBrowserstackUsers,
    // so free users at a domain are blocked while users with a BrowserStack seat pass through.
    for (const [key, value] of Object.entries(domainBlockConfig || {})) {
      if (value?.isBlocked && !isUserExemptFromBlock(value, hasBrowserstackSeat)) {
        setFinalBlockConfig({
          [key]: {
            ...value,
          },
        });
        return;
      }
    }

    // No applicable block (or user is exempt) — clear any stale block config.
    setFinalBlockConfig(undefined);
  }, [domainBlockConfig, isLoggedIn, uid, userBlockConfig, hasBrowserstackSeat]);

  return {
    isBlocked: !!finalBlockConfig && Object.values(finalBlockConfig).some((value) => value.isBlocked),
    blockConfig: finalBlockConfig ?? {},
  };
};
