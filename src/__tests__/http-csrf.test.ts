import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHttpServer } from "../api/http.js";

let server: Awaited<ReturnType<typeof startHttpServer>>;
let baseUrl: string;

beforeAll(async () => {
  server = await startHttpServer({ port: 0 });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server?.close();
});

describe("HTTP State API CSRF protection (M176)", () => {
  // ── Origin validation ───────────────────────────────────────────

  it("blocks POST from non-loopback origin", async () => {
    const res = await fetch(`${baseUrl}/api/start`, {
      method: "POST",
      headers: {
        Origin: "https://evil.example.com",
        "Content-Type": "application/json",
        Authorization: `Bearer ${server.token}`,
      },
      body: "{}",
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("non-loopback origin");
  });

  it("allows POST from loopback origin", async () => {
    const res = await fetch(`${baseUrl}/api/start`, {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:3847",
        "Content-Type": "application/json",
        Authorization: `Bearer ${server.token}`,
      },
      body: "{}",
    });

    // Should not be 403 (may be 200 or 500 depending on state — not 403)
    expect(res.status).not.toBe(403);
  });

  it("allows POST without Origin header (CLI/curl)", async () => {
    const res = await fetch(`${baseUrl}/api/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${server.token}`,
      },
      body: "{}",
    });

    expect(res.status).not.toBe(403);
  });

  // ── Content-Type validation ─────────────────────────────────────

  it("rejects POST without application/json Content-Type", async () => {
    const res = await fetch(`${baseUrl}/api/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${server.token}`,
      },
      body: "action=start",
    });

    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toContain("application/json");
  });

  // ── Bearer token auth ───────────────────────────────────────────

  it("rejects requests without Bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/snapshot`, {
      method: "GET",
    });

    expect(res.status).toBe(401);
  });

  it("rejects requests with wrong Bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/snapshot`, {
      method: "GET",
      headers: {
        Authorization: "Bearer wrong-token",
      },
    });

    expect(res.status).toBe(401);
  });

  it("accepts requests with correct Bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/snapshot`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${server.token}`,
      },
    });

    // Should not be 401 (200 or other — but authenticated)
    expect(res.status).not.toBe(401);
  });

  // ── Health endpoint (public) ────────────────────────────────────

  it("allows health check without auth", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      method: "GET",
    });

    expect(res.status).toBe(200);
  });

  // ── CORS ────────────────────────────────────────────────────────

  it("reflects loopback origin in CORS header", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers: {
        Origin: "http://localhost:3847",
      },
    });

    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3847",
    );
  });

  it("does not reflect non-loopback origin in CORS header", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers: {
        Origin: "https://evil.example.com",
      },
    });

    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://127.0.0.1",
    );
  });
});
