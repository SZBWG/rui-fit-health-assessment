import { createHmac, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

export const SESSION_COOKIE = "health_session";
const SESSION_DAYS = 30;

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }
  return secret;
}

export function hashSessionToken(token: string) {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

export function readSessionToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7).trim();
  return request.cookies.get(SESSION_COOKIE)?.value ?? null;
}

export async function requireSession(request: NextRequest) {
  const token = readSessionToken(request);
  if (!token) throw new ApiError(401, "UNAUTHENTICATED", "A valid session is required");

  const session = await getPrisma().authSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
  });
  if (!session || session.expiresAt <= new Date()) {
    throw new ApiError(401, "SESSION_EXPIRED", "The session is missing or expired");
  }
  return session;
}

export async function createAnonymousSession(now = new Date()) {
  const prisma = getPrisma();
  const accessToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + SESSION_DAYS);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: {} });
    const assessment = await tx.assessment.create({ data: { userId: user.id } });
    const session = await tx.authSession.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(accessToken),
        expiresAt,
      },
    });
    return { user, assessment, session };
  });

  return {
    userId: created.user.id,
    sessionId: created.session.id,
    assessmentId: created.assessment.id,
    accessToken,
    expiresAt,
  };
}
