import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, signSession, parseSession } from "../src/auth.js";

describe("password hashing", () => {
  it("round-trips a correct password and rejects a wrong one", () => {
    const stored = hashPassword("correct horse battery");
    expect(verifyPassword("correct horse battery", stored)).toBe(true);
    expect(verifyPassword("wrong password", stored)).toBe(false);
  });

  it("salts: two hashes of the same password differ", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("rejects malformed or missing hashes", () => {
    expect(verifyPassword("x", null)).toBe(false);
    expect(verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("session tokens", () => {
  it("signs and parses a seller id", () => {
    const token = signSession("11111111-2222-3333-4444-555555555555");
    expect(parseSession(token)).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("rejects tampered tokens", () => {
    const token = signSession("seller-a");
    const forged = `seller-b.${token.split(".")[1]}`;
    expect(parseSession(forged)).toBeNull();
    expect(parseSession("nonsense")).toBeNull();
    expect(parseSession(undefined)).toBeNull();
  });
});
