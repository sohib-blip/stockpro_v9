import stockProMark from "@/app/icon.png";

type BrandLogoProps = {
  className?: string;
  tagline?: string;
  variant?: "navigation" | "auth";
};

export default function BrandLogo({
  className = "",
  tagline,
  variant = "navigation",
}: BrandLogoProps) {
  return (
    <span
      className={`stockpro-brand stockpro-brand--${variant} ${className}`.trim()}
    >
      <img
        src={stockProMark.src}
        alt=""
        width={512}
        height={512}
        className="stockpro-brand-mark"
        aria-hidden="true"
        draggable={false}
      />

      <span className="stockpro-brand-copy">
        <span className="stockpro-brand-name">
          <span className="stockpro-brand-name-stock">Stock</span>
          <span className="stockpro-brand-name-pro">Pro</span>
        </span>
        {tagline && <span className="stockpro-brand-tagline">{tagline}</span>}
      </span>
    </span>
  );
}
