// Entry point: Ajour's catalog of event names, and the helpers that declare
// one. Every field declares its privacy class, so a field without one fails
// to compile.
export { catalog } from "./lib/ajour-catalog.ts";
export type {
  AjourCatalog,
  AjourEvent,
  HttpMethod,
  McpMethod,
  PluginRequestAnswerAddress,
  PluginRequestHostKind,
} from "./lib/ajour-catalog.ts";
export { APP_API_CLIENT, rendererEmits } from "./lib/renderer-emits.ts";
export type { ClientEventName } from "./lib/renderer-emits.ts";
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
  EventOf,
  EventSpec,
  Field,
  FieldsOf,
  FieldTree,
  FieldValues,
  KindOf,
  PrivacyClass,
  ReasonOf,
} from "./lib/fields.ts";
