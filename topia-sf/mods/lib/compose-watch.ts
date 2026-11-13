// The same chain can skip topia-sf's Salesforce guard. A person-gated tool asks the
// chain about a line the guard always catches, and refuses when the guard didn't
// answer. That shows the guard is in the chain now. It isn't a boundary: see
// docs/salesforce/README.md.
export const GUARD_MISSING =
  "Topia's Salesforce guard isn't answering in this session, so tools that need a person are refused. A plugin ahead of topia-sf may be answering for it; `claude --debug` names it."
