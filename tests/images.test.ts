import { describe, expect, it } from "vitest";
import { extensionForMediaType, stripDataUrl, MAX_IMAGE_BYTES } from "../src/images.js";

describe("extensionForMediaType", () => {
  it("maps supported image types", () => {
    expect(extensionForMediaType("image/jpeg")).toBe("jpg");
    expect(extensionForMediaType("image/png")).toBe("png");
    expect(extensionForMediaType("image/webp")).toBe("webp");
    expect(extensionForMediaType("image/gif")).toBe("gif");
  });

  it("rejects unsupported and hostile types", () => {
    expect(extensionForMediaType("application/pdf")).toBeNull();
    expect(extensionForMediaType("text/html")).toBeNull();
    expect(extensionForMediaType("")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(extensionForMediaType("Image/PNG")).toBe("png");
  });
});

describe("stripDataUrl", () => {
  it("strips data-URL prefixes", () => {
    expect(stripDataUrl("data:image/png;base64,AAAA")).toBe("AAAA");
  });

  it("leaves plain base64 untouched", () => {
    expect(stripDataUrl("AAAA")).toBe("AAAA");
  });

  it("only strips at data: start (commas inside base64 are safe)", () => {
    expect(stripDataUrl("AA/AA+BB==")).toBe("AA/AA+BB==");
  });
});

describe("MAX_IMAGE_BYTES", () => {
  it("caps at 5 MB", () => {
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });
});
