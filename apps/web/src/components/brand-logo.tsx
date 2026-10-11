import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import logoMarkUrl from "../../../../assets/ajour-logo-mark.png";

type BrandLogoProps = {
  className?: string;
  linked?: boolean;
};

export function BrandLogo({ className, linked = false }: BrandLogoProps) {
  const logo = (
    <span className="ajour-logo-lockup">
      <img
        src={logoMarkUrl}
        alt=""
        aria-hidden="true"
        className="ajour-logo-mark"
      />
      <span className="ajour-wordmark">Ajour</span>
    </span>
  );

  if (linked) {
    return (
      <Link
        to="/time/$date"
        params={{ date: "today" }}
        aria-label="Ajour home"
        className={cn("ajour-brand-link", className)}
      >
        {logo}
      </Link>
    );
  }

  return <div className={className}>{logo}</div>;
}
