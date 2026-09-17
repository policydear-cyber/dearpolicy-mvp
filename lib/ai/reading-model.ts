import { modelFor,describeChoice } from "./providers";

/** Kept for callers that only need to know whether documents are read
 * locally or by a hosted model. The routing itself lives in providers.ts. */
export function readingProvider(){return modelFor("reading").provider;}
export function groqModel(){return modelFor("reading").model;}
export function readingModelLabel(){return describeChoice(modelFor("reading"));}
