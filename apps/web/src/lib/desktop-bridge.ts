import type {
  ConnectorPluginInstallResponse,
  ConnectorPluginUninstallResponse,
} from "@timetracker/shared";
import type { LocalAppState } from "@/domain/local-state";

export interface DevelopmentPluginSettings {
  available: boolean;
  directories: string[];
}

declare global {
  interface Window {
    timetrackerDesktop?: {
      bootstrapLocalState?: Partial<LocalAppState> | null;
      runtime?: {
        developmentBuild: boolean;
        platform: string;
      };
      setWindowChromeTheme?: (theme: "dark" | "light") => void;
      installConnectorPlugin?: () => Promise<
        ConnectorPluginInstallResponse | null
      >;
      uninstallConnectorPlugin?: (
        pluginId: string,
      ) => Promise<ConnectorPluginUninstallResponse>;
      getDevelopmentPluginSettings?: () => Promise<DevelopmentPluginSettings>;
      selectDevelopmentPluginDirectory?: () => Promise<DevelopmentPluginSettings | null>;
      clearDevelopmentPluginDirectories?: () => Promise<DevelopmentPluginSettings>;
    };
  }
}

export {};
