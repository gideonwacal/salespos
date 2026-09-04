import { useBusiness } from "@/hooks/useBusiness";
import { resolveIndustry, type IndustryProfile } from "@/lib/industry";

/** The active business's industry profile. Drives labels, fields and categories. */
export function useIndustry(): IndustryProfile {
  return resolveIndustry(useBusiness().industry);
}
