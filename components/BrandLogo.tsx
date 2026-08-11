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
      <svg
        className="stockpro-brand-mark"
        viewBox="0 0 64 64"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M32 3 58 17 32 31 6 17 32 3Z" fill="#155EEF" />
        <path d="M6 21 29 33.4V61L6 47.5V21Z" fill="#1D4ED8" />
        <path d="M35 33.4 58 21v26.5L35 61V33.4Z" fill="#2563EB" />
        <path
          d="m12 16.8 19.8 10.6 15.8-8.5M48.2 27.1l-16.4 8.8-16-8.5M15.8 27.4l16 8.5 12.6 6.8-12.5 7.1-17.3-9.3"
          fill="none"
          stroke="#FFFFFF"
          strokeLinecap="square"
          strokeLinejoin="miter"
          strokeWidth="5.2"
        />
        <path
          d="M10.5 40.1h7.3v-3.6l8.6 7-8.6 7v-3.6h-7.3v-6.8Z"
          fill="#12B76A"
        />
      </svg>

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
