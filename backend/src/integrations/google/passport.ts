import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { config } from "../../config";
import { prisma } from "../../db/prisma";
import { AuthenticatedUser } from "../../types";

/**
 * Real Google OAuth 2.0 login via passport-google-oauth20. On successful
 * authorization we find-or-create a local User keyed by the immutable
 * Google profile id, persisting name/email/avatar as required.
 */
import { logger } from "../../utils/logger";

export const isGoogleAuthEnabled = Boolean(
  config.google.clientId &&
  config.google.clientSecret &&
  config.google.clientId.trim() !== "" &&
  config.google.clientSecret.trim() !== ""
);

if (isGoogleAuthEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: config.google.clientId,
        clientSecret: config.google.clientSecret,
        callbackURL: config.google.callbackUrl,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error("Google profile did not include an email address"));
          }

          const user = await prisma.user.upsert({
            where: { googleId: profile.id },
            update: {
              name: profile.displayName,
              email,
              avatarUrl: profile.photos?.[0]?.value ?? null,
            },
            create: {
              googleId: profile.id,
              name: profile.displayName,
              email,
              avatarUrl: profile.photos?.[0]?.value ?? null,
            },
          });

          const authedUser: AuthenticatedUser = {
            id: user.id,
            name: user.name,
            email: user.email,
            avatarUrl: user.avatarUrl,
          };
          return done(null, authedUser);
        } catch (err) {
          return done(err as Error);
        }
      }
    )
  );
} else {
  logger.info("Google OAuth credentials not configured; Google authentication routes disabled (H5 fix)");
}

passport.serializeUser((user, done) => {
  done(null, (user as AuthenticatedUser).id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return done(null, false);
    const authedUser: AuthenticatedUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
    };
    done(null, authedUser);
  } catch (err) {
    done(err as Error);
  }
});

export default passport;
