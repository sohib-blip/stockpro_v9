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
        <rect x="4" y="4" width="56" height="56" rx="13" fill="#071A3D" />
        <path
          d="M4 32h56v15c0 7.2-5.8 13-13 13H17C9.8 60 4 54.2 4 47V32Z"
          fill="#155EEF"
        />
        <path
          d="M46 16H21c-6.1 0-10 3.8-10 9s3.9 9 10 9h22c6.1 0 10 3.8 10 9s-3.9 9-10 9H18"
          fill="none"
          stroke="#FFFFFF"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="9"
        />
        <path d="M23 18v-6h5v6m5 0v-6h5v6" stroke="#FFFFFF" strokeWidth="4" />
        <path d="M27 50v6h5v-6m5 0v6h5v-6" stroke="#FFFFFF" strokeWidth="4" />
        <circle cx="51" cy="14" r="3.6" fill="#12B76A" />
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
