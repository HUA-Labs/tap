import { describe, expect, it } from "vitest";

import {
  checkPeerDmRateLimit,
  getPeerDmRateLimitKey,
  isPeerDmRateLimitExempt,
  recordPeerDm,
  type PeerDmHistoryStore,
} from "../tap-peer-dm-rate-limit.ts";

function createStore(): PeerDmHistoryStore {
  return new Map();
}

describe("tap peer DM rate limit", () => {
  it("allows up to three peer DMs and blocks the fourth within five minutes", () => {
    const store = createStore();
    const route = {
      fromId: "codex-reviewer",
      fromName: "린",
      to: "해",
      resolvedTo: "codex_worker",
    };
    const baseMs = Date.parse("2026-04-02T12:00:00.000Z");

    recordPeerDm(store, route, baseMs);
    recordPeerDm(store, route, baseMs + 60_000);
    recordPeerDm(store, route, baseMs + 120_000);

    expect(checkPeerDmRateLimit(store, route, baseMs + 180_000)).toMatchObject({
      allowed: false,
      exempt: false,
      target: "codex_worker",
      recentCount: 3,
    });
  });

  it("resets the allowance after the rate-limit window expires", () => {
    const store = createStore();
    const route = {
      fromId: "codex-reviewer",
      fromName: "린",
      to: "해",
      resolvedTo: "codex_worker",
    };
    const baseMs = Date.parse("2026-04-02T12:00:00.000Z");

    recordPeerDm(store, route, baseMs);
    recordPeerDm(store, route, baseMs + 60_000);
    recordPeerDm(store, route, baseMs + 120_000);

    expect(
      checkPeerDmRateLimit(store, route, baseMs + 5 * 60_000 + 1_000),
    ).toMatchObject({
      allowed: true,
      exempt: false,
      recentCount: 2,
    });
  });

  it("treats tower routes as exempt", () => {
    const route = {
      fromId: "codex-reviewer",
      fromName: "린",
      to: "결",
      resolvedTo: "tower",
      towerName: "결",
    };

    expect(isPeerDmRateLimitExempt(route)).toBe(true);
    expect(getPeerDmRateLimitKey(route)).toBeNull();
  });

  it("treats tower id routes as exempt even when config stores the tower display name", () => {
    const route = {
      fromId: "codex-reviewer",
      fromName: "린",
      to: "codex_tower",
      resolvedTo: "codex_tower",
      towerName: "결",
      towerId: "codex_tower",
    };

    expect(isPeerDmRateLimitExempt(route)).toBe(true);
    expect(getPeerDmRateLimitKey(route)).toBeNull();
  });

  it("treats broadcasts as exempt", () => {
    const route = {
      fromId: "codex-reviewer",
      fromName: "린",
      to: "전체",
      resolvedTo: "전체",
      towerName: "결",
    };

    expect(isPeerDmRateLimitExempt(route)).toBe(true);
    expect(getPeerDmRateLimitKey(route)).toBeNull();
  });

  it("canonicalizes resolved ids so name and id routes share the same bucket", () => {
    const routeByName = {
      fromId: "codex-reviewer",
      fromName: "린",
      to: "해",
      resolvedTo: "codex-worker",
    };
    const routeById = {
      fromId: "codex_reviewer",
      fromName: "린",
      to: "codex_worker",
      resolvedTo: "codex_worker",
    };

    expect(getPeerDmRateLimitKey(routeByName)).toBe(
      getPeerDmRateLimitKey(routeById),
    );
  });
});
