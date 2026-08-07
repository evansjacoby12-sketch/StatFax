/**
 * Version markers for the production HR ranking and probability pipeline.
 *
 * Increment HR_MODEL_VERSION when score/ranking math changes. Increment
 * HR_PROBABILITY_PIPELINE_VERSION when the published probability path changes.
 * Historical evaluation must compare like with like; these values are frozen
 * onto every pregame prediction record.
 */
export const HR_MODEL_VERSION = 2;
export const HR_PROBABILITY_PIPELINE_VERSION = 2;
export const HR_PROBABILITY_TELEMETRY_VERSION = 1;
