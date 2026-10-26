// A fake `ajour` for plugin tests, which answers from fixtures. See README.md.
export {
  createFakeAjour,
  routeMatches,
  type FakeAjour,
  type FakeAjourOptions,
  type FakeHttpRoute,
  type FakeLogLine,
  type FakePublicRoute,
  type FakeResponder,
  type FakeResponseInit,
  type RecordedHttpRequest,
  type RecordedPublicRequest,
} from "./lib/fake.js";
