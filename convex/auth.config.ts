import { AuthConfig } from "convex/server";

const issuer = process.env.CONVEX_AUTH_ISSUER;
const applicationID = process.env.CONVEX_AUTH_APPLICATION_ID ?? process.env.CONVEX_AUTH_AUDIENCE;

export default {
  providers:
    issuer && applicationID
      ? [
          {
            domain: issuer,
            applicationID,
          },
        ]
      : [],
} satisfies AuthConfig;
