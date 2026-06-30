import md5 from "md5";
import { getRandomNumber } from "./Algos";

export const getRandomAvatar = () => {
  const randomNumber = getRandomNumber(1, 6);

  if (window.location.origin.includes("localhost")) {
    return "https://yoda.hypeople.studio/yoda-admin-template/react/static/media/memoji-1.afa5922f.png";
  }

  return `https://app.requestly.io/assets/img/memoji/png/analytics-marketing-team-${randomNumber}.png`;
};

export const generateGravatarURL = (email = "sagar@requestly.io") => {
  return `https://www.gravatar.com/avatar/${md5(email)}?s=200&d=${getRandomAvatar()}`;
};

/**
 * Resolves the avatar to display for a user.
 *
 * Precedence: the auth provider's photo (e.g. Google) when we have a real one,
 * otherwise a Gravatar resolved live from the current login email — so changes a
 * user makes on Gravatar are reflected here. For email/password accounts we persist
 * a synthetic gravatar.com URL as `photoURL`, so any gravatar.com value is treated
 * as "no provider photo" and re-resolved live from the email. `d=mp` is Gravatar's
 * deterministic fallback, shown when the email has no Gravatar image.
 */
export const getUserAvatarUrl = (email = "", providerPhotoURL = "") => {
  if (providerPhotoURL && !providerPhotoURL.includes("gravatar.com")) {
    return providerPhotoURL;
  }
  return `https://www.gravatar.com/avatar/${md5(email)}?s=200&d=mp`;
};
