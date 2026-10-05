import { describe, expect, it } from "vitest";
import {
  normalizeCatalogText,
  extractVariantAttributes,
  buildModelKey,
  resolveProductCandidate,
} from "./productInterpreter";

const categories = ["Sofá", "Rack", "Mesa", "Cadeira"];

describe("productInterpreter", () => {
  it("normaliza acentos, separadores e abreviações", () => {
    expect(normalizeCatalogText("Sofá Roma - 3L")).toBe("sofa roma 3 lugares");
  });

  it("extrai atributos de variação", () => {
    expect(extractVariantAttributes("Sofá Roma Retrátil 3 Lugares")).toContain("3 lugares");
    expect(extractVariantAttributes("Cama Queen 198cm")).toEqual(
      expect.arrayContaining(["queen", "198cm"]),
    );
  });

  it("gera a mesma chave de modelo para variações de quantidade", () => {
    expect(buildModelKey("Sofá Roma 3 Lugares", categories))
      .toBe(buildModelKey("Sofá Roma 2L", categories));
  });

  it("associa automaticamente quando o modelo é claramente igual", () => {
    const result = resolveProductCandidate(
      { name: "Sofá Roma 3 Lugares", category: "Sofá" },
      [
        { id: 10, nome: "Sofá Roma 2 Lugares", categoria: "Sofá" },
        { id: 11, nome: "Rack London 180", categoria: "Rack" },
      ],
      { categories },
    );

    expect(result.action).toBe("associate");
    expect(result.candidate.id).toBe(10);
    expect(result.confidence).toBeGreaterThanOrEqual(90);
  });

  it("não força associação para produtos muito diferentes", () => {
    const result = resolveProductCandidate(
      { name: "Mesa Verona 6 Lugares", category: "Mesa" },
      [
        { id: 10, nome: "Sofá Roma 2 Lugares", categoria: "Sofá" },
        { id: 11, nome: "Rack London 180", categoria: "Rack" },
      ],
      { categories },
    );

    expect(result.action).toBe("create");
    expect(result.candidate).toBeNull();
  });
});
