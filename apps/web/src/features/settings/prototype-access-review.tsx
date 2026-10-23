// PROTOTYPE, throwaway: Access review and credential management for existing
// plugins (les-cabochons/ajour#222). Never merge.
//
// Three variants of Access review on /settings/prototype-access, switchable
// with ?variant=A|B|C, each shown in the install, widened-update and installed
// scenes (?scene=). The other scenes show one proposal each, the same in every
// variant: connection forms, the Vault, the team secret and the edge states.
// Every value is stub data. Nothing calls the API.
import { useState, type ReactNode } from "react";
import {
  RiArrowLeftLine as ArrowLeft,
  RiCpuLine as Cpu,
  RiDownloadLine as Download,
  RiErrorWarningLine as Warning,
  RiFileCopyLine as Copy,
  RiGlobalLine as Globe,
  RiKey2Line as Key,
  RiPencilLine as Pencil,
  RiRefreshLine as Refresh,
  RiRobot2Line as Robot,
} from "@remixicon/react";
import { MessagePanel, SettingRow } from "@/components/app-surface";
import {
  PrototypeSwitcher,
  readPrototypeParam,
  writePrototypeParam,
} from "@/components/prototype-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { Switch } from "@/components/ui/switch";

const VARIANTS = [
  { key: "A", name: "Access on the plugin page" },
  { key: "B", name: "Review dialog at install" },
  { key: "C", name: "One Access review page" },
];

const SCENES = [
  { key: "install", name: "1. Install" },
  { key: "update", name: "2. Update that widens access" },
  { key: "installed", name: "3. Installed and active" },
  { key: "connection", name: "4. Connection and token (shared)" },
  { key: "vault", name: "5. Vault (shared)" },
  { key: "team", name: "6. Team secret (shared)" },
  { key: "states", name: "7. Edge states (shared)" },
];

type AccessItem = {
  kind: "network" | "credential" | "agent" | "runtime";
  title: string;
  detail: string;
  endpoints?: string[];
  isNew?: boolean;
};

const ADO_ACCESS: AccessItem[] = [
  {
    kind: "network",
    title: "Your Azure DevOps organisation",
    detail: "dev.azure.com, at the organisation each connection names",
    endpoints: [
      "POST _apis/wit/wiql",
      "POST _apis/wit/workitemsbatch",
      "GET _apis/wit/workitems/{id}",
      "PATCH _apis/wit/workitems/{id}",
      "GET _apis/git/pullrequests",
    ],
  },
  {
    kind: "credential",
    title: "The personal access token on each connection",
    detail: "Ajour adds it to each request. The plugin never sees it.",
  },
  {
    kind: "agent",
    title: "No agent tasks",
    detail: "Agents get nothing from this plugin.",
  },
  {
    kind: "runtime",
    title: "Loads when needed",
    detail: "Starts on its first call and closes 2 minutes after the last.",
  },
];

const ADO_NEW_ACCESS: AccessItem[] = [
  {
    kind: "network",
    title: "People in your organisation",
    detail: "vssps.dev.azure.com, to suggest people for @mentions",
    endpoints: ["GET _apis/identities"],
    isNew: true,
  },
  {
    kind: "network",
    title: "Work item comments",
    detail: "Read and add comments, in the same organisation",
    endpoints: [
      "GET _apis/wit/workItems/{id}/comments",
      "POST _apis/wit/workItems/{id}/comments",
    ],
    isNew: true,
  },
];

const KIND_ICON = {
  network: Globe,
  credential: Key,
  agent: Robot,
  runtime: Cpu,
};

function AccessList({ items }: { items: AccessItem[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => {
        const Icon = KIND_ICON[item.kind];
        return (
          <li key={item.title} className="flex items-start gap-3">
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                {item.title}
                {item.isNew ? <Chip tone="accent">New</Chip> : null}
              </p>
              <p className="text-[13px] text-[var(--text-secondary)]">
                {item.detail}
              </p>
              {item.endpoints ? (
                <details className="mt-1 text-xs text-[var(--text-tertiary)]">
                  <summary className="cursor-pointer select-none">
                    {item.endpoints.length} endpoint
                    {item.endpoints.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="mt-1 flex flex-col gap-0.5 font-mono">
                    {item.endpoints.map((endpoint) => (
                      <li key={endpoint}>{endpoint}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function BlockedLine() {
  return (
    <p className="flex items-start gap-2 text-[13px] text-[var(--warning)]">
      <Warning className="mt-0.5 size-4 shrink-0" />
      <span>
        Tried to connect directly, blocked. 2 times today, last at 14:32. Ajour
        sends a plugin's requests only through its own connections.
      </span>
    </p>
  );
}

function IdentityMark({ label = "AD" }: { label?: string }) {
  return (
    <div className="flex size-14 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--indigo-muted)] text-lg font-semibold text-primary">
      {label}
    </div>
  );
}

function PluginHeader({
  title = "Azure DevOps",
  description = "Import work items, sync estimates and follow pull requests.",
  action,
  badges,
  children,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  badges: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="settings-section">
      <span className="inline-flex items-center gap-1 text-[13px] text-[var(--text-secondary)]">
        <ArrowLeft className="size-4" /> All plugins
      </span>
      <div className="flex flex-col items-start gap-4 desktop:flex-row">
        <IdentityMark label={title.slice(0, 2)} />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
            {description}
          </p>
          <p className="mt-2 text-xs text-[var(--text-tertiary)]">
            Les Cabochons · Backlog, Code host · MIT
          </p>
        </div>
        {action ? <div className="w-full desktop:w-auto">{action}</div> : null}
      </div>
      <div className="flex flex-wrap gap-2">{badges}</div>
      {children}
    </section>
  );
}

function ActiveSwitch({ active }: { active: boolean }) {
  const [on, setOn] = useState(active);
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground">
        {on ? "Active" : "Inactive"}
      </span>
      <Switch
        checked={on}
        aria-label="Activate Azure DevOps"
        onCheckedChange={setOn}
      />
    </div>
  );
}

function FeaturesAndInfo({ extraInfo }: { extraInfo?: ReactNode }) {
  return (
    <>
      <section className="settings-section">
        <h2 className="settings-section-title">Features</h2>
        <p className="settings-section-desc">
          Backlog import, estimate sync, descriptions and comments, pull
          requests.
        </p>
      </section>
      <section className="settings-section">
        <h2 className="settings-section-title">Information</h2>
        <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-[13px]">
          <dt className="text-[var(--text-secondary)]">Compatibility</dt>
          <dd>Plugin API 4</dd>
          <dt className="text-[var(--text-secondary)]">Version</dt>
          <dd>1.1.0</dd>
          {extraInfo}
        </dl>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Variant A

function VariantA({ scene }: { scene: string }) {
  if (scene === "install") {
    return (
      <>
        <PluginHeader
          action={
            <Button>
              <Download data-icon="inline-start" />
              Download
            </Button>
          }
          badges={
            <>
              <Badge variant="outline">Available</Badge>
              <Badge variant="outline">Plugin API 4</Badge>
            </>
          }
        />
        <section className="settings-section">
          <h2 className="settings-section-title">Access</h2>
          <p className="settings-section-desc">
            What this plugin can reach. Ajour enforces it: anything else is
            blocked.
          </p>
          <AccessList items={ADO_ACCESS} />
        </section>
        <FeaturesAndInfo />
        <MessagePanel>
          After the download the plugin stays inactive. Turning it on allows the
          access above.
        </MessagePanel>
      </>
    );
  }
  if (scene === "update") {
    return (
      <>
        <PluginHeader
          action={<ActiveSwitch active={false} />}
          badges={
            <>
              <Badge variant="secondary">Installed</Badge>
              <Badge variant="outline">Inactive</Badge>
              <Badge variant="outline">Version 1.2.0</Badge>
            </>
          }
        >
          <MessagePanel tone="warning">
            <p className="font-medium">Version 1.2.0 needs more access</p>
            <p>
              It stays inactive until you allow it. Your connections and
              settings are kept.
            </p>
            <div className="mt-3">
              <AccessList items={ADO_NEW_ACCESS} />
            </div>
            <div className="mt-3 flex gap-2">
              <Button>Allow and activate</Button>
            </div>
          </MessagePanel>
        </PluginHeader>
        <section className="settings-section">
          <h2 className="settings-section-title">Access</h2>
          <AccessList items={[...ADO_NEW_ACCESS, ...ADO_ACCESS]} />
        </section>
        <FeaturesAndInfo />
      </>
    );
  }
  return (
    <>
      <PluginHeader
        action={<ActiveSwitch active />}
        badges={
          <>
            <Badge variant="secondary">Installed</Badge>
            <Badge variant="secondary">Active</Badge>
            <Badge variant="outline">Version 1.1.0</Badge>
            <Badge variant="outline">2 connections</Badge>
          </>
        }
      />
      <section className="settings-section">
        <h2 className="settings-section-title">Access</h2>
        <p className="settings-section-desc">
          Last request 3 minutes ago, through Contoso.
        </p>
        <AccessList items={ADO_ACCESS} />
        <BlockedLine />
      </section>
      <FeaturesAndInfo />
    </>
  );
}

// ---------------------------------------------------------------- Variant B

function ReviewDialog({
  update,
  open,
  onOpenChange,
}: {
  update: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {update
              ? "Azure DevOps 1.2.0 needs more access"
              : "Install Azure DevOps?"}
          </DialogTitle>
          <DialogDescription>
            {update
              ? "Version 1.1.0 keeps running until you allow this."
              : "This plugin can reach only what's listed. Ajour blocks everything else."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[50vh] flex-col gap-4 overflow-y-auto">
          {update ? (
            <>
              <p className="text-xs font-medium text-[var(--text-secondary)] uppercase">
                New in 1.2.0
              </p>
              <AccessList items={ADO_NEW_ACCESS} />
              <details className="text-[13px] text-[var(--text-secondary)]">
                <summary className="cursor-pointer">
                  Already allowed ({ADO_ACCESS.length})
                </summary>
                <div className="mt-3">
                  <AccessList items={ADO_ACCESS} />
                </div>
              </details>
            </>
          ) : (
            <AccessList items={ADO_ACCESS} />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {update ? "Not now" : "Cancel"}
          </Button>
          <Button onClick={() => onOpenChange(false)}>
            {update ? "Allow and update" : "Install"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VariantB({ scene }: { scene: string }) {
  const [open, setOpen] = useState(scene !== "installed");
  if (scene === "install" || scene === "update") {
    const update = scene === "update";
    return (
      <>
        <PluginHeader
          action={
            <Button onClick={() => setOpen(true)}>
              <Download data-icon="inline-start" />
              {update ? "Update to 1.2.0" : "Download"}
            </Button>
          }
          badges={
            update ? (
              <>
                <Badge variant="secondary">Installed</Badge>
                <Badge variant="secondary">Active</Badge>
                <Badge variant="outline">Version 1.1.0</Badge>
              </>
            ) : (
              <>
                <Badge variant="outline">Available</Badge>
                <Badge variant="outline">Plugin API 4</Badge>
              </>
            )
          }
        >
          {update ? (
            <MessagePanel>
              Version 1.2.0 is available. It needs more access, which you review
              before it installs.
            </MessagePanel>
          ) : null}
        </PluginHeader>
        <FeaturesAndInfo />
        <ReviewDialog update={update} open={open} onOpenChange={setOpen} />
      </>
    );
  }
  return (
    <>
      <PluginHeader
        action={<ActiveSwitch active />}
        badges={
          <>
            <Badge variant="secondary">Installed</Badge>
            <Badge variant="secondary">Active</Badge>
            <Badge variant="outline">Version 1.1.0</Badge>
          </>
        }
      >
        <MessagePanel tone="warning">
          <BlockedLine />
        </MessagePanel>
      </PluginHeader>
      <FeaturesAndInfo
        extraInfo={
          <>
            <dt className="text-[var(--text-secondary)]">Reaches</dt>
            <dd>dev.azure.com, your organisation only</dd>
            <dt className="text-[var(--text-secondary)]">Credentials</dt>
            <dd>The token on each connection, added by Ajour</dd>
            <dt className="text-[var(--text-secondary)]">Runs</dt>
            <dd>When needed</dd>
            <dt className="text-[var(--text-secondary)]" />
            <dd>
              <button type="button" className="text-primary underline">
                Review access
              </button>
            </dd>
          </>
        }
      />
    </>
  );
}

// ---------------------------------------------------------------- Variant C

function CentralRow({
  name,
  reaches,
  credential,
  lastUsed,
  blocked,
}: {
  name: string;
  reaches: string;
  credential: string;
  lastUsed: string;
  blocked?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--border-subtle)] py-3 desktop:grid desktop:grid-cols-[10rem_1fr_9rem] desktop:gap-4">
      <p className="text-sm font-medium text-foreground">{name}</p>
      <div className="text-[13px] text-[var(--text-secondary)]">
        <p>
          <Globe className="mr-1 inline size-3.5" />
          {reaches}
        </p>
        <p>
          <Key className="mr-1 inline size-3.5" />
          {credential}
        </p>
        {blocked ? (
          <div className="mt-1">
            <BlockedLine />
          </div>
        ) : null}
      </div>
      <p className="text-xs text-[var(--text-tertiary)]">{lastUsed}</p>
    </div>
  );
}

function VariantC({ scene }: { scene: string }) {
  if (scene === "install") {
    return (
      <>
        <PluginHeader
          action={
            <Button>
              <Download data-icon="inline-start" />
              Download
            </Button>
          }
          badges={
            <>
              <Badge variant="outline">Available</Badge>
              <Badge variant="outline">Plugin API 4</Badge>
            </>
          }
        >
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--text-secondary)]">
            <span>
              <Globe className="mr-1 inline size-3.5" />
              Reaches 1 site
            </span>
            <span>
              <Key className="mr-1 inline size-3.5" />
              Uses your token through Ajour
            </span>
            <span>
              <Cpu className="mr-1 inline size-3.5" />
              Loads when needed
            </span>
            <button type="button" className="text-primary underline">
              Details in Access review
            </button>
          </p>
        </PluginHeader>
        <FeaturesAndInfo />
      </>
    );
  }
  return (
    <>
      <section className="settings-section">
        <h1 className="text-lg font-semibold text-foreground">Access review</h1>
        <p className="settings-section-desc">
          What each plugin can reach and what it used. Ajour blocks anything not
          listed.
        </p>
        {scene === "update" ? (
          <MessagePanel tone="warning">
            <p className="font-medium">
              Waiting for you: Azure DevOps 1.2.0 needs more access
            </p>
            <p>It stays inactive until you allow it.</p>
            <div className="mt-3">
              <AccessList items={ADO_NEW_ACCESS} />
            </div>
            <div className="mt-3 flex gap-2">
              <Button>Allow and activate</Button>
              <Button variant="outline">Keep inactive</Button>
            </div>
          </MessagePanel>
        ) : null}
      </section>
      <section className="settings-section">
        <h2 className="settings-section-title">Plugins</h2>
        <div>
          <CentralRow
            name="Azure DevOps"
            reaches="dev.azure.com, your organisation"
            credential="Token on 2 connections"
            lastUsed="3 minutes ago"
            blocked
          />
          <CentralRow
            name="GitHub"
            reaches="api.github.com or your server"
            credential="Token on 1 connection"
            lastUsed="1 hour ago"
          />
          <CentralRow
            name="Calendar (ICS)"
            reaches="The secret address on each connection"
            credential="The address is the secret"
            lastUsed="12 minutes ago"
          />
          <CentralRow
            name="Workday agent"
            reaches="Nothing. The agent task gets your Workday URL and user name"
            credential="No credential"
            lastUsed="Friday"
          />
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Shared scenes

type SecretState = "saved" | "rejected" | "unreadable" | "expiring" | "empty";

const SECRET_CHIP: Record<
  SecretState,
  { label: string; tone: "neutral" | "warning" | "danger" }
> = {
  saved: { label: "Saved", tone: "neutral" },
  expiring: { label: "Expires in 5 days", tone: "warning" },
  rejected: { label: "Token rejected", tone: "danger" },
  unreadable: { label: "Can't be read on this computer", tone: "danger" },
  empty: { label: "Not set", tone: "warning" },
};

function SecretField({
  label,
  state,
  meta,
}: {
  label: string;
  state: SecretState;
  meta?: string;
}) {
  const [replacing, setReplacing] = useState(false);
  const chip = SECRET_CHIP[state];
  return (
    <Field className="desktop:col-span-2">
      <FieldLabel>{label}</FieldLabel>
      <FieldContent>
        {replacing || state === "empty" ? (
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="Paste the new token"
              autoFocus
            />
            {state !== "empty" ? (
              <Button variant="outline" onClick={() => setReplacing(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={chip.tone}>{chip.label}</Chip>
            {meta ? (
              <span className="text-xs text-[var(--text-tertiary)]">
                {meta}
              </span>
            ) : null}
            <span className="flex-1" />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReplacing(true)}
            >
              {state === "saved" ? "Replace" : "Replace token"}
            </Button>
            <Button size="sm" variant="ghost">
              Remove
            </Button>
          </div>
        )}
        <FieldDescription>
          Ajour never shows a saved token. Replace pastes a new one, and Remove
          pauses the connection until one is added.
        </FieldDescription>
      </FieldContent>
    </Field>
  );
}

function AccessChoice({
  title,
  description,
  checked,
  disabled,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
}) {
  const [on, setOn] = useState(checked);
  return (
    <Field orientation="horizontal">
      <Checkbox
        checked={on}
        disabled={disabled}
        onCheckedChange={(value) => setOn(value === true)}
        className="mt-0.5"
      />
      <FieldContent>
        <FieldTitle>{title}</FieldTitle>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
    </Field>
  );
}

function ConnectionRow({
  label,
  chip,
  tone,
  note,
}: {
  label: string;
  chip: string;
  tone: "neutral" | "warning" | "danger" | "success";
  note?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--border-subtle)] py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <Chip tone={tone}>{chip}</Chip>
        <Badge variant="outline">Reads backlog</Badge>
        <span className="flex-1" />
        <Button size="sm" variant="ghost">
          <Pencil data-icon="inline-start" />
          Edit
        </Button>
        <Button size="sm" variant="ghost">
          <Refresh data-icon="inline-start" />
          Sync
        </Button>
      </div>
      {note ? (
        <div className="text-[13px] text-[var(--text-secondary)]">{note}</div>
      ) : null}
    </div>
  );
}

function ConnectionScene() {
  const [start, setStart] = useState("whenNeeded");
  return (
    <>
      <section className="settings-section">
        <h2 className="settings-section-title">Configuration</h2>
        <div>
          <ConnectionRow
            label="Contoso"
            chip="Connected"
            tone="success"
            note="3 changes held. Turn on editing to review and send them."
          />
          <ConnectionRow
            label="Fabrikam"
            chip="Token rejected"
            tone="danger"
            note="Azure DevOps refused the token. Sync is paused. Edit the connection to replace it."
          />
          <ConnectionRow
            label="Northwind"
            chip="Can't be read on this computer"
            tone="danger"
            note="Its settings and data are kept. Paste the token again to resume sync."
          />
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Edit Contoso</h2>
        <div className="grid gap-4 desktop:grid-cols-2">
          <Field>
            <FieldLabel>Organization URL</FieldLabel>
            <Input defaultValue="https://dev.azure.com/contoso" />
          </Field>
          <Field>
            <FieldLabel>Token expires on (optional)</FieldLabel>
            <Input type="date" defaultValue="2026-10-28" />
            <FieldDescription>
              A reminder only. Ajour keeps using the token after this date.
            </FieldDescription>
          </Field>
          <SecretField
            label="Personal access token"
            state="saved"
            meta="Last used 2 hours ago · Expires in 5 days"
          />
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-foreground">Access</h3>
          <p className="settings-section-desc">
            Ajour blocks anything not chosen here, even when the token allows
            more.
          </p>
          <AccessChoice
            title="Read the backlog"
            description="Work items, queries and pull request status. Always on."
            checked
            disabled
          />
          <AccessChoice
            title="Edit work items"
            description="Send estimates, settled work, descriptions and comments. The token needs Work Items (Read & write)."
            checked={false}
          />
          <MessagePanel>
            3 changes made while editing was off are held on this computer. When
            you turn editing on, you review them before anything is sent.
          </MessagePanel>
          <AccessChoice
            title="Pull requests"
            description="Read pull requests you're involved in. The token needs Code (Read)."
            checked={false}
          />
          <AccessChoice
            title="Search people across the organisation"
            description="Suggest anyone in Contoso for @mentions, not only people on your items. The token needs Identity (Read)."
            checked={false}
          />
        </div>
        <div className="flex gap-2">
          <Button>Save</Button>
          <Button variant="outline">Cancel</Button>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Advanced</h2>
        <SettingRow
          label="Start"
          description={
            start === "always"
              ? "Starts with Ajour and keeps running. Uses about 30 MB."
              : "Starts on its first call and closes 2 minutes after the last."
          }
        >
          <OptionSelect
            label="Start"
            value={start}
            onChange={setStart}
            options={[
              { value: "whenNeeded", label: "Load when needed" },
              { value: "always", label: "Always ready" },
            ]}
          />
        </SettingRow>
        <SettingRow
          label="Memory ceiling"
          description="Ajour closes the plugin above this. 64 MB to 2 GB. The default is 256 MB."
        >
          <div className="flex items-center gap-2">
            <Input className="w-24" type="number" defaultValue={256} />
            <span className="text-sm text-muted-foreground">MB</span>
          </div>
        </SettingRow>
      </section>
    </>
  );
}

function VaultRow({
  connection,
  kind,
  lastUsed,
  state,
  action,
}: {
  connection: string;
  kind: string;
  lastUsed: string;
  state?: { label: string; tone: "warning" | "danger" | "neutral" };
  action: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border-subtle)] py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{connection}</p>
        <p className="text-xs text-[var(--text-tertiary)]">
          {kind} · {lastUsed}
        </p>
      </div>
      {state ? <Chip tone={state.tone}>{state.label}</Chip> : null}
      {action}
    </div>
  );
}

function VaultScene() {
  return (
    <>
      <section className="settings-section">
        <h1 className="text-lg font-semibold text-foreground">Vault</h1>
        <p className="settings-section-desc">
          Every secret Ajour holds on this computer, encrypted by the operating
          system. Ajour never shows or copies a saved value, and plugins never
          receive one.
        </p>
      </section>
      <section className="settings-section">
        <h2 className="settings-section-title">Azure DevOps</h2>
        <div>
          <VaultRow
            connection="Contoso"
            kind="Personal access token"
            lastUsed="Last used 2 hours ago"
            state={{ label: "Expires in 5 days", tone: "warning" }}
            action={
              <Button size="sm" variant="outline">
                Replace
              </Button>
            }
          />
          <VaultRow
            connection="Fabrikam"
            kind="Personal access token"
            lastUsed="Last used yesterday"
            state={{ label: "Token rejected", tone: "danger" }}
            action={
              <Button size="sm" variant="outline">
                Replace token
              </Button>
            }
          />
        </div>
      </section>
      <section className="settings-section">
        <h2 className="settings-section-title">Calendar (ICS)</h2>
        <VaultRow
          connection="Work calendar"
          kind="Secret address"
          lastUsed="Last used 12 minutes ago"
          action={
            <Button size="sm" variant="outline">
              Replace
            </Button>
          }
        />
      </section>
      <section className="settings-section">
        <h2 className="settings-section-title">Team sync</h2>
        <VaultRow
          connection="Studio team"
          kind="Team secret"
          lastUsed="Last used 5 minutes ago"
          action={
            <>
              <Button size="sm" variant="outline">
                Replace
              </Button>
              <Button size="sm" variant="outline">
                Rotate
              </Button>
            </>
          }
        />
      </section>
      <section className="settings-section">
        <h2 className="settings-section-title">Jira (not installed)</h2>
        <VaultRow
          connection="Acme"
          kind="Saved settings and API token"
          lastUsed="Last used in August"
          action={
            <Button size="sm" variant="ghost">
              Remove
            </Button>
          }
        />
      </section>
    </>
  );
}

function TeamScene() {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [open, setOpen] = useState(true);
  return (
    <>
      <section className="settings-section">
        <h2 className="settings-section-title">Add a connection</h2>
        <div className="flex gap-2">
          <Button
            variant={mode === "create" ? "default" : "outline"}
            onClick={() => setMode("create")}
          >
            Create a team
          </Button>
          <Button
            variant={mode === "join" ? "default" : "outline"}
            onClick={() => setMode("join")}
          >
            Join a team
          </Button>
        </div>
        {mode === "create" ? (
          <div className="grid gap-4 desktop:grid-cols-2">
            <Field>
              <FieldLabel>Team name</FieldLabel>
              <Input defaultValue="Studio team" />
            </Field>
            <div className="flex items-end">
              <Button onClick={() => setOpen(true)}>Create</Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 desktop:grid-cols-2">
            <Field>
              <FieldLabel>Team ID</FieldLabel>
              <Input placeholder="From the teammate who created it" />
            </Field>
            <SecretField label="Team secret" state="empty" />
          </div>
        )}
      </section>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Save the team secret</DialogTitle>
            <DialogDescription>
              Ajour shows it only now. Save it in a password manager, then share
              it with your teammates outside Ajour.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-[var(--radius-md)] bg-muted px-3 py-2 font-mono text-sm break-all">
            <span className="flex-1">tm_8Q2v-RkPz-71Lc-Wd0e-Hs4N</span>
            <Button size="sm" variant="outline">
              <Copy data-icon="inline-start" />
              Copy
            </Button>
          </div>
          <p className="text-[13px] text-[var(--text-secondary)]">
            Team ID: studio-7f3a. If the secret is lost, you rotate it from the
            Vault and share the new one.
          </p>
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>I saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatesScene() {
  return (
    <>
      <section className="settings-section">
        <h2 className="settings-section-title">
          Plugins page, sandbox missing
        </h2>
        <MessagePanel tone="warning">
          <p className="font-medium">
            Plugins are turned off: this computer can't run them in a sandbox
          </p>
          <p>
            Ajour was started with --no-sandbox. Your synced data stays, and
            sync is paused.
          </p>
        </MessagePanel>
      </section>
      <section className="settings-section">
        <h2 className="settings-section-title">Plugin page, still on API 3</h2>
        <MessagePanel tone="warning">
          <p className="font-medium">This plugin needs an update</p>
          <p>
            Its connections and settings are kept, and sync is paused until it
            is updated.
          </p>
          <div className="mt-3">
            <Button>Update</Button>
          </div>
        </MessagePanel>
      </section>
      <section className="settings-section">
        <h2 className="settings-section-title">Plugin page, suspended</h2>
        <MessagePanel tone="warning">
          <p className="font-medium">This plugin keeps stopping</p>
          <p>
            It used too much memory 3 times in 10 minutes. Its calls fail until
            you turn it back on.
          </p>
          <div className="mt-3">
            <Button>Turn back on</Button>
          </div>
        </MessagePanel>
      </section>
      <section className="settings-section">
        <h2 className="settings-section-title">
          Vault, encryption unavailable
        </h2>
        <MessagePanel tone="warning">
          <p className="font-medium">
            Ajour can't protect credentials on this computer
          </p>
          <p>
            The system keychain refused access. Connections that need a token
            are paused, and token fields are disabled.
          </p>
          <div className="mt-3">
            <Button variant="outline">Try again</Button>
          </div>
        </MessagePanel>
      </section>
      <section className="settings-section">
        <h2 className="settings-section-title">Vault, unreadable</h2>
        <MessagePanel tone="warning">
          <p className="font-medium">
            Saved secrets can't be read on this computer
          </p>
          <p>
            This happens after moving Ajour's data to another computer or
            resetting the account password. Connections keep their settings.
            Paste each token again to resume sync.
          </p>
        </MessagePanel>
      </section>
      <section className="settings-section">
        <h2 className="settings-section-title">Browser or standalone API</h2>
        <MessagePanel>Plugins need the desktop app.</MessagePanel>
      </section>
    </>
  );
}

export function PrototypeAccessReviewPage() {
  const [variant, setVariant] = useState(() =>
    readPrototypeParam("variant", "A"),
  );
  const [scene, setScene] = useState(() =>
    readPrototypeParam("scene", "install"),
  );
  const choose =
    (name: string, set: (value: string) => void) => (value: string) => {
      writePrototypeParam(name, value);
      set(value);
    };
  const shared = ["connection", "vault", "team", "states"].includes(scene);

  return (
    <div className="settings-sections pb-24" key={`${variant}-${scene}`}>
      {shared ? (
        scene === "connection" ? (
          <ConnectionScene />
        ) : scene === "vault" ? (
          <VaultScene />
        ) : scene === "team" ? (
          <TeamScene />
        ) : (
          <StatesScene />
        )
      ) : variant === "B" ? (
        <VariantB scene={scene} />
      ) : variant === "C" ? (
        <VariantC scene={scene} />
      ) : (
        <VariantA scene={scene} />
      )}
      <PrototypeSwitcher
        variants={VARIANTS}
        variant={variant}
        onVariant={choose("variant", setVariant)}
        scenes={SCENES}
        scene={scene}
        onScene={choose("scene", setScene)}
      />
    </div>
  );
}
