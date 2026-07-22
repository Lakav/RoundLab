import { assetPath } from "@/lib/paths";

export type KillFeedIconKind =
  | "blind"
  | "flash-assist"
  | "no-scope"
  | "smoke"
  | "wallbang"
  | "headshot"
  | "domination"
  | "revenge";

const ICONS: Record<KillFeedIconKind, { label: string; file: string }> = {
  blind: { label: "Kill while blinded", file: "blind.webp" },
  "flash-assist": { label: "Flash assist", file: "flash-assist.webp" },
  "no-scope": { label: "No-scope", file: "no-scope.webp" },
  smoke: { label: "Kill through smoke", file: "smoke.webp" },
  wallbang: { label: "Wallbang", file: "wallbang.webp" },
  headshot: { label: "Headshot", file: "headshot.webp" },
  domination: { label: "Domination", file: "domination.webp" },
  revenge: { label: "Revenge", file: "revenge.webp" },
};

export function KillFeedIcon({ kind }: { kind: KillFeedIconKind }) {
  const icon = ICONS[kind];
  return (
    <span
      aria-hidden="true"
      className="inline-block h-[18px] w-[21px] shrink-0 bg-contain bg-center bg-no-repeat opacity-90 [filter:invert(1)_brightness(1.35)]"
      data-killfeed-icon={kind}
      title={icon.label}
      style={{ backgroundImage: `url(${assetPath(`/icons/killfeed/${icon.file}`)})` }}
    />
  );
}
