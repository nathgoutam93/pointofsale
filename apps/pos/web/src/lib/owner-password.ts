import { api, apiErrorMessage } from "./api";
import { desktop } from "./desktop";

/**
 * A forgotten owner password. In the desktop app the request goes through the app, which can
 * reach the online server even before this computer works with it; in a browser, to the API.
 */
export async function ownerPasswordReset(
  step: "request" | "confirm",
  details: { email: string; code?: string; newPassword?: string },
  server = "",
) {
  if (desktop) {
    await desktop.ownerPasswordReset(server, step, details);
    return;
  }
  const res =
    step === "request"
      ? await api.accounts.requestPasswordReset({ body: { email: details.email } })
      : await api.accounts.confirmPasswordReset({
          body: { email: details.email, code: details.code ?? "", newPassword: details.newPassword ?? "" },
        });
  if (res.status !== 200 && res.status !== 202) throw new Error(apiErrorMessage(res.body, "That didn't work. Try again in a moment."));
}
