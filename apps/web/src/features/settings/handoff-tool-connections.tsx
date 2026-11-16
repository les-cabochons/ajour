import { useEffect, useMemo, useState } from "react";
import type { HandoffToolConnections } from "@ajour/shared/handoffs";
import { SettingRow } from "@/components/app-surface";
import { OptionSelect } from "@/components/ui/option-select";
import {
  getHandoffToolConnections,
  saveHandoffToolConnections,
} from "@/lib/app-api";

interface Tool {
  id: string;
  label: string;
  connection?: "required" | "none";
}

/**
 * The connection each handoff tool that uses one hands off through, on the
 * plugin's page. Detection runs for the picked connection, and a start uses
 * it. Without a pick, the plugin's only connection is used.
 */
export function PluginHandoffConnections({
  pluginId,
  tools,
  connections,
}: {
  pluginId: string;
  tools: readonly Tool[];
  connections: readonly { id: string; label: string }[];
}) {
  const connected = tools.filter((tool) => tool.connection === "required");
  const [loaded, setLoaded] = useState<HandoffToolConnections>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const uses = connected.length > 0;
  useEffect(() => {
    if (!uses) return;
    let live = true;
    setLoaded(undefined);
    setError("");
    void getHandoffToolConnections(pluginId)
      .then((value) => {
        if (live) setLoaded(value);
      })
      .catch((reason: unknown) => {
        if (live)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not read the tools' connections.",
          );
      });
    return () => {
      live = false;
    };
  }, [pluginId, uses]);
  // A pick whose connection was deleted since the picks loaded is gone: the
  // server forgot it, and saving it again would refuse every other pick.
  const picks = useMemo(
    () =>
      loaded &&
      Object.fromEntries(
        Object.entries(loaded).filter(([, id]) =>
          connections.some((connection) => connection.id === id),
        ),
      ),
    [loaded, connections],
  );
  if (!uses) return null;

  const pick = async (toolId: string, connectionId: string) => {
    if (!picks || !connectionId) return;
    setSaving(true);
    setError("");
    try {
      setLoaded(
        await saveHandoffToolConnections(pluginId, {
          ...picks,
          [toolId]: connectionId,
        }),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save the tool's connection.",
      );
    } finally {
      setSaving(false);
    }
  };
  const only = connections.length === 1 ? connections[0] : undefined;

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Handoff connections</h2>
      <p className="settings-section-desc">
        The connection each tool hands off through. Ajour detects the tool and
        reads its handoffs through it.
      </p>
      {connected.map((tool) => {
        const picked = picks?.[tool.id] ?? "";
        return (
          <SettingRow
            key={tool.id}
            label={tool.label}
            description={
              connections.length === 0
                ? `Add a connection above. ${tool.label} hands off through one.`
                : !picked && only
                  ? `Uses ${only.label}, the plugin's only connection.`
                  : undefined
            }
          >
            {connections.length > 0 && picks ? (
              <OptionSelect
                label={`${tool.label} connection`}
                value={picked}
                disabled={saving}
                onChange={(value) => void pick(tool.id, value)}
                options={[
                  ...(picked
                    ? []
                    : [
                        {
                          value: "",
                          label: "Choose a connection",
                          disabled: true,
                        },
                      ]),
                  ...connections.map((connection) => ({
                    value: connection.id,
                    label: connection.label,
                  })),
                ]}
              />
            ) : null}
          </SettingRow>
        );
      })}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
