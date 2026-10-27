import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { handle as signingAccess } from "./signingAccess";
import { handle as signingResendWebhook } from "./signingWebhooksHttp";

const http = httpRouter();

auth.addHttpRoutes(http);
http.route({ path: "/signing/access", method: "POST", handler: signingAccess });
http.route({
  path: "/signing/resend-webhook",
  method: "POST",
  handler: signingResendWebhook,
});

export default http;
