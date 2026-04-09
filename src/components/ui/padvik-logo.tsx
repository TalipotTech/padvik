import Image from "next/image";

interface PadvikLogoProps {
  /** Size variant */
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Show "Padvik" text next to the icon */
  showText?: boolean;
  /** Custom className for the wrapper */
  className?: string;
  /** Text size class override */
  textClassName?: string;
}

const SIZES = {
  xs: 24,
  sm: 28,
  md: 32,
  lg: 36,
  xl: 48,
} as const;

const TEXT_SIZES = {
  xs: "text-sm",
  sm: "text-base",
  md: "text-lg",
  lg: "text-xl",
  xl: "text-2xl",
} as const;

export function PadvikLogo({
  size = "md",
  showText = true,
  className = "",
  textClassName,
}: PadvikLogoProps) {
  const px = SIZES[size];
  const textSize = textClassName ?? TEXT_SIZES[size];

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Image
        src="/logo-icon.png"
        alt="Padvik"
        width={px}
        height={px}
        className="shrink-0"
        priority
      />
      {showText && <span className={`font-bold ${textSize}`}>Padvik</span>}
    </span>
  );
}
