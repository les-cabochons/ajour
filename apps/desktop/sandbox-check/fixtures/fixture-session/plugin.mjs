// An API 4 plugin that keeps a program running (#743): validating its
// connection opens a process session on a fake JSON-RPC server and keeps the
// session's id in the connection, and a sync, a later operation, talks to the
// same process through that id. The lifecycle check drives it.

/** Sends one request and reads until its answer arrives. */
async function call(session, id, method) {
  await ajour.process.session.send(
    session,
    JSON.stringify({ jsonrpc: "2.0", id, method }),
  );
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { lines, exited } = await ajour.process.session.read(session, {
      waitMs: 200,
    });
    for (const line of lines) {
      const message = JSON.parse(line);
      if (message.id === id) return message.result;
    }
    if (exited) throw new Error("The server exited.");
  }
  throw new Error(`No answer to ${method}.`);
}

export async function validateConnection(connection) {
  const session = await ajour.process.session.open({
    command: "rpc",
    args: { server: connection.config.server },
  });
  const result = await call(session, 1, "initialize");
  return {
    normalizedConfig: { ...connection.config, session },
    connectionSummary: { seen: result.seen },
  };
}

export async function syncConnection(connection) {
  const result = await call(connection.config.session, 2, "turn/start");
  return {
    items: [
      {
        source: "fixture-session",
        connectionId: connection.id,
        connectionLabel: connection.label,
        tenantLabel: connection.tenantLabel,
        sourceId: "answer",
        externalId: "ANSWER-1",
        title: JSON.stringify(result),
        workItemType: "Task",
        depth: 0,
      },
    ],
  };
}
