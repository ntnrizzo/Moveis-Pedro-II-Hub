/**
 * MPII Hub V2 — interpretação determinística de catálogo.
 * Sem IA: normalização + atributos + similaridade + score explicável.
 */

const STOP_WORDS = new Set([
  "a", "as", "o", "os", "um", "uma", "uns", "umas",
  "de", "da", "do", "das", "dos", "e", "com", "sem",
  "para", "por", "em", "no", "na", "nos", "nas",
]);

const ABBREVIATIONS = Object.freeze([
  ["3l", "3 lugares"],
  ["2l", "2 lugares"],
  ["4l", "4 lugares"],
  ["5l", "5 lugares"],
  ["3p", "3 lugares"],
  ["2p", "2 lugares"],
  ["4p", "4 lugares"],
  ["retr.", "retratil"],
  ["retr", "retratil"],
  ["recl.", "reclinavel"],
  ["recl", "reclinavel"],
]);

const VARIANT_PATTERNS = Object.freeze([
  /\b\d+\s+lugares?\b/g,
  /\b(?:solteiro|casal|queen|king|super\s+king)\b/g,
  /\b(?:direito|esquerdo)\b/g,
  /\b\d+(?:[.,]\d+)?\s*(?:cm|mm|m)\b/g,
]);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function normalizeCatalogText(value) {
  if (value === null || value === undefined) return "";

  let text = String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[&+]/g, " e ")
    .replace(/[\/_|.,;:()[\]{}]+/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [from, to] of ABBREVIATIONS) {
    text = text.split(from).join(to);
  }

  return text.replace(/\s+/g, " ").trim();
}

export function tokenizeCatalogName(value) {
  return normalizeCatalogText(value).split(/\s+/).filter(Boolean);
}

export function extractVariantAttributes(name) {
  const normalized = normalizeCatalogText(name);
  const matches = [];

  for (const pattern of VARIANT_PATTERNS) {
    matches.push(...(normalized.match(pattern) || []));
  }

  return unique(matches.map(normalizeCatalogText));
}

export function extractCategory(name, categories = []) {
  const normalizedTokens = new Set(tokenizeCatalogName(name));

  return [...categories]
    .map((category) => ({
      category,
      tokens: tokenizeCatalogName(category),
    }))
    .filter((item) => item.tokens.length > 0)
    .sort((a, b) => b.tokens.length - a.tokens.length)
    .find((item) => item.tokens.every((token) => normalizedTokens.has(token)))
    ?.category || null;
}

export function buildModelKey(name, categories = []) {
  let text = normalizeCatalogText(name);
  const category = extractCategory(text, categories);
  const categoryTokens = new Set(tokenizeCatalogName(category || ""));

  for (const variant of extractVariantAttributes(text)) {
    text = text.split(variant).join(" ");
  }

  const tokens = text
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => !categoryTokens.has(token));

  return unique(tokens).join(" ").trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = prev[0];
    prev[0] = i;

    for (let j = 1; j <= b.length; j += 1) {
      const above = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diagonal + cost,
      );

      diagonal = above;
    }
  }

  return prev[b.length];
}

function similarity(a, b) {
  const left = normalizeCatalogText(a);
  const right = normalizeCatalogText(b);

  if (left === right) return 1;
  if (!left || !right) return 0;

  return Math.max(
    0,
    1 - levenshtein(left, right) / Math.max(left.length, right.length),
  );
}

function jaccard(left = [], right = []) {
  const a = new Set(left);
  const b = new Set(right);

  if (!a.size && !b.size) return 1;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }

  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

export function scoreProductMatch(input, candidate, { categories = [] } = {}) {
  const inputName = input?.name || input?.nome || "";
  const candidateName = candidate?.name || candidate?.nome || "";

  const inputModel = buildModelKey(inputName, categories);
  const candidateModel = buildModelKey(candidateName, categories);

  const inputTokens = tokenizeCatalogName(inputModel);
  const candidateTokens = tokenizeCatalogName(candidateModel);

  const categoryInput = normalizeCatalogText(input?.category || input?.categoria || "");
  const categoryCandidate = normalizeCatalogText(candidate?.category || candidate?.categoria || "");

  const exactName = normalizeCatalogText(inputName) === normalizeCatalogText(candidateName);
  const exactModel = Boolean(inputModel && candidateModel && inputModel === candidateModel);
  const modelScore = similarity(inputModel, candidateModel);
  const tokenScore = jaccard(inputTokens, candidateTokens);

  let score = 0;
  const reasons = [];

  if (exactName) {
    score += 45;
    reasons.push("nome exato");
  }

  if (exactModel) {
    score += 35;
    reasons.push("modelo-base exato");
  } else {
    score += Math.round(modelScore * 35);
  }

  score += Math.round(tokenScore * 15);

  if (categoryInput && categoryCandidate && categoryInput === categoryCandidate) {
    score += 10;
    reasons.push("mesma categoria");
  }

  const inputBrand = normalizeCatalogText(input?.brand || input?.marca || "");
  const candidateBrand = normalizeCatalogText(candidate?.brand || candidate?.marca || "");
  if (inputBrand && candidateBrand && inputBrand === candidateBrand) {
    score += 5;
    reasons.push("mesma marca");
  }

  const inputSupplier = String(input?.supplierId ?? input?.fornecedor_id ?? "");
  const candidateSupplier = String(candidate?.supplierId ?? candidate?.fornecedor_id ?? "");
  if (inputSupplier && candidateSupplier && inputSupplier === candidateSupplier) {
    score += 5;
    reasons.push("mesmo fornecedor");
  }

  return {
    score: Math.min(100, score),
    inputModelKey: inputModel,
    candidateModelKey: candidateModel,
    modelSimilarity: Number(modelScore.toFixed(4)),
    tokenScore: Number(tokenScore.toFixed(4)),
    reasons,
  };
}

export function resolveProductCandidate(input, candidates = [], options = {}) {
  const scored = candidates
    .map((candidate) => ({
      candidate,
      ...scoreProductMatch(input, candidate, options),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0] || null;

  if (!best) {
    return {
      action: "create",
      confidence: 0,
      candidate: null,
      alternatives: [],
      reasons: [],
    };
  }

  const action = best.score >= 90
    ? "associate"
    : best.score >= 70
      ? "suggest"
      : "create";

  return {
    action,
    confidence: best.score,
    candidate: action === "create" ? null : best.candidate,
    alternatives: scored.slice(1, 5),
    reasons: best.reasons,
    diagnostics: best,
  };
}
