import { describe, it, expect } from "vitest";
import {
  ROLE_PRESETS,
  VALID_ROLES,
  createPermissionFromRole,
} from "../permissions/index.js";

describe("ROLE_PRESETS", () => {
  it("defines all 4 roles", () => {
    expect(Object.keys(ROLE_PRESETS)).toHaveLength(4);
    expect(Object.keys(ROLE_PRESETS).sort()).toEqual([
      "custom",
      "implementer",
      "reviewer",
      "tower",
    ]);
  });

  it("tower has full-access mode", () => {
    expect(ROLE_PRESETS.tower.mode).toBe("full-access");
    expect(ROLE_PRESETS.tower.allowedTools).toEqual(["*"]);
    expect(ROLE_PRESETS.tower.deniedTools).toEqual([]);
    expect(ROLE_PRESETS.tower.escalateTo).toBeNull();
  });

  it("implementer has workspace-write mode with tool restrictions", () => {
    expect(ROLE_PRESETS.implementer.mode).toBe("workspace-write");
    expect(ROLE_PRESETS.implementer.allowedTools).toContain("Edit");
    expect(ROLE_PRESETS.implementer.allowedTools).toContain("Bash");
    expect(ROLE_PRESETS.implementer.deniedTools).toContain(
      "Bash(git push --force:*)",
    );
    expect(ROLE_PRESETS.implementer.escalateTo).toBe("tower");
  });

  it("reviewer has readonly mode", () => {
    expect(ROLE_PRESETS.reviewer.mode).toBe("readonly");
    expect(ROLE_PRESETS.reviewer.allowedTools).toContain("Read");
    expect(ROLE_PRESETS.reviewer.allowedTools).toContain("Grep");
    expect(ROLE_PRESETS.reviewer.deniedTools).toContain("Edit");
    expect(ROLE_PRESETS.reviewer.deniedTools).toContain("Write");
    expect(ROLE_PRESETS.reviewer.allowedPaths).toEqual([
      "hua-comms/reviews/**",
    ]);
  });

  it("custom has prompt mode with empty tools", () => {
    expect(ROLE_PRESETS.custom.mode).toBe("prompt");
    expect(ROLE_PRESETS.custom.allowedTools).toEqual([]);
    expect(ROLE_PRESETS.custom.deniedTools).toEqual([]);
    expect(ROLE_PRESETS.custom.escalateTo).toBe("tower");
  });
});

describe("createPermissionFromRole", () => {
  it("creates permission matching preset for each role", () => {
    for (const role of VALID_ROLES) {
      const perm = createPermissionFromRole(role);
      expect(perm.role).toBe(role);
      expect(perm.mode).toBe(ROLE_PRESETS[role].mode);
      expect(perm.allowedTools).toEqual(ROLE_PRESETS[role].allowedTools);
      expect(perm.deniedTools).toEqual(ROLE_PRESETS[role].deniedTools);
    }
  });

  it("returns a copy, not a reference to the preset", () => {
    const perm = createPermissionFromRole("tower");
    perm.allowedTools.push("custom-tool");
    expect(ROLE_PRESETS.tower.allowedTools).not.toContain("custom-tool");
  });
});

describe("VALID_ROLES", () => {
  it("contains all 4 roles", () => {
    expect(VALID_ROLES).toEqual(["tower", "implementer", "reviewer", "custom"]);
  });
});
