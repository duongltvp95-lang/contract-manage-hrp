import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

const require = createRequire(import.meta.url);
const exceljsRequire = createRequire(require.resolve("exceljs/package.json"));
const archiverRequire = createRequire(exceljsRequire.resolve("archiver/package.json"));
const archiverUtilsRequire = createRequire(archiverRequire.resolve("archiver-utils/package.json"));
const legacyGlob = archiverUtilsRequire("glob");
const match = require("../../packages/minimatch-compat/index.cjs");
const fixtureDir = mkdtempSync(join(tmpdir(), "hrp-dependency-compat-"));
afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

describe("patched ExcelJS dependency compatibility", () => {
  it("preserves callable CommonJS, match helpers and defaulted matchers", () => {
    expect(match("reports/a.xlsx", "**/*.xlsx")).toBe(true);
    expect(match.match(["a.pdf", "a.xlsx"], "*.xlsx")).toEqual(["a.xlsx"]);
    expect(new match.Minimatch("*.xlsx").match("a.xlsx")).toBe(true);
    expect(match.defaults({ nocase: true })("A.XLSX", "*.xlsx")).toBe(true);
  });
  it("supports real glob 7 directory traversal used by archive dependencies", () => {
    mkdirSync(join(fixtureDir, "nested"));
    writeFileSync(join(fixtureDir, "nested", "report.txt"), "HRP regression fixture");
    writeFileSync(join(fixtureDir, "ignore.pdf"), "fixture");
    expect(legacyGlob.sync("**/*.txt", { cwd: fixtureDir, nodir: true })).toEqual(["nested/report.txt"]);
  });
  it("round-trips Excel data bars through the patched CommonJS UUID implementation", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Đối tác");
    sheet.addRows([[10], [20]]);
    sheet.addConditionalFormatting({ ref: "A1:A2", rules: [{ type: "dataBar", priority: 1,
      cfvo: [{ type: "min" }, { type: "max" }] }] });
    const buffer = await workbook.xlsx.writeBuffer();
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(buffer);
    expect(loaded.getWorksheet("Đối tác")?.getCell("A2").value).toBe(20);
  });
});
