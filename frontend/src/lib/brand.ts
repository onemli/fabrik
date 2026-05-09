// Single source of truth for product naming and marketing copy.
//
// Anywhere the UI surfaces the product tagline — login splash, register
// splash, marketing badges, document <title> suffixes — it imports from
// here. The goal is one edit propagating to every visible string the
// next time we tweak positioning, instead of grep-and-replace risk.

export const BRAND_NAME = 'Fabrik'

/** Headline shown beside the logo on auth screens. Short, declarative,
 * plays on "fabric" → "Fabrik" while signalling the product value. */
export const BRAND_TAGLINE = 'The fabric, finally legible.'

/** One-sentence support line that follows the tagline. Spells out the
 * concrete capabilities so a first-time visitor knows what Fabrik does
 * within five seconds of landing on the splash. */
export const BRAND_SUBTAGLINE =
  'Visualise, Query, and Automate Your Cisco ACI Fabric — Without Writing API Calls.'
