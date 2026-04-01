import path from "node:path";
import { describe, test, expect } from "vitest";
import { augmentPathForUserBins } from "./resolve-feynman.js";

describe("augmentPathForUserBins", () => {
  const homedir = "/Users/testuser";
  const localBin = path.join(homedir, ".local", "bin");
  const homeBin = path.join(homedir, "bin");

  test("prepends ~/.local/bin and ~/bin when missing from PATH", () => {
    const result = augmentPathForUserBins("/usr/bin:/bin", homedir);
    const dirs = result.split(path.delimiter);

    expect(dirs[0]).toBe(localBin);
    expect(dirs[1]).toBe(homeBin);
    expect(dirs[2]).toBe("/usr/bin");
    expect(dirs[3]).toBe("/bin");
  });

  test("does not duplicate dirs already in PATH", () => {
    const existing = `${localBin}:/usr/bin:${homeBin}`;
    const result = augmentPathForUserBins(existing, homedir);

    expect(result).toBe(existing);
  });

  test("prepends only missing dirs", () => {
    const existing = `${localBin}:/usr/bin:/bin`;
    const result = augmentPathForUserBins(existing, homedir);
    const dirs = result.split(path.delimiter);

    expect(dirs[0]).toBe(homeBin);
    // localBin was already present — should not be duplicated
    expect(dirs.filter((d) => d === localBin)).toHaveLength(1);
  });

  test("handles empty PATH", () => {
    const result = augmentPathForUserBins("", homedir);
    const dirs = result.split(path.delimiter).filter(Boolean);

    expect(dirs).toContain(localBin);
    expect(dirs).toContain(homeBin);
  });
});
