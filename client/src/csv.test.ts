import { describe, expect, it } from "vitest";
import { serializeCsv } from "./csv";

describe("CSV export", () => {
  it("escapes separators, quotes, and formula-like text", () => {
    expect(serializeCsv([
      ["Nombre", "Detalle", "Valor"],
      ["UNCA; comedor", 'Texto "citado"', "=1+1"]
    ])).toBe('\uFEFF"Nombre";"Detalle";"Valor"\r\n"UNCA; comedor";"Texto ""citado""";"\'=1+1"\r\n');
  });

  it("preserves numeric values and empty cells", () => {
    expect(serializeCsv([[1, -2, null, undefined]])).toBe('\uFEFF"1";"-2";"";""\r\n');
  });
});
