import { modelFor,describeChoice } from "./providers";

/** Kept for callers that only need to name the model that reads documents.
 * The routing itself lives in providers.ts. */
export function readingProvider(){return modelFor("reading").provider;}
export function readingModelName(){return modelFor("reading").model;}
export function readingModelLabel(){return describeChoice(modelFor("reading"));}
