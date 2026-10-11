import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import hardDayMarkUrl from "../../../../assets/hard-day-logo-png.png";
import hardDayTextLogoUrl from "../../../../assets/hard-day-text-logo.svg";

type BrandLogoProps = {
  className?: string;
  linked?: boolean;
};

export function BrandLogo({ className, linked = false }: BrandLogoProps) {
  const logo = (
    <span className="harday-logo-lockup">
      <img
        src={hardDayMarkUrl}
        alt=""
        aria-hidden="true"
        className="harday-logo-mark"
      />
      <img src={hardDayTextLogoUrl} alt="HarDay" className="harday-wordmark" />
    </span>
  );

  if (linked) {
    return (
      <Link
        to="/time/$date"
        params={{ date: "today" }}
        aria-label="HarDay home"
        className={cn("harday-brand-link", className)}
      >
        {logo}
      </Link>
    );
  }

  return <div className={className}>{logo}</div>;
}
