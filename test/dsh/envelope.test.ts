import { describe, expect, it } from "vitest";
import {
  boundary,
  ENVELOPE_SCHEMA,
  renderEnvelope,
  toEnvelope,
  WikiToolError,
} from "../../src/dsh/envelope.js";

describe("toEnvelope", () => {
  it("joins text blocks and washes details to JSON", () => {
    const value = toEnvelope({
      content: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
      details: { n: 1, missing: undefined, fn: (() => 1) as unknown as string },
    });
    expect(value.text).toBe("a\nb");
    expect(value.data).toEqual({ n: 1 });
  });

  it("tolerates missing content/details", () => {
    expect(toEnvelope({})).toEqual({ text: "", data: {} });
  });
});

describe("boundary (isError → throw)", () => {
  it("throws WikiToolError on isError:true with envelope data", () => {
    let caught: unknown;
    try {
      boundary({ content: [{ type: "text", text: "boom" }], details: { code: 7 }, isError: true });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WikiToolError);
    expect((caught as WikiToolError).message).toBe("boom");
    expect((caught as WikiToolError).data).toEqual({ code: 7 });
  });

  it("passes success values through untouched", () => {
    expect(boundary({ content: [{ type: "text", text: "ok" }], details: { a: 1 } })).toEqual({
      text: "ok",
      data: { a: 1 },
    });
  });

  it("supports documented soft-failure envelopes", () => {
    expect(
      boundary(
        { content: [{ type: "text", text: "soft" }], details: {}, isError: true },
        { throwOnError: false },
      ),
    ).toEqual({ text: "soft", data: {} });
  });
});

describe("output contract", () => {
  it("schema requires text and render reads text only", () => {
    expect(ENVELOPE_SCHEMA.required).toContain("text");
    expect(renderEnvelope({}, { text: "hello", data: { secret: 1 } })).toEqual([
      { type: "text", text: "hello" },
    ]);
  });
});
