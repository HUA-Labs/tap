import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseMissionsFile } from "../engine/missions.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-missions-test-"));
  fs.mkdirSync(path.join(tmpDir, "docs", "missions"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const SAMPLE_MISSIONS_MD = `
# Mission Control

## Active Missions

| ID   | Mission                                                 | Branch                   | Status     | Owner         |
| ---- | ------------------------------------------------------- | ------------------------ | ---------- | ------------- |
| M129 | [Gemini Fake IDE Bridge](./m129-gemini-fake-ide-bridge.md) | \`feat/m129-gemini-ide\` | 🔵 active  | 신            |
| M148 | [Bridge 코드 분리 분석](./m148-bridge-splitting.md)     | \`docs/m148-splitting\`  | 🔵 active  | —             |
| M160 | [Bridge observability](./m160-bridge-observability.md)  | —                        | 🔵 active  | 돛            |

## Completed

| ID   | Mission                                           | Branch                  | Status       | Owner |
| ---- | ------------------------------------------------- | ----------------------- | ------------ | ----- |
| M90  | [Bridge 실시간 수신 복구](./m90-bridge-realtime.md) | \`fix/m90-bridge-fix\` | 🟢 completed | 담    |
| M101 | [Bridge Identity/Routing](./m101-bridge.md)       | \`fix/m101-bridge\`    | 🟢 completed | 덱   |
`.trim();

describe("parseMissionsFile", () => {
  it("returns empty array when file does not exist", () => {
    const result = parseMissionsFile(tmpDir);
    expect(result).toEqual([]);
  });

  it("parses active and completed missions", () => {
    fs.writeFileSync(
      path.join(tmpDir, "docs", "missions", "MISSIONS.md"),
      SAMPLE_MISSIONS_MD,
      "utf-8",
    );

    const missions = parseMissionsFile(tmpDir);

    expect(missions.length).toBe(5);

    const m129 = missions.find((m) => m.id === "M129");
    expect(m129).toBeDefined();
    expect(m129?.status).toBe("active");
    expect(m129?.title).toBe("Gemini Fake IDE Bridge");
    expect(m129?.branch).toBe("feat/m129-gemini-ide");
    expect(m129?.owner).toBe("신");

    const m148 = missions.find((m) => m.id === "M148");
    expect(m148?.owner).toBeNull(); // "—" maps to null

    const m90 = missions.find((m) => m.id === "M90");
    expect(m90?.status).toBe("completed");
    expect(m90?.branch).toBe("fix/m90-bridge-fix");
  });

  it("maps status emoji tokens correctly", () => {
    const content = `
| ID   | Mission           | Branch | Status       | Owner |
| ---- | ----------------- | ------ | ------------ | ----- |
| M001 | [Alpha](./a.md)   | —      | 🔵 active    | a     |
| M002 | [Beta](./b.md)    | —      | 🟡 planned   | b     |
| M003 | [Gamma](./c.md)   | —      | 🟢 completed | c     |
| M004 | [Delta](./d.md)   | —      | unknown      | d     |
`.trim();

    fs.writeFileSync(
      path.join(tmpDir, "docs", "missions", "MISSIONS.md"),
      content,
      "utf-8",
    );

    const missions = parseMissionsFile(tmpDir);
    expect(missions.find((m) => m.id === "M001")?.status).toBe("active");
    expect(missions.find((m) => m.id === "M002")?.status).toBe("planned");
    expect(missions.find((m) => m.id === "M003")?.status).toBe("completed");
    expect(missions.find((m) => m.id === "M004")?.status).toBe("planned");
  });

  it("preserves duplicate IDs as separate entries", () => {
    const content = `
| ID   | Mission          | Branch | Status    | Owner |
| ---- | ---------------- | ------ | --------- | ----- |
| M128 | [First](./a.md)  | —      | 🟡 planned | a    |
| M128 | [Second](./b.md) | —      | 🔵 active  | b    |
`.trim();

    fs.writeFileSync(
      path.join(tmpDir, "docs", "missions", "MISSIONS.md"),
      content,
      "utf-8",
    );

    const missions = parseMissionsFile(tmpDir);
    const m128s = missions.filter((m) => m.id === "M128");
    expect(m128s.length).toBe(2);
    expect(m128s[0]?.title).toBe("First");
    expect(m128s[1]?.title).toBe("Second");
  });

  it("treats 미배정 as null owner", () => {
    const content = `
| ID   | Mission         | Branch | Status     | Owner  |
| ---- | --------------- | ------ | ---------- | ------ |
| M158 | [Mac](./m.md)   | —      | 🟡 planned | 미배정 |
`.trim();

    fs.writeFileSync(
      path.join(tmpDir, "docs", "missions", "MISSIONS.md"),
      content,
      "utf-8",
    );

    const missions = parseMissionsFile(tmpDir);
    expect(missions[0]?.owner).toBeNull();
  });
});
