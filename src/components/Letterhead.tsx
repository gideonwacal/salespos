import { useBusiness } from "@/hooks/useBusiness";

/**
 * Branding block for printed documents.
 *
 * Hidden on screen — the sidebar already carries the logo there — and revealed
 * by the `print-only` rule so a printed statement leaves the shop on headed
 * paper rather than as an anonymous table.
 */
export function Letterhead({ title, subtitle }: { title: string; subtitle?: string }) {
  const business = useBusiness();
  const contact = [business.phone, business.email].filter(Boolean).join(" · ");

  return (
    <div className="print-only mb-4 border-b border-border pb-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {business.logo_url && (
            <img
              src={business.logo_url}
              alt={`${business.name} logo`}
              className="h-14 w-auto object-contain"
            />
          )}
          <div>
            <p className="text-lg font-extrabold leading-tight">{business.name}</p>
            {business.tagline && <p className="text-xs">{business.tagline}</p>}
            {business.address && <p className="text-xs">{business.address}</p>}
            {contact && <p className="text-xs">{contact}</p>}
            {business.tax_id && <p className="text-xs">TIN: {business.tax_id}</p>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold">{title}</p>
          {subtitle && <p className="text-xs">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}
