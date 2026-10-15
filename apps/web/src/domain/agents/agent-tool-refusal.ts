/**
 * A tool call Ajour refuses, such as an unknown id or an action the object's
 * action set disables. The message goes to the agent as is, so it says what
 * to do next.
 */
export class AgentToolRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentToolRefusal";
  }
}
