import { describe, it, expect } from "vitest";
import { serializeMessageEntities, telegramEventId, tgEventKeys, MAX_MESSAGE_ENTITIES } from "./index";

describe("serializeMessageEntities", () => {
  it("emits the compact wire shape with url only where present", () => {
    expect(
      serializeMessageEntities([
        { type: "bold", offset: 0, length: 5 },
        { type: "text_link", offset: 6, length: 4, url: "https://metriox.com" },
      ]),
    ).toBe(
      '[{"type":"bold","offset":0,"length":5},' +
        '{"type":"text_link","offset":6,"length":4,"url":"https://metriox.com"}]',
    );
  });

  it("returns null when there is nothing to record", () => {
    // An unformatted message must not carry an empty-array prop on every event.
    expect(serializeMessageEntities(undefined)).toBeNull();
    expect(serializeMessageEntities(null)).toBeNull();
    expect(serializeMessageEntities([])).toBeNull();
  });

  it("drops spans that cannot render", () => {
    expect(
      serializeMessageEntities([
        { type: "bold", offset: 0, length: 0 },
        { type: "", offset: 0, length: 3 },
        { type: "italic", offset: -1, length: 3 },
      ]),
    ).toBeNull();
  });

  it("caps the number of spans", () => {
    const many = Array.from({ length: MAX_MESSAGE_ENTITIES + 10 }, (_, i) => ({ type: "mention", offset: i, length: 1 }));
    const parsed = JSON.parse(serializeMessageEntities(many)!);
    expect(parsed).toHaveLength(MAX_MESSAGE_ENTITIES);
  });
});

describe("telegramEventId", () => {
  /**
   * The cross-repo contract, pinned to a value computed independently of this code. If this test fails,
   * ids minted here no longer match the ones Metriox's worker mints for the same message, and
   * dual-captured events silently stop deduping — so the fix is never to update this expectation.
   */
  it("matches the backend for a known key", async () => {
    expect(await telegramEventId("tg:msg:312302365:555")).toBe("9f92a510-d174-5053-ade2-de96feeebbdb");
  });

  it("is stable and distinct per key", async () => {
    const a = await telegramEventId(tgEventKeys.message(1, 10));
    const again = await telegramEventId(tgEventKeys.message(1, 10));
    const other = await telegramEventId(tgEventKeys.message(1, 11));

    expect(a).toBe(again);
    expect(a).not.toBe(other);
  });

  it("sets the v5 version and RFC variant bits in .NET's byte positions", async () => {
    // .NET reads the first three groups little-endian, so the version nibble lands in the SECOND hex pair
    // of group 3 rather than the first — emitting RFC-ordered hex instead would parse server-side into a
    // different Guid and never match.
    const id = await telegramEventId("tg:msg:1:1");
    const group3 = id.split("-")[2];
    const group4 = id.split("-")[3];

    expect(group3[2]).toBe("5");
    expect(["8", "9", "a", "b"]).toContain(group4[0]);
  });

  it("distinguishes an edit from the original send", async () => {
    const original = await telegramEventId(tgEventKeys.message(1, 10));
    const edited = await telegramEventId(tgEventKeys.messageEdit(1, 10, 1769000000));

    expect(original).not.toBe(edited);
  });
});

describe("tgEventKeys", () => {
  it("contains no bot identifier and no update id", () => {
    // Both would make the key unmatchable: the server keys on an internal bot id no SDK knows, and
    // update_id does not exist in MTProto at all.
    const keys = [
      tgEventKeys.message(-1001234567890, 5),
      tgEventKeys.callbackQuery("998877"),
      tgEventKeys.pollVote(-1001234567890, "p1"),
      tgEventKeys.reactions(-1001234567890, 5),
    ];

    for (const k of keys) {
      expect(k.startsWith("tg:")).toBe(true);
      expect(k).not.toContain("update");
    }

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("passes Bot-API chat ids through unchanged", () => {
    // The -100 prefix IS the canonical form; the worker normalizes onto it rather than the reverse.
    expect(tgEventKeys.message(-1001234567890, 7)).toBe("tg:msg:-1001234567890:7");
  });
});
