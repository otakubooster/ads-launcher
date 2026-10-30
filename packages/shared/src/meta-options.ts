/** Choices the preset, copy and launch screens offer. Browser-safe. */

/**
 * Advantage+ creative features set one by one in
 * degrees_of_freedom_spec.creative_features_spec (the old standard_enhancements
 * bundle is gone since v22.0).
 */
export const CREATIVE_FEATURES = [
  { key: "image_touchups", label: "Visual touch-ups", hint: "Automatic cropping and filters" },
  { key: "image_brightness_and_contrast", label: "Brightness and contrast" },
  { key: "text_optimizations", label: "Text improvements", hint: "Swaps primary text, headline and description" },
  { key: "enhance_cta", label: "Enhance CTA" },
  { key: "image_templates", label: "Add overlays", hint: "Frames and text on images" },
  { key: "video_auto_crop", label: "Video auto-crop" },
  { key: "adapt_to_placement", label: "Adapt to placement" },
  { key: "inline_comment", label: "Show relevant comments" },
  { key: "description_automation", label: "Dynamic description" },
  { key: "music", label: "Add music" },
] as const;
export type CreativeFeatureKey = (typeof CREATIVE_FEATURES)[number]["key"];

export const CTA_TYPES = ["SHOP_NOW", "LEARN_MORE", "BUY_NOW", "ORDER_NOW", "GET_OFFER", "SIGN_UP", "SUBSCRIBE", "SEE_MORE", "CONTACT_US"] as const;
export const CONVERSION_EVENTS = ["PURCHASE", "INITIATED_CHECKOUT", "ADD_TO_CART", "LEAD", "COMPLETE_REGISTRATION"] as const;

/** Meta's recommended lengths; longer copy gets truncated in most placements. */
export const COPY_LIMITS = { primaryText: 125, headline: 40, description: 30, perType: 5 } as const;

export const DEFAULT_URL_TAGS = "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}";

export const label = (constant: string) => constant.charAt(0) + constant.slice(1).toLowerCase().replace(/_/g, " ");
