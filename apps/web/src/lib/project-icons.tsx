import type { ComponentType } from "react";
import {
  RiAppleLine as AppleIcon,
  RiApps2Line as GridIcon,
  RiArchiveStackLine as LayersIcon,
  RiBankCardLine as CardIcon,
  RiBarChartBoxLine as ChartIcon,
  RiBarChartGroupedLine as AnalyticsIcon,
  RiBaseballLine as BaseballIcon,
  RiBasketballLine as BasketballIcon,
  RiBellLine as BellIcon,
  RiBookOpenLine as BookIcon,
  RiBookmarkLine as BookmarkIcon,
  RiBriefcase4Line as BriefcaseIcon,
  RiBrushLine as BrushIcon,
  RiBugLine as BugIcon,
  RiBuilding2Line as BuildingIcon,
  RiCalculatorLine as CalculatorIcon,
  RiCalendar2Line as CalendarIcon,
  RiCamera2Line as CameraIcon,
  RiCheckboxCircleLine as CheckCircleIcon,
  RiCloudLine as CloudIcon,
  RiCodeSSlashLine as CodeIcon,
  RiContactsBook2Line as ContactsIcon,
  RiCpuLine as CpuIcon,
  RiCupLine as CupIcon,
  RiCustomerService2Line as SupportIcon,
  RiDatabase2Line as DatabaseIcon,
  RiDropLine as DropIcon,
  RiEyeLine as EyeIcon,
  RiFileChartLine as ReportIcon,
  RiFingerprintLine as FingerprintIcon,
  RiFlag2Line as FlagIcon,
  RiFlashlightLine as FlashIcon,
  RiFlaskLine as FlaskIcon,
  RiFolderLine as FolderIcon,
  RiGamepadLine as GamepadIcon,
  RiGift2Line as GiftIcon,
  RiGlobalLine as GlobeIcon,
  RiGobletLine as GobletIcon,
  RiHeartLine as HeartIcon,
  RiHome5Line as HomeIcon,
  RiHotelBedLine as BedIcon,
  RiImage2Line as ImageIcon,
  RiKey2Line as KeyIcon,
  RiLeafLine as LeafIcon,
  RiLightbulbLine as LightbulbIcon,
  RiLock2Line as LockIcon,
  RiMailLine as MailIcon,
  RiMapPinLine as MapPinIcon,
  RiMegaphoneLine as MegaphoneIcon,
  RiMedicineBottleLine as MedicineIcon,
  RiMessage3Line as MessageIcon,
  RiMovie2Line as MovieIcon,
  RiMusic2Line as MusicIcon,
  RiPaletteLine as PaletteIcon,
  RiPhoneLine as PhoneIcon,
  RiPlaneLine as PlaneIcon,
  RiPuzzleLine as PuzzleIcon,
  RiRestaurantLine as RestaurantIcon,
  RiRocket2Line as RocketIcon,
  RiRssLine as RssIcon,
  RiScales3Line as ScalesIcon,
  RiSeedlingLine as SeedlingIcon,
  RiSettings3Line as SettingsIcon,
  RiShieldStarLine as ShieldIcon,
  RiTerminalBoxLine as TerminalIcon,
  RiToolsLine as ToolsIcon,
} from "@remixicon/react";
import {
  DEFAULT_PROJECT_ICON,
  normalizeProjectIcon,
  type LocalProjectIcon,
  type ProjectIconName,
} from "@/domain/projects/project-icon";
import { cn } from "@/lib/utils";

export {
  DEFAULT_PROJECT_ICON,
  isProjectIconName,
  normalizeProjectIcon,
  type LocalProjectIcon,
  type ProjectIconName,
} from "@/domain/projects/project-icon";

function DotIcon({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex h-full w-full items-center justify-center",
        className,
      )}
    >
      <span className="h-[60%] w-[60%] rounded-full bg-current" />
    </span>
  );
}

export const PROJECT_ICON_PRESETS = [
  { name: "dot", label: "Dot", Icon: DotIcon },
  { name: "plane", label: "Plane", Icon: PlaneIcon },
  { name: "bookmark", label: "Bookmark", Icon: BookmarkIcon },
  { name: "book", label: "Book", Icon: BookIcon },
  { name: "briefcase", label: "Briefcase", Icon: BriefcaseIcon },
  { name: "bed", label: "Bed", Icon: BedIcon },
  { name: "bell", label: "Bell", Icon: BellIcon },
  { name: "code", label: "Code", Icon: CodeIcon },
  { name: "terminal", label: "Terminal", Icon: TerminalIcon },
  { name: "chart", label: "Chart", Icon: ChartIcon },
  { name: "analytics", label: "Analytics", Icon: AnalyticsIcon },
  { name: "megaphone", label: "Megaphone", Icon: MegaphoneIcon },
  { name: "brush", label: "Brush", Icon: BrushIcon },
  { name: "bug", label: "Bug", Icon: BugIcon },
  { name: "tools", label: "Tools", Icon: ToolsIcon },
  { name: "settings", label: "Settings", Icon: SettingsIcon },
  { name: "cup", label: "Cup", Icon: CupIcon },
  { name: "phone", label: "Phone", Icon: PhoneIcon },
  { name: "card", label: "Card", Icon: CardIcon },
  { name: "message", label: "Message", Icon: MessageIcon },
  { name: "check-circle", label: "Check Circle", Icon: CheckCircleIcon },
  { name: "cloud", label: "Cloud", Icon: CloudIcon },
  { name: "database", label: "Database", Icon: DatabaseIcon },
  { name: "puzzle", label: "Puzzle", Icon: PuzzleIcon },
  { name: "eye", label: "Eye", Icon: EyeIcon },
  { name: "drop", label: "Drop", Icon: DropIcon },
  { name: "apple", label: "Apple", Icon: AppleIcon },
  { name: "restaurant", label: "Restaurant", Icon: RestaurantIcon },
  { name: "goblet", label: "Goblet", Icon: GobletIcon },
  { name: "flask", label: "Flask", Icon: FlaskIcon },
  { name: "folder", label: "Folder", Icon: FolderIcon },
  { name: "gamepad", label: "Gamepad", Icon: GamepadIcon },
  { name: "lightbulb", label: "Lightbulb", Icon: LightbulbIcon },
  { name: "grid", label: "Grid", Icon: GridIcon },
  { name: "heart", label: "Heart", Icon: HeartIcon },
  { name: "image", label: "Image", Icon: ImageIcon },
  { name: "key", label: "Key", Icon: KeyIcon },
  { name: "layers", label: "Layers", Icon: LayersIcon },
  { name: "globe", label: "Globe", Icon: GlobeIcon },
  { name: "support", label: "Support", Icon: SupportIcon },
  { name: "leaf", label: "Leaf", Icon: LeafIcon },
  { name: "seedling", label: "Seedling", Icon: SeedlingIcon },
  { name: "flash", label: "Flash", Icon: FlashIcon },
  { name: "map-pin", label: "Map Pin", Icon: MapPinIcon },
  { name: "lock", label: "Lock", Icon: LockIcon },
  { name: "rss", label: "RSS", Icon: RssIcon },
  { name: "building", label: "Building", Icon: BuildingIcon },
  { name: "home", label: "Home", Icon: HomeIcon },
  { name: "gift", label: "Gift", Icon: GiftIcon },
  { name: "calendar", label: "Calendar", Icon: CalendarIcon },
  { name: "mail", label: "Mail", Icon: MailIcon },
  { name: "contacts", label: "Contacts", Icon: ContactsIcon },
  { name: "report", label: "Report", Icon: ReportIcon },
  { name: "fingerprint", label: "Fingerprint", Icon: FingerprintIcon },
  { name: "cpu", label: "CPU", Icon: CpuIcon },
  { name: "calculator", label: "Calculator", Icon: CalculatorIcon },
  { name: "camera", label: "Camera", Icon: CameraIcon },
  { name: "rocket", label: "Rocket", Icon: RocketIcon },
  { name: "palette", label: "Palette", Icon: PaletteIcon },
  { name: "music", label: "Music", Icon: MusicIcon },
  { name: "movie", label: "Movie", Icon: MovieIcon },
  { name: "shield", label: "Shield", Icon: ShieldIcon },
  { name: "medicine", label: "Medicine", Icon: MedicineIcon },
  { name: "flag", label: "Flag", Icon: FlagIcon },
  { name: "scales", label: "Scales", Icon: ScalesIcon },
  { name: "basketball", label: "Basketball", Icon: BasketballIcon },
  { name: "baseball", label: "Baseball", Icon: BaseballIcon },
] as const;

const PROJECT_ICON_COMPONENTS = Object.fromEntries(
  PROJECT_ICON_PRESETS.map((preset) => [preset.name, preset.Icon]),
) as Record<ProjectIconName, ComponentType<{ className?: string }>>;

function loadImageFromObjectUrl(objectUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("The selected icon could not be loaded."));
    image.src = objectUrl;
  });
}

export async function prepareUploadedProjectIcon(file: File) {
  if (file.size > 512 * 1024) {
    throw new Error("Keep the favicon under 512 KB.");
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageFromObjectUrl(objectUrl);
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("The icon preview canvas is not available.");
    }

    const scale = Math.min(size / image.width, size / image.height);
    const drawWidth = Math.max(1, Math.round(image.width * scale));
    const drawHeight = Math.max(1, Math.round(image.height * scale));
    const offsetX = Math.round((size - drawWidth) / 2);
    const offsetY = Math.round((size - drawHeight) / 2);

    context.clearRect(0, 0, size, size);
    context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
    const src = canvas.toDataURL("image/png");

    const imageData = context.getImageData(0, 0, size, size);
    const pixels = imageData.data;

    let transparentPixelCount = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if ((pixels[index + 3] ?? 0) < 250) {
        transparentPixelCount += 1;
      }
    }

    const prefersAlphaMask = transparentPixelCount > size * size * 0.08;

    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index] ?? 0;
      const green = pixels[index + 1] ?? 0;
      const blue = pixels[index + 2] ?? 0;
      const alpha = pixels[index + 3] ?? 0;
      const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
      const nextAlpha = prefersAlphaMask
        ? alpha
        : Math.round(Math.max(0, 1 - luminance) * 255);

      pixels[index] = 255;
      pixels[index + 1] = 255;
      pixels[index + 2] = 255;
      pixels[index + 3] = nextAlpha < 28 ? 0 : nextAlpha;
    }

    context.putImageData(imageData, 0, 0);
    return {
      src,
      maskSrc: canvas.toDataURL("image/png"),
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function ProjectIcon({
  icon,
  color,
  className,
  fallback = "default",
}: {
  icon?: LocalProjectIcon | null;
  color: string;
  className?: string;
  fallback?: "default" | "dot" | "none";
}) {
  if (!icon) {
    if (fallback === "none") {
      return null;
    }

    if (fallback === "dot") {
      return (
        <span
          aria-hidden="true"
          className={cn("project-icon", "project-icon-dot", className)}
          style={{ backgroundColor: color }}
        />
      );
    }
  }

  const normalizedIcon = normalizeProjectIcon(icon);

  if (normalizedIcon.kind === "upload") {
    if (normalizedIcon.colorMode === "native") {
      return (
        <span
          aria-hidden="true"
          className={cn(
            "project-icon",
            "project-icon-upload",
            "project-icon-upload-native",
            className,
          )}
          style={{
            backgroundImage: `url("${normalizedIcon.src}")`,
          }}
        />
      );
    }

    return (
      <span
        aria-hidden="true"
        className={cn("project-icon", "project-icon-upload", className)}
        style={{
          backgroundColor: color,
          maskImage: `url("${normalizedIcon.maskSrc ?? normalizedIcon.src}")`,
          WebkitMaskImage: `url("${normalizedIcon.maskSrc ?? normalizedIcon.src}")`,
        }}
      />
    );
  }

  const Icon = PROJECT_ICON_COMPONENTS[normalizedIcon.name];

  return (
    <span
      aria-hidden="true"
      className={cn("project-icon", "project-icon-preset", className)}
      style={{ color }}
    >
      <Icon />
    </span>
  );
}
