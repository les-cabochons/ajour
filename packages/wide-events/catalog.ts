// Entry point: Ajour's catalog of event names, and the helpers that declare
// one. Every field declares its privacy class, so a field without one fails
// to compile.
export { catalog } from "./lib/ajour-catalog.ts";
export type { AjourCatalog } from "./lib/ajour-catalog.ts";
export {
  defineCatalog,
  envelopeFields,
  operational,
  sensitive,
} from "./lib/fields.ts";
export type {
  Catalog,
  CounterName,
  EventName,
  EventSpec,
  Field,
  FieldsOf,
  FieldTree,
  FieldValues,
  KindOf,
  PrivacyClass,
  ReasonOf,
} from "./lib/fields.ts";
