import { answerFormatLabels, config } from "./config";
import type { AnswerFormatKey, AnswerInsertModeKey, SolverInput, SolverResult } from "./types";

export { answerFormatLabels };

export const formatRationalAsLatex = (numerator: string, denominator: string): string => {
  if (denominator === "1") return numerator;
  return `\\frac{${numerator}}{${denominator}}`;
};

const trimTrailingZeros = (value: string): string => value.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");

export const formatDecimalFromRational = (numerator: string, denominator: string, places: number): string => {
  const num = BigInt(numerator);
  const den = BigInt(denominator);
  if (den === 0n) {
    throw new Error("Cannot format decimal from zero denominator");
  }

  const negative = (num < 0n) !== (den < 0n);
  const absNum = num < 0n ? -num : num;
  const absDen = den < 0n ? -den : den;
  const scale = 10n ** BigInt(places);
  const roundedScaled = (absNum * scale * 2n + absDen) / (2n * absDen);
  const integerPart = roundedScaled / scale;
  const fractionalPart = roundedScaled % scale;
  const decimal = places > 0 ? `${integerPart}.${fractionalPart.toString().padStart(places, "0")}` : integerPart.toString();
  const trimmed = trimTrailingZeros(decimal);
  return negative && trimmed !== "0" ? `-${trimmed}` : trimmed;
};

export const formatMixedFromRational = (numerator: string, denominator: string): string => {
  const num = BigInt(numerator);
  const den = BigInt(denominator);
  if (den === 0n) {
    throw new Error("Cannot format mixed number from zero denominator");
  }

  const normalizedDen = den < 0n ? -den : den;
  const normalizedNum = den < 0n ? -num : num;
  const whole = normalizedNum / normalizedDen;
  const remainder = normalizedNum % normalizedDen;

  if (remainder === 0n) {
    return whole.toString();
  }

  const absWhole = whole < 0n ? -whole : whole;
  const absRemainder = remainder < 0n ? -remainder : remainder;

  if (whole === 0n) {
    return formatRationalAsLatex(normalizedNum.toString(), normalizedDen.toString());
  }

  if (whole < 0n) {
    return `-${absWhole.toString()}-${formatRationalAsLatex(absRemainder.toString(), normalizedDen.toString())}`;
  }

  return `${whole.toString()}+${formatRationalAsLatex(absRemainder.toString(), normalizedDen.toString())}`;
};

export const formatIntegerInBase = (value: string, base: number): string => {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let integer = BigInt(value);
  const isNegative = integer < 0n;
  if (isNegative) {
    integer = -integer;
  }

  if (integer === 0n) {
    return `0_{${base}}`;
  }

  let digits = "";
  const bigBase = BigInt(base);
  while (integer > 0n) {
    const digit = Number(integer % bigBase);
    digits = alphabet[digit] + digits;
    integer /= bigBase;
  }

  return `${isNegative ? "-" : ""}${digits}_{${base}}`;
};

export const formatBaseConvertedResult = (
  result: SolverResult,
  targetBase: number
): { latex: string; fallbackReason: string | null } => {
  if (!result.isRational || !result.numerator || !result.denominator) {
    throw new Error("Base conversion requires an exact rational solver result");
  }

  if (result.denominator !== "1") {
    throw new Error("Base conversion currently supports integer results only");
  }

  return {
    latex: formatIntegerInBase(result.numerator, targetBase),
    fallbackReason: null
  };
};

export const formatSolverResult = (
  result: SolverResult,
  format: AnswerFormatKey
): { latex: string; fallbackReason: string | null } => {
  if (format === "fraction") {
    return { latex: result.latex, fallbackReason: null };
  }

  if (result.isRational && result.numerator && result.denominator) {
    if (format === "decimal") {
      return {
        latex: formatDecimalFromRational(result.numerator, result.denominator, config.solver.decimalPlaces),
        fallbackReason: null
      };
    }

    return {
      latex: formatMixedFromRational(result.numerator, result.denominator),
      fallbackReason: null
    };
  }

  return {
    latex: result.latex,
    fallbackReason: `${format}-requires-rational`
  };
};

export const buildInsertedAnswerLatex = (
  solverInput: SolverInput,
  formattedAnswer: string,
  insertMode: AnswerInsertModeKey
): string => {
  const rawInsertionLatex =
    insertMode === "replace" ? formattedAnswer : `${solverInput.hasEquationTail ? "" : "="}${formattedAnswer}`;
  return solverInput.isWrappedMathSelection ? "$" + rawInsertionLatex + "$" : rawInsertionLatex;
};

export const describeSolverError = (error: unknown): string => {
  const rawMessage = error instanceof Error ? error.message : String(error);

  if (/Target base must be between 2 and 36/u.test(rawMessage)) {
    return "Use a target base between 2 and 36, like \\rightarrow _{2}.";
  }

  if (/Base output syntax is incomplete/u.test(rawMessage)) {
    return "Finish the base output syntax, for example \\rightarrow _{2}.";
  }

  const invalidDigitMatch = rawMessage.match(/Invalid digit '(.+)' for base (\d+)/u);
  if (invalidDigitMatch) {
    return `Digit ${invalidDigitMatch[1]} is not valid in base ${invalidDigitMatch[2]}.`;
  }

  const unsupportedBaseMatch = rawMessage.match(/Unsupported input base: (\d+)/u);
  if (unsupportedBaseMatch) {
    return `Input base ${unsupportedBaseMatch[1]} is not supported. Use a base from 2 to 36.`;
  }

  if (/Base conversion currently supports integer results only/u.test(rawMessage)) {
    return "Base conversion currently works only for whole-number results.";
  }

  if (/No runtime LaTeX selection available for solver/u.test(rawMessage)) {
    return "Select a math expression first.";
  }

  if (/Selected LaTeX is empty after solver normalization/u.test(rawMessage)) {
    return "The selected expression is empty after cleanup.";
  }

  if (/I don't understand this|I expected|syntaxError|InputMismatchException/u.test(rawMessage)) {
    return "Mathcha Toolkit could not parse that expression. Check the base syntax and try again.";
  }

  return "Failed to solve the selected expression.";
};
