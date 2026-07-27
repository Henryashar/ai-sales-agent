import { afterEach, describe, expect, it } from "vitest";

import { authenticateUser, createSessionCookie, readSessionCookie } from "./session";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("authenticateUser", () => {
  it("authenticates configured users with personal codes", () => {
    process.env.APP_USERS_JSON = JSON.stringify([
      {
        name: "Henry",
        email: "henry@example.com",
        code: "personal-code",
      },
    ]);

    expect(
      authenticateUser({
        email: "HENRY@example.com",
        code: "personal-code",
      }),
    ).toEqual({
      name: "Henry",
      email: "henry@example.com",
    });
  });

  it("falls back to the shared access token when no users are configured", () => {
    process.env.APP_USERS_JSON = "";
    process.env.APP_ACCESS_TOKEN = "shared-code";

    expect(
      authenticateUser({
        name: "Claudia",
        email: "claudia@example.com",
        code: "shared-code",
      }),
    ).toEqual({
      name: "Claudia",
      email: "claudia@example.com",
    });
  });
});

describe("session cookie", () => {
  it("round-trips a signed session", () => {
    process.env.AUTH_SESSION_SECRET = "test-secret";
    const cookie = createSessionCookie(
      {
        name: "Henry",
        email: "henry@example.com",
      },
      1_000,
    );

    expect(readSessionCookie(cookie, 1_500)).toMatchObject({
      user: {
        name: "Henry",
        email: "henry@example.com",
      },
    });
  });

  it("rejects expired sessions", () => {
    process.env.AUTH_SESSION_SECRET = "test-secret";
    const cookie = createSessionCookie(
      {
        name: "Henry",
        email: "henry@example.com",
      },
      1_000,
    );

    expect(readSessionCookie(cookie, 60 * 60 * 13 * 1000)).toBeUndefined();
  });
});
