import { doc, getFirestore, onSnapshot } from "firebase/firestore";
import firebaseApp from "../../firebase";
import APP_CONSTANTS from "config/constants";
import { submitAttrUtil } from "utils/AnalyticsUtils";
import Logger from "lib/logger";

/**
 * Keeps the GrowthBook attribute `browserstack_id` in step with the Firestore user doc.
 * The BrowserStack merge writes `browserstackId` from a different browser when the app runs on
 * desktop, and AuthHandler only reads it once from onAuthStateChanged — so without this
 * subscription the desktop app would not notice the merge until the next restart.
 *
 * @returns the unsubscribe function, or null when no listener was attached.
 */
const userDocListener = (uid) => {
  if (!uid) {
    return null;
  }

  try {
    const db = getFirestore(firebaseApp);
    const userDocRef = doc(db, "users", uid);

    return onSnapshot(
      userDocRef,
      (docSnapshot) => {
        const userData = docSnapshot.exists() ? docSnapshot.data() : null;
        submitAttrUtil(APP_CONSTANTS.GA_EVENTS.ATTR.BROWSERSTACK_ID, userData?.browserstackId ?? null);
      },
      (err) => {
        Logger.log(`[userDocListener] Encountered error: ${err}`);
      }
    );
  } catch (err) {
    Logger.log(`[userDocListener] Failed to attach listener: ${err}`);
    return null;
  }
};

export default userDocListener;
