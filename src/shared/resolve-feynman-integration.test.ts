import { describe, test, expect } from "vitest";
import { resolveFeynman } from "./resolve-feynman.js";

describe("resolveFeynman with restricted PATH", () => {
  test("finds feynman even when ~/.local/bin is not in provided PATH", async () => {
    // Simulate a launchd-style restricted PATH that doesn't include ~/.local/bin
    const restrictedEnv = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
    const installation = await resolveFeynman("feynman", restrictedEnv);
    expect(installation.feynmanRoot).toBeTruthy();
    expect(installation.nodebin).toBeTruthy();
  });
});
